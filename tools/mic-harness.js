(async () => {
  const sr = 48000, dur = 13;
  const oc = new OfflineAudioContext(1, sr * dur, sr);
  const an = oc.createAnalyser();
  an.fftSize = 2048; an.smoothingTimeConstant = 0;
  const master = oc.createGain();
  master.connect(an); an.connect(oc.destination);
  const nb = oc.createBuffer(1, sr * dur, sr);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.001;
  const ns = oc.createBufferSource(); ns.buffer = nb; ns.connect(master); ns.start();
  async function load(name) {
    const r = await fetch('samples/' + name + '.mp3');
    return await oc.decodeAudioData(await r.arrayBuffer());
  }
  const bufs = {};
  for (const n of ['E2','A2','D3','G3','B3','E4']) bufs[n] = await load(n);
  function note(name, t, g) {
    const s = oc.createBufferSource(); s.buffer = bufs[name];
    const gn = oc.createGain(); gn.gain.value = g;
    s.connect(gn); gn.connect(master); s.start(t);
  }
  const expected = [];
  let t = 0.5;
  for (let k = 0; k < 8; k++) { note(['D3','G3','B3','E4'][k % 4], t, 0.06); expected.push({ t, kind: 'arp-suave' }); t += 0.45; }
  t = 5.9;
  for (let k = 0; k < 4; k++) { note(['D3','G3','B3','E4'][k % 4], t, 0.2); expected.push({ t, kind: 'arp-medio' }); t += 0.4; }
  function clk(when, accent) {
    const o = oc.createOscillator(), g = oc.createGain();
    o.type = 'triangle'; o.frequency.value = accent ? 1800 : 1250;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    o.connect(g); g.connect(master); o.start(when); o.stop(when + 0.07);
  }
  for (let ct = 4.4; ct < 7.5; ct += 0.5) clk(ct, Math.round(ct * 2) % 4 === 0);
  for (const st of [8.0, 8.7, 9.4, 10.4, 10.65, 10.9, 11.15, 11.4, 11.65]) {
    ['E2','A2','D3','G3','B3','E4'].forEach((nm, i) => note(nm, st + i * 0.012, 0.5));
    expected.push({ t: st, kind: 'rasgueo' });
  }
  const binHz = sr / 2048;
  const lo = Math.max(1, Math.round(60 / binHz));
  const hi = Math.min(an.frequencyBinCount - 1, Math.round(900 / binHz));
  const lo2 = Math.round(2400 / binHz), hi2 = Math.min(an.frequencyBinCount - 1, Math.round(6000 / binHz));
  const notch = i => { const f = i * binHz; return Math.abs(f - 3750) < 160 || Math.abs(f - 5400) < 160; };
  const buf = new Float32Array(an.frequencyBinCount);
  const prevDb = new Float32Array(hi2 + 1).fill(-100);
  const env = new Float32Array(hi2 + 1).fill(-100);
  const prevLin = new Float32Array(hi + 1);
  const cur = { floor: 0.003, floorDb: -75, fluxDbAvg: 0, last: -1 };
  const evC = []; const dbgRows = [];
  function frame(now) {
    an.getFloatFrequencyData(buf);
    let e = 0, fluxDb = 0, meanDb = 0;
    for (let i = lo; i <= hi2; i++) {
      const inB1 = i <= hi, inB2 = i >= lo2 && !notch(i);
      if (!inB1 && !inB2) continue;
      const db = Math.max(buf[i], -100);
      const lin = Math.pow(10, db / 20);
      if (inB1) { e += lin * lin; meanDb += db; }
      const rise = db - (env[i] + 2);
      if (rise > 3 && db > cur.floorDb + 12) { fluxDb += rise;
        if (now > 4400 && now <= 4450) (window.__bins = window.__bins || []).push([+now.toFixed(0), i, +(i*binHz).toFixed(0), +db.toFixed(1), +rise.toFixed(1)]); }
      env[i] = Math.max(env[i] - 1.5, db);
      prevDb[i] = db; prevLin[i] = lin;
    }
    const n = hi - lo + 1;
    meanDb /= n;
    const bandRms = Math.sqrt(e / n);
    if (bandRms < cur.floor) cur.floor = Math.max(0.0015, cur.floor * 0.995);
    else if (bandRms < cur.floor * 2.5) cur.floor = cur.floor * 1.01;
    if (bandRms < cur.floor * 2.5) cur.floorDb = cur.floorDb * 0.98 + meanDb * 0.02;
    if (fluxDb > Math.max(20, cur.fluxDbAvg * 2.5) && now - cur.last > 150) {
      cur.last = now; evC.push(+now.toFixed(0)); }
    cur.fluxDbAvg = cur.fluxDbAvg * 0.9 + Math.min(fluxDb, cur.fluxDbAvg * 3 + 10) * 0.1;
    (window.__snd = window.__snd || []).push([+now.toFixed(0), bandRms > Math.max(0.002, cur.floor*2.5) ? 1 : 0, meanDb > cur.floorDb + 6 ? 1 : 0]);
    if (now > 10300 && now < 12000) dbgRows.push([+now.toFixed(0), +fluxDb.toFixed(1), +cur.fluxDbAvg.toFixed(1), +(cur.gate||0).toFixed(1)]);
  }
  const step = 0.025;
  for (let tt = step; tt < dur - 0.001; tt += step) oc.suspend(tt).then(() => { frame(tt * 1000); oc.resume(); });
  await oc.startRendering();
  const near = ms => evC.some(x => Math.abs(x - ms) <= 150);
  const res = expected.map(x => ({ kind: x.kind, t: x.t, C: near(x.t * 1000) }));
  const spurious = evC.filter(x => !expected.some(e2 => Math.abs(x - e2.t * 1000) <= 200));
  return JSON.stringify({ res, totalC: evC.length, spurious, evC, dbgRows });
})()
