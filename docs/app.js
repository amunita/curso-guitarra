/* Runtime de la webapp del curso de guitarra.
   No modifica el contenido del curso: agrega audio (muestras de guitarra
   nylon real, con fallback a síntesis Karplus-Strong), metrónomo, demos
   interactivas, canciones, referencia de acordes/notas y persistencia. */
'use strict';

window.__gcerr = [];
window.addEventListener('error', e => { window.__gcerr.push(String(e.message)); });

/* ============================== estado ============================== */
function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function load(k, d) {
  try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
  catch (e) { return d; }
}

/* ============================== audio ============================== */
// afinación estándar: índice = nº de cuerda - 1 (1ª..6ª)
const OPEN_MIDI = [64, 59, 55, 50, 45, 40];
let ctx = null, master = null;
const bufCache = {};

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4500;
    master.connect(lp);
    lp.connect(ctx.destination);
    Object.keys(sampleRaw).forEach(m => decodeSample(+m));
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
['touchend', 'mousedown', 'keydown'].forEach(ev =>
  document.addEventListener(ev, () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { passive: true }));

function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

/* Muestras de guitarra nylon real (VSCO2 Community Edition, dominio público):
   una nota grabada cada ~2 semitonos; las intermedias se afinan con playbackRate.
   Si aún no cargaron (o falló la red y no hay cache), pluck() cae al Karplus-Strong. */
const SAMPLE_MIDI = { E2: 40, Fs2: 42, Gs2: 44, A2: 45, B2: 47, Cs3: 49, D3: 50, E3: 52, Fs3: 54, G3: 55, A3: 57, B3: 59, Cs4: 61, Ds4: 63, E4: 64, Fs4: 66, Gs4: 68, A4: 69, B4: 71, Cs5: 73, D5: 74, E5: 76, Fs5: 78, G5: 79, Gs5: 80, A5: 81, As5: 82 };
const sampleRaw = {};  // midi → ArrayBuffer a la espera de un AudioContext
const sampleBuf = {};  // midi → AudioBuffer decodificado
function fetchSamples() {
  Object.entries(SAMPLE_MIDI).forEach(([name, midi]) => {
    fetch('samples/' + name + '.mp3')
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(ab => { if (ab) { sampleRaw[midi] = ab; if (ctx) decodeSample(midi); } })
      .catch(() => {});
  });
}
function decodeSample(midi) {
  const ab = sampleRaw[midi];
  if (!ab) return;
  delete sampleRaw[midi];
  ctx.decodeAudioData(ab, buf => { sampleBuf[midi] = buf; }, () => {});
}
const SAMPLE_TOTAL = Object.keys(SAMPLE_MIDI).length;
let sampleGaveUp = false; // sin red y sin cache: no esperar en cada play
function samplesReady() {
  if (sampleGaveUp || Object.keys(sampleBuf).length >= SAMPLE_TOTAL) return Promise.resolve();
  return new Promise(res => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (Object.keys(sampleBuf).length >= SAMPLE_TOTAL) { clearInterval(iv); res(); }
      else if (performance.now() - t0 > 1500) { sampleGaveUp = true; clearInterval(iv); res(); }
    }, 50);
  });
}
function nearestSample(midi) {
  let best = null, bd = 1e9;
  for (const k in sampleBuf) {
    const d = Math.abs(+k - midi);
    if (d < bd) { bd = d; best = +k; }
  }
  // con el set completo el estiramiento normal es ≤1 semitono; el margen de 6
  // cubre las notas del "ding" del afinador y el aviso de sesión (hasta MIDI 88)
  return bd <= 6 ? best : null;
}
fetchSamples();
// crear el contexto de inmediato (queda 'suspended' hasta el primer toque en iOS)
// para que las muestras se decodifiquen al cargar: si no, la primera reproducción
// partía antes de decodificar y sonaba con el sintetizador de respaldo
audio();
window.__gcaudio = () => ({ pendientes: Object.keys(sampleRaw).length, decodificadas: Object.keys(sampleBuf).length, ctx: !!ctx,
  mic: mic.on ? { bandRms: mic.dbg.bandRms, fluxDb: mic.dbg.flux, fluxDbAvg: mic.fluxDbAvg, floorDb: mic.floorDb, count: mic.count } : null });

// cuerda pulsada por Karplus-Strong, con ruido inicial suavizado (timbre nylon)
function pluckBuf(midi) {
  if (bufCache[midi]) return bufCache[midi];
  const sr = ctx.sampleRate;
  const N = Math.max(2, Math.round(sr / midiFreq(midi)));
  const dur = midi < 50 ? 2.8 : midi < 60 ? 2.3 : 1.9;
  const len = (sr * dur) | 0;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const ring = new Float32Array(N);
  let last = 0;
  for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; ring[i] = (w + last) / 2; last = ring[i]; }
  const damp = 0.9985 - 0.006 * Math.max(0, Math.min(1, (midi - 40) / 24));
  for (let i = 0; i < len; i++) {
    const j = i % N, nx = (j + 1) % N;
    d[i] = ring[j];
    ring[j] = damp * 0.5 * (ring[j] + ring[nx]);
  }
  const F = (sr * 0.015) | 0;
  for (let i = 0; i < F; i++) { d[i] *= i / F; d[len - 1 - i] *= i / F; }
  bufCache[midi] = buf;
  return buf;
}

let liveNodes = [];
function pluck(midi, when, vel) {
  audio();
  const t = Math.max(when || 0, ctx.currentTime);
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  const base = nearestSample(midi);
  if (base != null) {
    src.buffer = sampleBuf[base];
    src.playbackRate.value = Math.pow(2, (midi - base) / 12);
    g.gain.value = 0.8 * (vel == null ? 1 : vel);
  } else {
    src.buffer = pluckBuf(midi);
    g.gain.value = 0.55 * (vel == null ? 1 : vel);
  }
  src.connect(g); g.connect(master);
  src.start(t);
  liveNodes.push(src);
  // se saca solo al terminar: recortar la lista por tamaño dejaba notas futuras
  // ya programadas sin referencia y "Detener" no podía pararlas
  src.onended = () => { const i = liveNodes.indexOf(src); if (i >= 0) liveNodes.splice(i, 1); };
  return src;
}

function click(when, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  // triangular + rampa de 2 ms: la cuadrada con arranque instantáneo era un
  // impulso de banda ancha y el contador por micrófono la contaba como ataque
  o.type = 'triangle';
  o.frequency.value = accent ? 1800 : 1250;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  o.connect(g); g.connect(master);
  o.start(when); o.stop(when + 0.07);
  liveNodes.push(o);
  o.onended = () => { const i = liveNodes.indexOf(o); if (i >= 0) liveNodes.splice(i, 1); };
}

function stopAllSound() {
  liveNodes.forEach(n => { try { n.stop(); } catch (e) {} });
  liveNodes = [];
}

/* ================== acordes: parseo de los SVG del curso ================== */
const STR_X = [28, 50, 72, 94, 116, 138]; // 6ª → 1ª (izquierda → derecha)
const CHORDS = {};      // nombre → {frets:[6ª..1ª], svg}
function nearestString(x) {
  let bi = 0, bd = 1e9;
  STR_X.forEach((sx, i) => { const d = Math.abs(sx - x); if (d < bd) { bd = d; bi = i; } });
  return bd < 14 ? bi : -1;
}
function parseChordDiv(div) {
  const svg = div.querySelector('svg');
  const nameEl = div.querySelector('b');
  if (!svg || !nameEl) return null;
  const name = nameEl.textContent.trim();
  let base = 1;
  const tiny = svg.querySelector('.tiny');
  if (tiny) { const m = tiny.textContent.match(/(\d+)\s*fr/); if (m) base = +m[1]; }
  const frets = [null, null, null, null, null, null]; // índice 0 = 6ª
  const barre = svg.querySelector('.barre');
  if (barre) {
    const y = +barre.getAttribute('y1');
    const f = Math.round((y - 30) / 20) + base - 1;
    const x1 = +barre.getAttribute('x1'), x2 = +barre.getAttribute('x2');
    STR_X.forEach((sx, i) => { if (sx >= x1 - 2 && sx <= x2 + 2) frets[i] = f; });
  }
  svg.querySelectorAll('circle.dot').forEach(c => {
    const i = nearestString(+c.getAttribute('cx'));
    if (i < 0) return;
    const f = Math.round((+c.getAttribute('cy') - 30) / 20) + base - 1;
    if (frets[i] == null || f > frets[i]) frets[i] = f;
  });
  svg.querySelectorAll('circle.open').forEach(c => {
    const i = nearestString(+c.getAttribute('cx'));
    if (i >= 0) frets[i] = 0;
  });
  svg.querySelectorAll('text.mark').forEach(t => {
    if (t.textContent.trim() !== '×') return;
    const i = nearestString(+t.getAttribute('x') + 4);
    if (i >= 0) frets[i] = -1;
  });
  return { name, frets };
}
function chordMidis(frets) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const f = frets[i];
    if (f == null || f < 0) continue;
    out.push(OPEN_MIDI[6 - i - 1] + f); // i=0 es la 6ª cuerda
  }
  return out; // grave → agudo
}
function strumChord(name, when, vel, top) {
  const c = CHORDS[name] || CHORDS[baseChordName(name)];
  if (!c) return false;
  let midis = chordMidis(c.frets);
  if (top) midis = midis.slice(-top);
  const t = Math.max(when || 0, audio().currentTime);
  midis.forEach((m, i) => pluck(m, t + i * 0.035, vel));
  return true;
}
function baseChordName(name) {
  const m = /^([A-G][#b]?)(m(?!aj))?/.exec(name || '');
  return m ? m[1] + (m[2] || '') : '';
}

/* Digitación estándar por acorde: {nº de cuerda: dedo} (1=índice … 4=meñique, T=pulgar).
   Aprobado por Andrés (VB 2026-08-30) como mejora gráfica de los diagramas. */
const FINGERING = {
  'A':    { 4: '1', 3: '2', 2: '3' },
  'Am':   { 4: '2', 3: '3', 2: '1' },
  'Bm':   { 5: '1', 4: '3', 3: '4', 2: '2', 1: '1' },
  'C':    { 5: '3', 4: '2', 2: '1' },
  'D':    { 3: '1', 2: '3', 1: '2' },
  'D/F#': { 6: 'T', 3: '1', 2: '3', 1: '2' },
  'Dm':   { 3: '2', 2: '3', 1: '1' },
  'E':    { 5: '2', 4: '3', 3: '1' },
  'Em':   { 5: '2', 4: '3' },
  'F':    { 6: '1', 5: '3', 4: '4', 3: '2', 2: '1', 1: '1' },
  'G':    { 6: '3', 5: '2', 1: '4' },
  'G/B':  { 5: '2', 1: '3' }
};
const PC_LAT = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
function decorateChordDiv(div) {
  if (div.dataset.gcdec) return;
  div.dataset.gcdec = '1';
  const svg = div.querySelector('svg');
  const nameEl = div.querySelector('b');
  if (!svg || !nameEl) return;
  const name = nameEl.textContent.trim();
  const fing = FINGERING[name];
  const parsed = parseChordDiv(div);
  if (!parsed) return;
  const NS = 'http://www.w3.org/2000/svg';
  if (fing) {
    svg.querySelectorAll('circle.dot').forEach(c => {
      const i = nearestString(+c.getAttribute('cx'));
      if (i < 0) return;
      const f = fing[6 - i];
      if (!f) return;
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', c.getAttribute('cx'));
      t.setAttribute('y', +c.getAttribute('cy') + 3.4);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', 'fingnum');
      t.textContent = f;
      svg.appendChild(t);
    });
  }
  // notas del acorde (únicas, desde el bajo): C = Do·Mi·Sol
  const seen = new Set(), pcs = [];
  chordMidis(parsed.frets).forEach(m => {
    const pc = m % 12;
    if (!seen.has(pc)) { seen.add(pc); pcs.push(PC_LAT[pc]); }
  });
  if (pcs.length) {
    const d = document.createElement('div');
    d.className = 'chnotes';
    d.textContent = pcs.join('·');
    div.appendChild(d);
  }
}
function decorateChords(root) {
  (root || document).querySelectorAll('.chord').forEach(div => {
    try { decorateChordDiv(div); } catch (e) { window.__gcerr.push('dec: ' + e.message); }
  });
}

/* ===================== metrónomo (estilo Moises) ===================== */
const SIGS = { '2/4': 2, '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 6, '12/8': 12 };
const met = Object.assign({ bpm: 60, sig: '4/4', on: false, next: 0, count: 0, timer: null,
  prog: { on: false, to: 80, step: 5, bars: 8 } }, load('gc:met', {}));
met.on = false;
if (!met.prog) met.prog = { on: false, to: 80, step: 5, bars: 8 };
function metBeats() { return SIGS[met.sig] || 4; }
function metSave() { store('gc:met', { bpm: met.bpm, sig: met.sig, prog: met.prog }); }
function metStart() {
  audio();
  if (met.on) return;
  met.on = true;
  met.count = 0;
  met.lastBump = 0;
  met.next = ctx.currentTime + 0.1;
  met.timer = setInterval(metTick, 25);
  metUI();
}
function metStop() {
  met.on = false;
  if (met.timer) { clearInterval(met.timer); met.timer = null; }
  metUI();
}
function metTick() {
  while (met.next < ctx.currentTime + 0.12) {
    const beats = metBeats();
    const beat = met.count % beats;
    // modo progresivo: cada N compases sube el BPM hasta el objetivo
    if (met.prog.on && beat === 0 && met.count > 0) {
      const bar = met.count / beats;
      if (bar % met.prog.bars === 0 && met.lastBump !== bar && met.bpm < met.prog.to) {
        met.lastBump = bar;
        met.bpm = Math.min(met.prog.to, met.bpm + met.prog.step);
        metSave(); metUI();
      }
    }
    click(met.next, beat === 0);
    flashBeat(beat, (met.next - ctx.currentTime) * 1000);
    met.count++;
    met.next += 60 / met.bpm;
  }
}
function flashBeat(beat, delayMs) {
  setTimeout(() => {
    document.querySelectorAll('.metbeat i').forEach((el, i) => el.classList.toggle('hit', i === beat));
  }, Math.max(0, delayMs));
}
function metUI() {
  const fab = document.querySelector('.metfab');
  const btn = document.querySelector('.metstart');
  if (fab) fab.classList.toggle('on', met.on);
  if (btn) { btn.classList.toggle('on', met.on); btn.textContent = met.on ? '■' : '▶'; }
  const dots = document.querySelector('.metbeat');
  if (dots) {
    const n = metBeats();
    if (dots.children.length !== n) {
      dots.innerHTML = '';
      for (let i = 0; i < n; i++) { const d = document.createElement('i'); if (i === 0) d.className = 'acc'; dots.appendChild(d); }
    }
  }
  const v = document.querySelector('.bpmval');
  if (v) v.textContent = met.bpm;
  if (session.el) sessionMetUI();
  const r = document.querySelector('#metslider');
  if (r && +r.value !== met.bpm) r.value = met.bpm;
  const s = document.querySelector('#metsig');
  if (s && s.value !== met.sig) s.value = met.sig;
}

/* ===================== reproducción de demos ===================== */
let playSession = 0;
function stopPlayback() {
  playSession++;
  stopAllSound();
  document.querySelectorAll('.play.playing').forEach(b => { b.classList.remove('playing'); b.textContent = b.dataset.lbl || '▶'; });
}
// events: [{at, midis:[..], vel, strumMs, fb}] — `at` en pulsos (puede ser fraccionario)
async function playEvents(events, bpm, sigBeats, btn, onBeatFlash) {
  // el mismo botón alterna: tocando → detener
  if (btn && btn.classList.contains('playing')) { stopPlayback(); return; }
  audio();
  stopPlayback();
  if (!events.length) return;
  // si las muestras de nylon aún se están decodificando, esperarlas (máx 1,5 s):
  // sin esto la primera demo sonaba con el sintetizador de respaldo
  const id = playSession;
  await samplesReady();
  if (id !== playSession) return; // otro play/stop ganó durante la espera
  const spb = 60 / bpm;
  const useMet = met.on;             // metrónomo activado → count-in + clic durante la demo
  const wasRunning = met.on;
  if (wasRunning) metStop();
  let t = ctx.currentTime + 0.15;
  if (useMet) {
    for (let b = 0; b < sigBeats; b++) { click(t, b === 0); flashBeat(b, (t - ctx.currentTime) * 1000); t += spb; }
  }
  const lastAt = Math.max.apply(null, events.map(e => e.at));
  if (useMet) {
    for (let b = 0; b <= Math.ceil(lastAt); b++) {
      const when = t + b * spb;
      click(when, (b % sigBeats) === 0);
      flashBeat(b % sigBeats, (when - ctx.currentTime) * 1000);
    }
  }
  events.forEach(ev => {
    const when = t + ev.at * spb;
    const stag = (ev.strumMs == null ? 35 : ev.strumMs) / 1000;
    ev.midis.forEach((m, k) => pluck(m, when + k * stag, ev.vel));
    if (onBeatFlash) setTimeout(() => { if (id === playSession) onBeatFlash(ev); }, (when - ctx.currentTime) * 1000);
  });
  const end = t + (lastAt + 1) * spb + 0.4;
  if (btn) { if (!btn.dataset.lbl) btn.dataset.lbl = btn.textContent; btn.classList.add('playing'); btn.textContent = '■ Detener'; }
  setTimeout(() => {
    if (id !== playSession) return;
    if (btn) { btn.classList.remove('playing'); btn.textContent = btn.dataset.lbl || '▶'; }
    if (wasRunning) metStart();
  }, (end - ctx.currentTime) * 1000);
}
/* Patrones de rasgueo/arpegio por compás. D = abajo (grave→agudo), U = arriba (agudo→grave). */
function barPattern(kind, midis, beats, at0) {
  const top = n => midis.slice(-n);
  const D = (at, vel, n) => ({ at: at0 + at, midis: n ? top(n) : midis, vel, dir: 'd' });
  const U = (at, vel) => ({ at: at0 + at, midis: top(4).slice().reverse(), vel, strumMs: 28, dir: 'u' });
  const evs = barPatternEvents(kind, midis, beats, at0, D, U, top);
  evs.forEach((e, i) => { e.pi = i; if (!e.dir) e.dir = 'a'; });
  return evs;
}
function barPatternEvents(kind, midis, beats, at0, D, U, top) {
  switch (kind) {
    case 'du': {
      const ev = [];
      for (let b = 0; b < beats; b++) { ev.push(D(b, b === 0 ? 0.95 : 0.6)); ev.push(U(b + 0.5, 0.4)); }
      return ev;
    }
    case 'sync':
      return [D(0, 0.95), D(1, 0.65), U(1.5, 0.45), U(2.5, 0.45), D(3, 0.65), U(3.5, 0.45)];
    case 'b6':
      return [D(0, 0.95), D(1, 0.35, 3), D(2, 0.35, 3), D(3, 0.7), D(4, 0.35, 3), D(5, 0.35, 3)];
    case 'b12': {
      const ev = [];
      for (let b = 0; b < 12; b++) {
        if (b === 0) ev.push(D(0, 0.95));
        else if (b % 3 === 0) ev.push(D(b, 0.6));
        else ev.push(D(b, 0.3, 3));
      }
      return ev;
    }
    case 'arp': {
      const ev = [{ at: at0, midis: [midis[0]], vel: 0.9 }];
      const rest = top(Math.min(3, midis.length - 1));
      for (let b = 1; b < beats; b++) ev.push({ at: at0 + b, midis: [rest[(b - 1) % rest.length]], vel: 0.7 });
      return ev;
    }
    default: {
      const ev = [D(0, 0.95)];
      for (let b = 1; b < beats; b++) ev.push(D(b, 0.4, 3));
      return ev;
    }
  }
}
const PATTERN_NAMES = { du: 'abajo-arriba', sync: 'síncopa', b6: '6/8', b12: '12/8 balada', arp: 'arpegio', pulse: 'pulso' };
function detectPattern(text, sig) {
  if (/p-i-m-a|arpegi/i.test(text)) return 'arp';
  if (/s[ií]ncopa/i.test(text)) return 'sync';
  if (sig === '12/8') return 'b12';
  if (sig === '6/8') return 'b6';
  if (/corchea|abajo-arriba|abajo y arriba/i.test(text)) return 'du';
  return 'pulse';
}

/* ===================== diapasón interactivo ===================== */
const NOTE_LAT = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const NOTE_ANG = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function fretboard(opts) {
  // opts: {maxFret, highlights:[{s,f,label,dim}], onTap(s,f)}
  const maxF = opts.maxFret || 12;
  const NUT = 34, FW = 44, TOP = 16, SH = 18;
  const W = NUT + maxF * FW + 8, H = TOP + 5 * SH + 26;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'fb');
  svg.style.minWidth = Math.min(560, W) + 'px';
  const yFor = s => TOP + (s - 1) * SH;                 // 1ª arriba, 6ª abajo
  const xFor = f => f === 0 ? NUT - 15 : NUT + (f - 0.5) * FW;
  const el = (n, at) => { const e = document.createElementNS(NS, n); for (const k in at) e.setAttribute(k, at[k]); svg.appendChild(e); return e; };
  el('line', { x1: NUT, y1: yFor(1), x2: NUT, y2: yFor(6), class: 'fb-nut' });
  for (let f = 1; f <= maxF; f++) el('line', { x1: NUT + f * FW, y1: yFor(1), x2: NUT + f * FW, y2: yFor(6), class: 'fb-fret' });
  [3, 5, 7, 9, 12].filter(f => f <= maxF).forEach(f => {
    el('circle', { cx: NUT + (f - 0.5) * FW, cy: yFor(3.5), r: f === 12 ? 5 : 4, class: 'fb-dotmark' });
    const t = el('text', { x: NUT + (f - 0.5) * FW, y: H - 6, 'text-anchor': 'middle' }); t.textContent = f;
  });
  for (let s = 1; s <= 6; s++) {
    el('line', { x1: NUT, y1: yFor(s), x2: W - 8, y2: yFor(s), class: 'fb-string', 'stroke-width': 0.8 + s * 0.25 });
    const t = el('text', { x: 4, y: yFor(s) + 3.5 }); t.textContent = s + 'ª';
  }
  const hlIndex = {};
  (opts.highlights || []).forEach(h => {
    const c = el('circle', { cx: xFor(h.f), cy: yFor(h.s), r: 7.5, class: 'fb-note' + (h.dim ? ' dim' : '') });
    hlIndex[h.s + ':' + h.f] = c;
    if (h.label) {
      const t = el('text', { x: xFor(h.f), y: yFor(h.s) + 3.2, 'text-anchor': 'middle', class: 'fb-notelbl' });
      t.textContent = h.label;
    }
  });
  for (let s = 1; s <= 6; s++) {
    for (let f = 0; f <= maxF; f++) {
      const r = el('rect', {
        x: f === 0 ? 0 : NUT + (f - 1) * FW, y: yFor(s) - SH / 2,
        width: f === 0 ? NUT : FW, height: SH, class: 'fb-hit'
      });
      r.addEventListener('click', () => {
        pluck(OPEN_MIDI[s - 1] + f);
        const c = hlIndex[s + ':' + f];
        if (c) { c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 220); }
        if (opts.onTap) opts.onTap(s, f);
      });
    }
  }
  svg.__flash = (s, f) => {
    const c = hlIndex[s + ':' + f];
    if (c) { c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 220); }
  };
  return svg;
}

/* ===================== parser de ejercicios ===================== */
const PROG_SEP = /\s*(?:[-–—→]|->)\s*/;
function findProgression(text) {
  const re = /([A-G][#b]?m?(?:\/[A-G][#b]?)?)((?:\s*(?:[-–—→]|->)\s*[A-G][#b]?m?(?:\/[A-G][#b]?)?)+)/g;
  let best = null, m;
  while ((m = re.exec(text))) {
    const toks = (m[1] + m[2]).split(PROG_SEP);
    if (toks.length >= 2 && toks.every(t => CHORDS[t]) && toks.some(t => t.length > 1)) {
      if (!best || toks.length > best.length) best = toks;
    }
  }
  return best;
}
function parseExercise(ex) {
  const text = ex.textContent.replace(/\s+/g, ' ');
  const bpmM = text.match(/(\d{2,3})\s*BPM/);
  const bpm = bpmM ? +bpmM[1] : null;
  const sigM = text.match(/\b(2\/4|3\/4|4\/4|5\/4|6\/8|12\/8)\b/);
  const sig = sigM ? sigM[1] : null;

  let m = text.match(/(\d)ª cuerda[^.]{0,60}?trastes?\s*(\d+(?:\s*[,y]\s*\d+)+)/i);
  if (m) {
    const s = +m[1];
    const frets = m[2].split(/[^\d]+/).filter(Boolean).map(Number).filter(f => f <= 15);
    if (s >= 1 && s <= 6 && frets.length)
      return { type: 'seq', string: s, frets, bpm, sig, label: `${s}ª cuerda · trastes ${frets.join(', ')}` };
  }
  m = text.match(/trastes?\s*(\d+)\s*[–—-]\s*(\d+)/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (b > a && b - a <= 8 && b <= 15) {
      const sM = text.match(/(\d)ª cuerda/);
      const s = sM ? Math.min(6, Math.max(1, +sM[1])) : 6;
      const frets = []; for (let f = a; f <= b; f++) frets.push(f);
      return { type: 'seq', string: s, frets, bpm, sig, label: `Trastes ${a}–${b} (demo en ${s}ª cuerda)` };
    }
  }
  m = text.match(/(\d)ª\s*(?:cuerda\s*)?al aire/i);
  if (m) {
    const s = +m[1];
    if (s >= 1 && s <= 6)
      return { type: 'seq', string: s, frets: [0, 0, 0, 0], bpm, sig, label: `${s}ª cuerda al aire` };
  }
  const pattern = detectPattern(text, sig);
  const prog = findProgression(text);
  if (prog) return { type: 'prog', chords: prog, bpm, sig, pattern, label: prog.join(' – ') };
  const divChords = [...ex.querySelectorAll('.chord')]
    .map(d => (d.querySelector('b') || {}).textContent).map(n => (n || '').trim()).filter(n => CHORDS[n]);
  if (divChords.length) {
    const uniq = [...new Set(divChords)];
    return { type: 'prog', chords: uniq, bpm, sig, pattern, label: uniq.join(' – ') };
  }
  return null;
}
function specEvents(spec) {
  const beats = SIGS[spec.sig] || metBeats();
  const evs = [];
  if (spec.type === 'seq') {
    const up = spec.frets.map(f => ({ midis: [OPEN_MIDI[spec.string - 1] + f], fb: { s: spec.string, f } }));
    const down = up.slice(0, -1).reverse();
    const seq = spec.frets.length > 2 ? up.concat(down) : up.concat(up);
    seq.forEach((e, i) => evs.push(Object.assign({ at: i, vel: 0.85 }, e)));
  } else {
    spec.chords.forEach((name, ci) => {
      const c = CHORDS[name];
      if (!c) return;
      barPattern(spec.pattern || 'pulse', chordMidis(c.frets), beats, ci * beats).forEach(e => evs.push(e));
    });
  }
  return { events: evs, beats };
}
function buildDemoPanel(ex, spec) {
  const panel = document.createElement('div');
  panel.className = 'demo';
  const row = document.createElement('div');
  row.className = 'demorow';
  const play = document.createElement('button');
  play.className = 'play'; play.textContent = '▶';
  const stop = document.createElement('button');
  stop.className = 'stopbtn'; stop.textContent = '■';
  const label = document.createElement('div');
  label.className = 'demolabel';
  const patTxt = spec.type === 'prog' && spec.pattern && spec.pattern !== 'pulse'
    ? ` · patrón ${PATTERN_NAMES[spec.pattern]}` : '';
  label.textContent = `Demo: ${spec.label}` + (spec.sig ? ` · ${spec.sig}` : '') + patTxt;
  // BPM ajustable por demo (parte del BPM que indica el ejercicio)
  spec.bpm = spec.bpm || 60;
  const bpmBox = document.createElement('div');
  bpmBox.className = 'demobpm';
  bpmBox.innerHTML = `<button class="bdn">−</button><b>${spec.bpm}</b><button class="bup">+</button>`;
  const bpmVal = bpmBox.querySelector('b');
  bpmBox.querySelector('.bdn').addEventListener('click', () => { spec.bpm = Math.max(30, spec.bpm - 5); bpmVal.textContent = spec.bpm; });
  bpmBox.querySelector('.bup').addEventListener('click', () => { spec.bpm = Math.min(200, spec.bpm + 5); bpmVal.textContent = spec.bpm; });
  row.append(play, stop, bpmBox, label);
  panel.append(row);
  // flechas del patrón de rasgueo: ↓ abajo, ↑ arriba, ● nota suelta; se iluminan al sonar
  let arrows = null;
  if (spec.type === 'prog') {
    const beats = SIGS[spec.sig] || 4;
    const patEvs = barPattern(spec.pattern || 'pulse', chordMidis(CHORDS[spec.chords[0]].frets), beats, 0);
    const srow = document.createElement('div');
    srow.className = 'strumrow';
    srow.innerHTML = patEvs.map(e =>
      `<span class="${e.dir}"><i>${e.dir === 'd' ? '↓' : e.dir === 'u' ? '↑' : '●'}</i><small>${
        Number.isInteger(e.at) ? e.at + 1 : '·'}</small></span>`).join('');
    panel.append(srow);
    arrows = [...srow.children];
  }
  let fb = null;
  if (spec.type === 'seq') {
    const wrap = document.createElement('div');
    wrap.className = 'fbwrap';
    const maxF = Math.max(5, Math.min(15, Math.max.apply(null, spec.frets) + 1));
    fb = fretboard({
      maxFret: maxF,
      highlights: spec.frets.map(f => ({ s: spec.string, f }))
    });
    wrap.append(fb);
    panel.append(wrap);
  }
  play.addEventListener('click', () => {
    const { events, beats } = specEvents(spec);
    playEvents(events, spec.bpm || met.bpm, beats, play, (ev) => {
      if (fb && ev.fb) fb.__flash(ev.fb.s, ev.fb.f);
      if (arrows && ev.pi != null && arrows[ev.pi]) {
        arrows.forEach(a => a.classList.remove('hit'));
        arrows[ev.pi].classList.add('hit');
        setTimeout(() => arrows[ev.pi] && arrows[ev.pi].classList.remove('hit'), 260);
      }
    });
  });
  stop.addEventListener('click', stopPlayback);
  const brief = ex.querySelector('.brief');
  (brief || ex).after ? (brief ? brief.after(panel) : ex.append(panel)) : ex.append(panel);
  return panel;
}
function buildDemos(day) {
  if (!day || day.dataset.gcdemo) return;
  day.dataset.gcdemo = '1';
  day.querySelectorAll('.exercise').forEach(ex => {
    try {
      const spec = parseExercise(ex);
      if (spec) buildDemoPanel(ex, spec);
    } catch (e) { window.__gcerr.push('demo: ' + e.message); }
  });
  decorateChords(day);
  injectDayNotes(day);
}

/* ===================== notas personales por día ===================== */
function getNotes() { return load('gc:notes', {}); }
let noteTimer = null;
function saveNote(dayNum, text) {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    const n = getNotes();
    const v = text.trim();
    if (v) n[dayNum] = v; else delete n[dayNum];
    store('gc:notes', n);
  }, 400);
}
function injectDayNotes(day) {
  if (day.querySelector('.daynotes')) { renderRecs(day); return; }
  const n = DAYS.indexOf(day) + 1;
  if (!n) return;
  const wrap = document.createElement('div');
  wrap.className = 'daynotes';
  wrap.innerHTML = '<h4>📝 Mis notas del día</h4><textarea placeholder="Qué costó, qué salió bien, dudas para después…"></textarea><div class="recs"></div>';
  const ta = wrap.querySelector('textarea');
  ta.value = getNotes()[n] || '';
  ta.addEventListener('input', () => saveNote(n, ta.value));
  day.append(wrap);
  renderRecs(day);
}

/* ===================== curso: estado y navegación ===================== */
let DAYS = [];
function currentDayIndex() { return DAYS.findIndex(d => d.classList.contains('active')); }
function gotoDay(i) {
  const sel = document.getElementById('day');
  if (!sel) return;
  i = Math.max(0, Math.min(DAYS.length - 1, i));
  sel.value = i + 1;
  sel.dispatchEvent(new Event('change'));
  const m = document.querySelector('main');
  if (m) m.scrollTop = 0;
}
function doneSet() { return new Set(load('gc:done', [])); }
function isoToday() { return new Date().toISOString().slice(0, 10); }
function markDayDone(n, on) {
  const done = doneSet();
  const dates = load('gc:doneDates', {});
  if (on) { done.add(n); if (!dates[n]) dates[n] = isoToday(); }
  else { done.delete(n); delete dates[n]; }
  store('gc:done', [...done]);
  store('gc:doneDates', dates);
  renderDoneButtons();
  renderHome();
}
// racha: días de calendario consecutivos con al menos un día del curso completado
function streakDays() {
  const dates = new Set(Object.values(load('gc:doneDates', {})));
  if (!dates.size) return 0;
  const d = new Date();
  const iso = x => x.toISOString().slice(0, 10);
  if (!dates.has(iso(d))) d.setDate(d.getDate() - 1); // hoy aún no practica: la racha no se pierde
  let n = 0;
  while (dates.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderDoneButtons() {
  const done = doneSet();
  DAYS.forEach((d, i) => {
    const b = d.querySelector('.daydone');
    if (!b) return;
    const isDone = done.has(i + 1);
    b.classList.toggle('done', isDone);
    b.textContent = isDone ? '✓ Completado' : 'Marcar día ✓';
  });
}
function injectDoneButtons() {
  DAYS.forEach((d, i) => {
    const head = d.querySelector('.dayhead');
    if (!head) return;
    const b = document.createElement('button');
    b.className = 'daydone';
    b.addEventListener('click', () => {
      const n = i + 1, was = doneSet().has(n);
      markDayDone(n, !was);
      if (!was && i < DAYS.length - 1) setTimeout(() => gotoDay(i + 1), 350);
    });
    head.append(b);
  });
  renderDoneButtons();
}
function observeDays() {
  const obs = new MutationObserver(() => {
    const i = currentDayIndex();
    if (i >= 0) {
      store('gc:day', i);
      buildDemos(DAYS[i]);
    }
  });
  DAYS.forEach(d => obs.observe(d, { attributes: true, attributeFilter: ['class'] }));
}

/* ===================== íconos (SVG de trazo, monocromos) ===================== */
const ICONS = (() => {
  const wrap = inner =>
    `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  return {
    home: wrap('<path d="M3 10.2 12 3l9 7.2"/><path d="M5 8.8V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.8"/><path d="M9.5 21v-6h5v6"/>'),
    book: wrap('<path d="M12 6.5A4.5 4.5 0 0 0 7.5 2H2v16h6a4 4 0 0 1 4 4"/><path d="M12 6.5A4.5 4.5 0 0 1 16.5 2H22v16h-6a4 4 0 0 0-4 4"/><path d="M12 6.5V22"/>'),
    music: wrap('<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M9 18V5.5L21 3v13"/>'),
    gauge: wrap('<path d="M3.4 19a10 10 0 1 1 17.2 0"/><path d="m12 14 3.6-3.6"/><circle cx="12" cy="14" r="1" fill="currentColor"/>'),
    chords: wrap('<path d="M7 3v18M12 3v18M17 3v18"/><path d="M4 8h16M4 15h16"/><circle cx="12" cy="11.5" r="2.1" fill="currentColor" stroke="none"/>'),
    metronome: wrap('<path d="M9.2 3h5.6L19 21H5z"/><path d="M5.9 16.5h12.2"/><path d="m12 16.5 5-9.5"/>'),
    chart: wrap('<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-9"/>'),
    mail: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
    mic: wrap('<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>'),
    up: wrap('<path d="M12 15V4"/><path d="m7 8.5 5-4.5 5 4.5"/><path d="M4 20h16"/>'),
    down: wrap('<path d="M12 4v11"/><path d="m7 10.5 5 4.5 5-4.5"/><path d="M4 20h16"/>'),
    stop: wrap('<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>')
  };
})();

/* ===================== vistas / pestañas ===================== */
function setView(v) {
  if (document.body.dataset.view === 'tuner' && v !== 'tuner') {
    tunerStop();
    const b = document.querySelector('#view-tuner .tunon');
    if (b) b.innerHTML = `${ICONS.mic} Activar micrófono`;
  }
  document.body.dataset.view = v;
  if (v === 'hoy') renderHome();
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  const m = document.querySelector('main');
  if (m) m.scrollTop = 0;
}
function injectTabbar() {
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  [['hoy', ICONS.home, 'Hoy'], ['curso', ICONS.book, 'Curso'], ['songs', ICONS.music, 'Canciones'],
   ['tuner', ICONS.gauge, 'Afinador'], ['ref', ICONS.chords, 'Referencia']].forEach(([v, ico, lbl]) => {
    const b = document.createElement('button');
    b.dataset.view = v;
    b.innerHTML = `<span class="ico">${ico}</span>${lbl}`;
    b.addEventListener('click', () => setView(v));
    bar.append(b);
  });
  document.body.append(bar);
}

/* ===================== metrónomo: UI ===================== */
function injectMetronome() {
  const fab = document.createElement('button');
  fab.className = 'metfab';
  fab.innerHTML = ICONS.metronome;
  fab.setAttribute('aria-label', 'Metrónomo');
  const panel = document.createElement('div');
  panel.className = 'metpanel';
  panel.innerHTML = `
    <h4>Metrónomo</h4>
    <div class="metrow">
      <button id="bpmdn">−</button>
      <input id="metslider" type="range" min="30" max="200" step="1" value="${met.bpm}">
      <button id="bpmup">+</button>
    </div>
    <div class="metrow"><span class="bpmval">${met.bpm}</span><span style="color:var(--muted);font-size:13px">BPM</span>
      <select id="metsig">${Object.keys(SIGS).map(s => `<option${s === met.sig ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    <div class="metrow"><button class="metstart" aria-label="Iniciar/detener">▶</button><button class="mettap">TAP</button></div>
    <div class="metprog">
      <label><input type="checkbox" id="mpon"${met.prog.on ? ' checked' : ''}> Progresivo</label>
      <span>hasta <input id="mpto" type="number" min="30" max="200" value="${met.prog.to}"> ·
      +<input id="mpstep" type="number" min="1" max="20" value="${met.prog.step}"> cada
      <input id="mpbars" type="number" min="1" max="32" value="${met.prog.bars}"> comp.</span>
    </div>
    <div class="metbeat"></div>`;
  document.body.append(fab, panel);
  fab.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelector('#metslider').addEventListener('input', e => { met.bpm = +e.target.value; metSave(); metUI(); });
  panel.querySelector('#bpmdn').addEventListener('click', () => { met.bpm = Math.max(30, met.bpm - 5); metSave(); metUI(); });
  panel.querySelector('#bpmup').addEventListener('click', () => { met.bpm = Math.min(200, met.bpm + 5); metSave(); metUI(); });
  panel.querySelector('#metsig').addEventListener('change', e => { met.sig = e.target.value; metSave(); metUI(); });
  panel.querySelector('.metstart').addEventListener('click', () => { met.on ? metStop() : metStart(); });
  panel.querySelector('#mpon').addEventListener('change', e => { met.prog.on = e.target.checked; met.lastBump = 0; metSave(); });
  [['#mpto', 'to', 30, 200], ['#mpstep', 'step', 1, 20], ['#mpbars', 'bars', 1, 32]].forEach(([id, k, lo, hi]) => {
    panel.querySelector(id).addEventListener('change', e => {
      met.prog[k] = Math.max(lo, Math.min(hi, +e.target.value || lo));
      e.target.value = met.prog[k];
      metSave();
    });
  });
  // tap tempo: promedio de los últimos toques
  let taps = [];
  panel.querySelector('.mettap').addEventListener('click', () => {
    const now = performance.now();
    taps = taps.filter(t => now - t < 3000);
    taps.push(now);
    if (taps.length >= 2) {
      const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      met.bpm = Math.max(30, Math.min(200, Math.round(60000 / iv)));
      metSave(); metUI();
    }
  });
  metUI();
}

/* ===================== canciones ===================== */
const SEED_SONGS = [
  {
    id: 'perfect', title: 'Perfect — Ed Sheeran',
    meta: 'Objetivo del curso · 12/8 · acordes abiertos con dedos ancla',
    body: 'G  Em  C  D\n\n(progresión típica de la canción; verifícala con tu hoja de\nletra/acordes obtenida legalmente y pégala aquí con "Editar")'
  },
  {
    id: 'surge', title: 'Surge Valentía',
    meta: 'Objetivo del curso · loop del curso: Em–C–G–D · aparece Bm',
    body: 'Em  C  G  D\nBm\n\n(pega aquí tu hoja de letra/acordes con "Editar")'
  },
  {
    id: 'father', title: 'Father and Son — Cat Stevens',
    meta: 'Objetivo del curso · se aborda al final: Bm, D/F# y cambios de intensidad',
    body: 'G  C  D  Em  Am  Bm  D/F#\n\n(acordes que usa la canción; pega aquí tu hoja de\nletra/acordes obtenida legalmente con "Editar")'
  }
];
const CHTOK_RE = /^[A-G][#b]?(?:m|maj7|maj9|m7|m9|m11|7|9|11|13|6|sus2|sus4|add9|dim|aug|5)*(?:\/[A-G][#b]?)?$/;
const DECOR_RE = /^(\||:|·|—|–|-|x\d+|\(|\)|\d+x|%)$/i;
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  let real = 0;
  for (const t of toks) {
    if (CHTOK_RE.test(t)) real++;
    else if (!DECOR_RE.test(t)) return false;
  }
  return real > 0;
}
function renderSongBody(body) {
  return body.split('\n').map(line => {
    if (isChordLine(line)) {
      const html = line.split(/(\s+)/).map(part =>
        CHTOK_RE.test(part) ? `<span class="chtok" data-ch="${esc(part)}">${esc(part)}</span>` : esc(part)
      ).join('');
      return `<div class="chline">${html}</div>`;
    }
    return `<div>${esc(line) || '&nbsp;'}</div>`;
  }).join('');
}
function getSongs() { return load('gc:songs', null) || SEED_SONGS.map(s => Object.assign({}, s)); }
function saveSongs(songs) { store('gc:songs', songs); }
function songChordSeq(body) {
  const seq = [];
  body.split('\n').forEach(l => {
    if (isChordLine(l)) l.trim().split(/\s+/).forEach(t => { if (CHTOK_RE.test(t)) seq.push(t); });
  });
  return seq;
}
function buildSongsView() {
  const view = document.createElement('section');
  view.id = 'view-songs';
  view.className = 'view';
  document.querySelector('main').append(view);
  renderSongs();
}
function renderSongs() {
  const view = document.getElementById('view-songs');
  const songs = getSongs();
  view.innerHTML = `<div class="eyebrow">Canciones</div><h2>Letras y acordes</h2>
    <div class="songhint">
      <p><b>Cómo funciona esta vista</b></p>
      <ul>
        <li>Cada hoja muestra los <b>acordes en su propia línea</b>, encima de la sílaba de la letra
        donde cambian — el formato clásico de los cancioneros.</li>
        <li><b>Toca cualquier acorde</b> de la hoja (G, Em, C…) para oír cómo suena.</li>
        <li><b>«▶ Progresión»</b> toca todos los acordes de la canción seguidos, un compás cada uno,
        al tempo que tenga el metrónomo. Mientras suena, el mismo botón pasa a <b>«■ Detener»</b>:
        tócalo para parar.</li>
        <li><b>«Editar»</b> abre la hoja como texto: la primera línea es el título, la segunda una
        descripción, luego una línea con <code>---</code>, y debajo la hoja (línea de acordes arriba,
        línea de letra abajo, alternadas). <b>«Guardar»</b> aplica los cambios.</li>
        <li>El curso no incluye las letras por derechos de autor: pega tú la letra desde una hoja
        obtenida legalmente y escribe los acordes en la línea de arriba.</li>
      </ul>
    </div>
    <p><button id="songnew">+ Nueva canción</button></p>`;
  songs.forEach((song, idx) => {
    const card = document.createElement('div');
    card.className = 'songcard';
    card.innerHTML = `<h3>${esc(song.title)}</h3><div class="songmeta">${esc(song.meta || '')}</div>
      <div class="songbody">${renderSongBody(song.body)}</div>
      <div class="songactions">
        <button class="play sngplay">▶ Progresión</button>
        <button class="ghost sngedit">Editar</button>
        <button class="danger sngdel">Borrar</button>
      </div>`;
    card.querySelector('.sngplay').addEventListener('click', e => {
      const seq = songChordSeq(song.body);
      if (!seq.length) return;
      const beats = metBeats();
      const evs = [];
      let bar = 0;
      seq.forEach(name => {
        const c = CHORDS[name] || CHORDS[baseChordName(name)];
        if (!c) return;
        barPattern('pulse', chordMidis(c.frets), beats, bar * beats).forEach(ev => evs.push(ev));
        bar++;
      });
      playEvents(evs, met.bpm, beats, e.target);
    });
    card.querySelector('.sngedit').addEventListener('click', () => {
      if (card.querySelector('.songedit')) return;
      const ta = document.createElement('textarea');
      ta.className = 'songedit';
      ta.value = song.title + '\n' + (song.meta || '') + '\n---\n' + song.body;
      const save = document.createElement('button');
      save.textContent = 'Guardar';
      save.style.marginTop = '7px';
      save.addEventListener('click', () => {
        const parts = ta.value.split('\n---\n');
        const head = parts[0].split('\n');
        song.title = head[0] || song.title;
        song.meta = head.slice(1).join(' ');
        song.body = parts.slice(1).join('\n---\n') || '';
        const all = getSongs(); all[idx] = song; saveSongs(all); renderSongs();
      });
      card.append(ta, save);
    });
    card.querySelector('.sngdel').addEventListener('click', e => {
      if (e.target.dataset.arm) {
        const all = getSongs(); all.splice(idx, 1); saveSongs(all); renderSongs();
      } else {
        e.target.dataset.arm = '1';
        e.target.textContent = '¿Borrar de verdad?';
        setTimeout(() => { e.target.dataset.arm = ''; e.target.textContent = 'Borrar'; }, 2500);
      }
    });
    view.append(card);
  });
  view.querySelector('#songnew').addEventListener('click', () => {
    const all = getSongs();
    all.unshift({ id: 'song' + Date.now(), title: 'Nueva canción', meta: '', body: 'G  D  Em  C\nEscribe o pega aquí la letra…' });
    saveSongs(all);
    renderSongs();
  });
}

/* ===================== referencia ===================== */
const LAT2ANG = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };
function buildRefView() {
  const view = document.createElement('section');
  view.id = 'view-ref';
  view.className = 'view';
  view.innerHTML = `<div class="eyebrow">Referencia</div><h2>Acordes y notas</h2>
    <div class="refblock" style="border:none;margin-top:6px;padding-top:0">
      <h3>Acordes del curso</h3>
      <p class="legend">Toca un diagrama para oírlo. Busca por nombre (C, Am, F…) o en latino (do, sol…).</p>
      <input class="refsearch" id="chsearch" type="search" placeholder="Buscar acorde…">
      <div class="refchords" id="chgrid"></div>
    </div>
    <div class="refblock">
      <h3>¿Te sale el acorde? <small class="beta">beta</small></h3>
      <p class="legend">Elige un acorde, toca «Probar» y rasguéalo una vez, fuerte y cerca del teléfono.
      La app escucha ~3 segundos y te dice si sonaron todas sus notas (una nota ausente suele ser
      una cuerda muteada por un dedo mal apoyado).</p>
      <div class="ccrow"><select id="ccsel"></select><button id="ccgo">🎙 Probar</button></div>
      <div class="ccout"></div>
    </div>
    <div class="refblock">
      <h3>¿Dónde está cada nota?</h3>
      <p class="legend">Elige una nota y mira todas sus posiciones hasta el traste 12. Toca el diapasón para oírla.</p>
      <div class="notebtns" id="notebtns"></div>
      <div class="fbwrap" id="notefb"></div>
    </div>
    <div class="refblock">
      <h3>Respaldo de tu progreso</h3>
      <p class="legend">Días completados, notas, canciones, récords y ajustes. Exporta el archivo y
      guárdalo (o envíatelo); impórtalo en otro dispositivo para seguir donde ibas.
      Las grabaciones de audio no viajan en el respaldo (viven solo en este dispositivo).</p>
      <div class="bakrow">
        <button id="bakexp">${ICONS.up} Exportar respaldo</button>
        <button id="bakimp" class="ghost">${ICONS.down} Importar respaldo</button>
        <input id="bakfile" type="file" accept="application/json,.json" hidden>
      </div>
    </div>`;
  document.querySelector('main').append(view);
  const ccsel = view.querySelector('#ccsel');
  ccsel.innerHTML = Object.keys(CHORDS).sort().map(n => `<option>${n}</option>`).join('');
  const ccgo = view.querySelector('#ccgo');
  ccgo.addEventListener('click', () => {
    ccgo.disabled = true;
    chordCheck(ccsel.value, view.querySelector('.ccout')).finally(() => { ccgo.disabled = false; });
  });
  view.querySelector('#bakexp').addEventListener('click', exportProgress);
  view.querySelector('#bakimp').addEventListener('click', () => view.querySelector('#bakfile').click());
  view.querySelector('#bakfile').addEventListener('change', e => importProgress(e.target));

  const grid = view.querySelector('#chgrid');
  const names = Object.keys(CHORDS).sort();
  names.forEach(name => {
    const src = CHORDS[name].sample;
    const div = document.createElement('div');
    div.className = 'chord';
    div.dataset.refname = name.toLowerCase();
    div.innerHTML = src;
    grid.append(div);
  });
  decorateChords(grid);
  view.querySelector('#chsearch').addEventListener('input', e => {
    let q = e.target.value.trim().toLowerCase();
    const lat = Object.keys(LAT2ANG).sort((a, b) => b.length - a.length).find(l => q.startsWith(l));
    if (lat) q = (LAT2ANG[lat] + q.slice(lat.length)).toLowerCase();
    grid.querySelectorAll('.chord').forEach(d => {
      d.style.display = !q || d.dataset.refname.startsWith(q) ? '' : 'none';
    });
  });

  const btns = view.querySelector('#notebtns');
  NOTE_LAT.forEach((lat, pc) => {
    const b = document.createElement('button');
    b.textContent = `${lat} · ${NOTE_ANG[pc]}`;
    b.addEventListener('click', () => {
      btns.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderNoteFB(pc);
    });
    btns.append(b);
  });
  function renderNoteFB(pc) {
    const wrap = view.querySelector('#notefb');
    wrap.innerHTML = '';
    const hl = [];
    for (let s = 1; s <= 6; s++) {
      for (let f = 0; f <= 12; f++) {
        if ((OPEN_MIDI[s - 1] + f) % 12 === ((pc + 60) % 12)) hl.push({ s, f, label: NOTE_ANG[pc] });
      }
    }
    wrap.append(fretboard({ maxFret: 12, highlights: hl }));
  }
  renderNoteFB(0);
  btns.querySelector('button').classList.add('active');
}

/* ===================== modo sesión (un ejercicio a la vez) ===================== */
const session = { open: false, dayIdx: 0, exs: [], idx: 0, ph: null, el: null,
  total: 0, remaining: 0, running: false, timer: null, wakeLock: null };

function exMinutes(ex) {
  const small = ex.querySelector('.exhead small');
  const m = small && small.textContent.match(/(\d+)\s*min/);
  return m ? +m[1] : null;
}
function exBpm(ex) {
  const m = ex.textContent.match(/(\d{2,3})\s*BPM/);
  return m ? +m[1] : null;
}
function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function chime() {
  audio();
  const t0 = ctx.currentTime + 0.05;
  for (let r = 0; r < 3; r++) {
    [76, 83, 88].forEach((m, i) => pluck(m, t0 + r * 0.55 + i * 0.09, 0.8));
  }
}
async function sessionWakeLock() {
  try { session.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (session.open && document.visibilityState === 'visible') sessionWakeLock();
});

function startSession(dayIdx) {
  if (session.open) return;
  const day = DAYS[dayIdx];
  buildDemos(day);
  session.open = true;
  session.dayIdx = dayIdx;
  session.exs = [...day.querySelectorAll('.exercise')];
  session.idx = 0;
  document.body.classList.add('insession');

  const eyebrow = day.querySelector('.eyebrow');
  const ov = document.createElement('div');
  ov.className = 'session';
  ov.innerHTML = `
    <header class="sesshead">
      <button class="sessclose" aria-label="Cerrar">✕</button>
      <div class="sesstitle"><b></b><small>${esc(eyebrow ? eyebrow.textContent : '')}</small></div>
      <div class="sesstime">--:--</div>
    </header>
    <div class="sessdots">${session.exs.map(() => '<i></i>').join('')}</div>
    <div class="sesscontent"></div>
    <div class="sessbanner"><span>⏰ ¡Tiempo!</span>
      <button class="bnrepeat">🔁 Repetir</button><button class="bnnext">Siguiente →</button></div>
    <div class="miccount" hidden>
      <button class="mcbig">0</button>
      <div class="mcinfo">
        <span class="mcstate">🎤 escuchando…</span>
        <span class="mctempo"></span>
        <small>Cuenta cada golpe que oye · si paras de tocar ~1 s, vuelve a 0 · tócalo para reiniciar</small>
      </div>
    </div>
    <div class="sessbpm">
      <button class="sbmic" aria-label="Contador de golpes por micrófono">🎤<small>Contar</small></button>
      <button class="sbdn" aria-label="Bajar tempo">−5</button>
      <span class="sbval"></span>
      <button class="sbup" aria-label="Subir tempo">+5</button>
    </div>
    <footer class="sessfoot">
      <button class="sessprev" aria-label="Anterior">←</button>
      <button class="sesstimerbtn">▶ Empezar</button>
      <button class="sessmet" aria-label="Metrónomo">${ICONS.metronome}</button>
      <button class="sessrec" aria-label="Grabarme"><span class="recdot"></span><small>Grabar</small></button>
      <button class="sessnext" aria-label="Siguiente">→</button>
    </footer>`;
  document.body.append(ov);
  session.el = ov;
  session.ph = document.createComment('gc-ex');

  ov.querySelector('.sessclose').addEventListener('click', closeSession);
  ov.querySelector('.sessprev').addEventListener('click', () => showSessionEx(session.idx - 1));
  ov.querySelector('.sessnext').addEventListener('click', () => showSessionEx(session.idx + 1));
  ov.querySelector('.bnnext').addEventListener('click', () => showSessionEx(session.idx + 1));
  ov.querySelector('.bnrepeat').addEventListener('click', () => { clearTimeUp(); resetTimer(true); });
  ov.querySelector('.sesstimerbtn').addEventListener('click', () => {
    if (session.total == null) return;
    session.running ? pauseTimer() : runTimer();
  });
  ov.querySelector('.sessmet').addEventListener('click', () => {
    met.on ? metStop() : metStart();
    sessionMetUI();
  });
  ov.querySelector('.sessrec').addEventListener('click', e => recToggle(e.target.closest('.sessrec')));
  const mcPanel = ov.querySelector('.miccount'), mcBig = ov.querySelector('.mcbig'),
    mcState = ov.querySelector('.mcstate'), mcTempo = ov.querySelector('.mctempo');
  ov.querySelector('.sbmic').addEventListener('click', async e => {
    const b = e.target.closest('.sbmic');
    if (mic.on) { micStop(); b.classList.remove('on'); mcPanel.hidden = true; return; }
    const ok = await micStart();
    if (!ok) { mcState.textContent = 'Sin acceso al micrófono'; return; }
    b.classList.add('on'); mcPanel.hidden = false;
    mcBig.textContent = '0'; mcTempo.textContent = '';
    mic.onCount = n => {
      mcBig.textContent = n;
      mcBig.classList.remove('pop'); void mcBig.offsetWidth; mcBig.classList.add('pop');
      mcState.textContent = '🎤 escuchando…';
    };
    mic.onReset = () => {
      mcBig.textContent = '0'; mcTempo.textContent = '';
      mcState.textContent = '↺ silencio: de nuevo desde 0';
      mcBig.classList.add('zeroed'); setTimeout(() => mcBig.classList.remove('zeroed'), 600);
    };
    mic.onTempo = (v, pct) => { mcTempo.textContent = v + ' · ' + pct + '% en el clic'; };
  });
  mcBig.addEventListener('click', () => { mic.count = 0; mic.offsets = []; mcBig.textContent = '0'; mcTempo.textContent = ''; });
  ov.querySelector('.sbdn').addEventListener('click', () => { met.bpm = Math.max(30, met.bpm - 5); metSave(); metUI(); sessionMetUI(); });
  ov.querySelector('.sbup').addEventListener('click', () => { met.bpm = Math.min(200, met.bpm + 5); metSave(); metUI(); sessionMetUI(); });
  sessionMetUI();
  sessionWakeLock();
  showSessionEx(0);
}
function sessionMetUI() {
  if (!session.el) return;
  const b = session.el.querySelector('.sessmet');
  if (b) b.classList.toggle('on', met.on);
  session.el.classList.toggle('meton', met.on);
  const v = session.el.querySelector('.sbval');
  if (v) v.textContent = met.bpm + ' BPM';
}
function returnExercise() {
  if (session.ph && session.ph.parentNode && session.exs[session.idx]) {
    session.ph.replaceWith(session.exs[session.idx]);
  }
}
function clearTimeUp() {
  session.el.classList.remove('timeup');
}
function stopTimer() {
  if (session.timer) { clearInterval(session.timer); session.timer = null; }
  session.running = false;
}
function pauseTimer() {
  stopTimer();
  updateTimerUI();
}
function runTimer() {
  if (session.remaining <= 0) session.remaining = session.total * 60;
  session.running = true;
  updateTimerUI();
  session.timer = setInterval(() => {
    session.remaining--;
    updateTimerUI();
    if (session.remaining <= 0) {
      stopTimer();
      metStop(); sessionMetUI();
      stopPlayback();
      chime();
      session.el.classList.add('timeup');
      updateTimerUI();
    }
  }, 1000);
}
function resetTimer(andRun) {
  stopTimer();
  session.remaining = session.total != null ? session.total * 60 : 0;
  updateTimerUI();
  if (andRun && session.total != null) runTimer();
}
function updateTimerUI() {
  if (!session.el) return;
  const timeEl = session.el.querySelector('.sesstime');
  const btn = session.el.querySelector('.sesstimerbtn');
  if (session.total == null) {
    timeEl.textContent = '';
    btn.style.display = 'none';
    return;
  }
  btn.style.display = '';
  timeEl.textContent = fmtTime(session.remaining);
  btn.textContent = session.running ? '⏸ Pausa' : (session.remaining < session.total * 60 && session.remaining > 0 ? '▶ Seguir' : '▶ Empezar');
  timeEl.classList.toggle('running', session.running);
}
function showSessionEx(i) {
  stopTimer();
  stopPlayback();
  clearTimeUp();
  returnExercise();
  if (i >= session.exs.length) { showSessionEnd(); return; }
  session.idx = Math.max(0, Math.min(session.exs.length - 1, i));
  const ex = session.exs[session.idx];
  const content = session.el.querySelector('.sesscontent');
  content.innerHTML = '';
  ex.parentNode.insertBefore(session.ph, ex);
  content.append(ex);
  content.scrollTop = 0;
  session.el.querySelector('.sesstitle b').textContent = `Ejercicio ${session.idx + 1} de ${session.exs.length}`;
  session.el.querySelectorAll('.sessdots i').forEach((d, k) =>
    d.className = k < session.idx ? 'past' : k === session.idx ? 'cur' : '');
  session.el.querySelector('.sessprev').disabled = session.idx === 0;
  session.el.querySelector('.sessnext').textContent = session.idx === session.exs.length - 1 ? '✓' : '→';
  session.total = exMinutes(ex);
  session.remaining = session.total != null ? session.total * 60 : 0;
  const bpm = exBpm(ex);
  if (bpm) { met.bpm = bpm; metSave(); metUI(); }
  sessionMetUI();
  updateTimerUI();
}
function showSessionEnd() {
  returnExercise();
  session.idx = session.exs.length;
  const content = session.el.querySelector('.sesscontent');
  content.innerHTML = `<div class="sessdone"><div style="font-size:52px">🎸</div>
    <h2>Sesión terminada</h2><p>Completaste los ${session.exs.length} ejercicios de hoy.</p>
    <div class="sessrate"><span>¿Cómo estuvo?</span>
      <button data-r="f">😌 Fácil</button><button data-r="n">🙂 Normal</button><button data-r="d">😅 Difícil</button></div>
    <p class="legend">Con esto la app te propone repasos: lo difícil vuelve antes.</p>
    <textarea class="sessnotes" placeholder="📝 Notas del día: qué costó, qué salió bien…"></textarea>
    <button class="sessfinish">✓ Marcar día completado</button></div>`;
  const n = session.dayIdx + 1;
  const diff = load('gc:diff', {});
  content.querySelectorAll('.sessrate button').forEach(b => {
    b.classList.toggle('sel', diff[n] === b.dataset.r);
    b.addEventListener('click', () => {
      diff[n] = b.dataset.r;
      store('gc:diff', diff);
      content.querySelectorAll('.sessrate button').forEach(x => x.classList.toggle('sel', x === b));
    });
  });
  const ta = content.querySelector('.sessnotes');
  ta.value = getNotes()[session.dayIdx + 1] || '';
  ta.addEventListener('input', () => saveNote(session.dayIdx + 1, ta.value));
  session.el.querySelector('.sesstitle b').textContent = 'Fin de la sesión';
  session.el.querySelectorAll('.sessdots i').forEach(d => { d.className = 'past'; });
  session.total = null;
  updateTimerUI();
  content.querySelector('.sessfinish').addEventListener('click', () => {
    markDayDone(session.dayIdx + 1, true);
    closeSession();
    if (session.dayIdx < DAYS.length - 1) gotoDay(session.dayIdx + 1);
  });
}
function closeSession() {
  if (!session.open) return;
  stopTimer();
  stopPlayback();
  metStop();
  if (rec.mr) rec.mr.stop();
  if (mic.on) micStop();
  if (session.idx < session.exs.length) returnExercise();
  if (session.wakeLock) { try { session.wakeLock.release(); } catch (e) {} session.wakeLock = null; }
  session.el.remove();
  session.el = null;
  session.open = false;
  document.body.classList.remove('insession');
}
function injectSessionButtons() {
  DAYS.forEach((d, i) => {
    const head = d.querySelector('.dayhead');
    if (!head) return;
    const b = document.createElement('button');
    b.className = 'sessgo';
    b.textContent = '▶ Iniciar sesión';
    b.addEventListener('click', () => startSession(i));
    head.append(b);
  });
}

/* ===================== calendario de progreso ===================== */
function openProgress() {
  if (document.querySelector('.progmodal')) return;
  const done = doneSet();
  const cur = currentDayIndex();
  const ov = document.createElement('div');
  ov.className = 'progmodal';
  let cells = '';
  for (let n = 1; n <= DAYS.length; n++) {
    const cls = (done.has(n) ? 'done' : '') + (n === cur + 1 ? ' cur' : '');
    cells += `<i class="${cls.trim()}" data-n="${n}" title="Día ${n}"></i>`;
  }
  ov.innerHTML = `<div class="progcard">
    <button class="progclose" aria-label="Cerrar">✕</button>
    <h3>Tu progreso</h3>
    <div class="progstats">
      <div><b>${done.size}</b><span>de ${DAYS.length} días</span></div>
      <div><b>${Math.round(done.size / DAYS.length * 100)}%</b><span>del curso</span></div>
      <div><b>🔥 ${streakDays()}</b><span>racha (días)</span></div>
    </div>
    <div class="proggrid">${cells}</div>
    <p class="legend">Verde = completado · anillo = día actual. Toca un día para ir a él.</p>
  </div>`;
  document.body.append(ov);
  ov.addEventListener('click', e => {
    if (e.target === ov || e.target.closest('.progclose')) { ov.remove(); return; }
    const cell = e.target.closest('.proggrid i');
    if (cell) { ov.remove(); setView('curso'); gotoDay(+cell.dataset.n - 1); }
  });
}

/* ===================== afinador (micrófono, estilo GuitarTuna) ===================== */
const TUNER_STRINGS = [
  { n: '6ª', note: 'Mi · E2', f: 82.41, midi: 40 },
  { n: '5ª', note: 'La · A2', f: 110.00, midi: 45 },
  { n: '4ª', note: 'Re · D3', f: 146.83, midi: 50 },
  { n: '3ª', note: 'Sol · G3', f: 196.00, midi: 55 },
  { n: '2ª', note: 'Si · B3', f: 246.94, midi: 59 },
  { n: '1ª', note: 'Mi · E4', f: 329.63, midi: 64 }
];
const tuner = { on: false, stream: null, an: null, raf: null, buf: null, lock: -1, okSince: 0, dinged: false };

// autocorrelación (ACF2+) sobre la señal en el tiempo
function detectPitch(buf, sr) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.008) return -1; // silencio
  let a = 0, b = buf.length - 1;
  const th = 0.2;
  for (let i = 0; i < buf.length / 2; i++) if (Math.abs(buf[i]) < th) { a = i; break; }
  for (let i = 1; i < buf.length / 2; i++) if (Math.abs(buf[buf.length - i]) < th) { b = buf.length - i; break; }
  const sig = buf.slice(a, b);
  const N = sig.length;
  if (N < 256) return -1;
  const c = new Float32Array(N);
  for (let lag = 0; lag < N; lag++) {
    let s = 0;
    for (let i = 0; i < N - lag; i++) s += sig[i] * sig[i + lag];
    c[lag] = s;
  }
  let d = 0;
  while (d < N - 1 && c[d] > c[d + 1]) d++;
  let maxv = -1, maxp = -1;
  for (let i = d; i < N; i++) if (c[i] > maxv) { maxv = c[i]; maxp = i; }
  if (maxp <= 0) return -1;
  let T = maxp;
  const x1 = c[T - 1], x2 = c[T], x3 = c[T + 1] || 0;
  const A = (x1 + x3 - 2 * x2) / 2, B = (x3 - x1) / 2;
  if (A) T = T - B / (2 * A);
  const f = sr / T;
  return (f > 60 && f < 500) ? f : -1;
}
async function tunerStart() {
  if (tuner.on) return true;
  const view = document.getElementById('view-tuner');
  tuner.stream = await getMicStream();
  if (!tuner.stream) {
    view.querySelector('.tunerr').textContent =
      'Sin acceso al micrófono. Autorízalo en Ajustes → Safari → Micrófono (y usa HTTPS). ' +
      'Mientras tanto puedes afinar de oído con los botones de cada cuerda.';
    return false;
  }
  audio();
  const src = ctx.createMediaStreamSource(tuner.stream);
  tuner.an = ctx.createAnalyser();
  tuner.an.fftSize = 4096;
  src.connect(tuner.an);
  tuner.buf = new Float32Array(tuner.an.fftSize);
  tuner.on = true;
  tuner.lastAt = 0;
  view.classList.remove('stale');
  view.querySelector('.tunerr').textContent = '';
  tunerLoop();
  return true;
}
function tunerStop() {
  tuner.on = false;
  if (tuner.raf) cancelAnimationFrame(tuner.raf);
  if (tuner.stream) { tuner.stream.getTracks().forEach(t => t.stop()); tuner.stream = null; }
  tuner.an = null;
}
function tunerLoop() {
  if (!tuner.on) return;
  tuner.raf = requestAnimationFrame(tunerLoop);
  if (tuner.an.getFloatTimeDomainData) tuner.an.getFloatTimeDomainData(tuner.buf);
  else {
    const b = new Uint8Array(tuner.an.fftSize);
    tuner.an.getByteTimeDomainData(b);
    for (let i = 0; i < b.length; i++) tuner.buf[i] = (b[i] - 128) / 128;
  }
  const f = detectPitch(tuner.buf, ctx.sampleRate);
  renderTuner(f);
}
function renderTuner(f) {
  const view = document.getElementById('view-tuner');
  const needle = view.querySelector('.needle');
  const noteEl = view.querySelector('.tunnote');
  const centsEl = view.querySelector('.tuncents');
  const gauge = view.querySelector('.tungauge');
  if (f < 0) {
    tuner.okSince = 0; tuner.dinged = false;
    // sin señal: la última lectura queda pegada hasta el próximo sonido;
    // tras 1 s se atenúa para indicar que es una lectura retenida
    if (tuner.lastAt) {
      if (performance.now() - tuner.lastAt > 1000) view.classList.add('stale');
      return;
    }
    noteEl.textContent = '—';
    centsEl.textContent = 'toca una cuerda';
    needle.style.transform = 'rotate(0deg)';
    gauge.classList.remove('intune');
    return;
  }
  tuner.lastAt = performance.now();
  view.classList.remove('stale');
  let si = tuner.lock;
  if (si < 0) { // AUTO: cuerda más cercana
    let bd = 1e9;
    TUNER_STRINGS.forEach((s, i) => {
      const d = Math.abs(Math.log2(f / s.f));
      if (d < bd) { bd = d; si = i; }
    });
  }
  const target = TUNER_STRINGS[si];
  const cents = Math.round(1200 * Math.log2(f / target.f));
  const cl = Math.max(-50, Math.min(50, cents));
  needle.style.transform = `rotate(${cl * 0.9}deg)`; // ±50 cents → ±45°
  noteEl.textContent = target.n + ' ' + target.note.split(' · ')[0];
  centsEl.textContent = (cents > 0 ? '+' : '') + cents + ' cents' + (Math.abs(cents) <= 5 ? ' ✓' : cents < 0 ? ' · sube' : ' · baja');
  const ok = Math.abs(cents) <= 5;
  gauge.classList.toggle('intune', ok);
  view.querySelectorAll('.tunstr button').forEach((b, i) =>
    b.classList.toggle('near', i === si));
  if (ok) {
    if (!tuner.okSince) tuner.okSince = performance.now();
    if (!tuner.dinged && performance.now() - tuner.okSince > 600) {
      tuner.dinged = true;
      pluck(target.midi + 24, 0, 0.5);
    }
  } else { tuner.okSince = 0; tuner.dinged = false; }
}
function buildTunerView() {
  const view = document.createElement('section');
  view.id = 'view-tuner';
  view.className = 'view';
  view.innerHTML = `<div class="eyebrow">Afinador</div><h2>Afinación estándar</h2>
    <p class="legend">Toca una cuerda al aire y ajusta la clavija hasta que la aguja quede verde
    al centro. AUTO detecta la cuerda sola; o fija una con su botón (también la hace sonar de referencia).</p>
    <div class="tungauge">
      <div class="tunscale"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="needle"></div>
      <div class="tunnote">—</div>
      <div class="tuncents">activa el micrófono</div>
    </div>
    <p style="text-align:center"><button class="tunon">${ICONS.mic} Activar micrófono</button></p>
    <div class="tunerr"></div>
    <div class="tunstr">
      <button data-i="-1" class="auto active">AUTO</button>
      ${TUNER_STRINGS.map((s, i) => `<button data-i="${i}">${s.n}<small>${s.note}</small></button>`).join('')}
    </div>`;
  document.querySelector('main').append(view);
  view.querySelector('.tunon').addEventListener('click', async e => {
    const b = e.target.closest('.tunon');
    if (tuner.on) { tunerStop(); b.innerHTML = `${ICONS.mic} Activar micrófono`; return; }
    if (await tunerStart()) b.innerHTML = `${ICONS.stop} Detener micrófono`;
  });
  view.querySelectorAll('.tunstr button').forEach(b => {
    b.addEventListener('click', () => {
      const i = +b.dataset.i;
      tuner.lock = i;
      view.querySelectorAll('.tunstr button').forEach(x => x.classList.toggle('active', x === b));
      if (i >= 0) pluck(TUNER_STRINGS[i].midi, 0, 0.9);
    });
  });
}

/* ===================== respaldo de progreso ===================== */
function exportProgress() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('gc:')) data[k] = localStorage.getItem(k);
  }
  const json = JSON.stringify({ app: 'curso-guitarra', fecha: isoToday(), datos: data }, null, 1);
  const file = new File([json], `progreso-guitarra-${isoToday()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Progreso curso de guitarra' }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
function importProgress(fileInput) {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  f.text().then(txt => {
    const j = JSON.parse(txt);
    if (!j || j.app !== 'curso-guitarra' || !j.datos) throw new Error('formato');
    Object.keys(j.datos).forEach(k => { if (k.startsWith('gc:')) localStorage.setItem(k, j.datos[k]); });
    location.reload();
  }).catch(() => alert('Ese archivo no es un respaldo válido de esta app.'));
}

/* ===================== grabaciones (IndexedDB) ===================== */
let recDB = null;
function recdb() {
  return new Promise((res, rej) => {
    if (recDB) return res(recDB);
    const q = indexedDB.open('gc-rec', 1);
    q.onupgradeneeded = () => {
      const st = q.result.createObjectStore('recs', { keyPath: 'id', autoIncrement: true });
      st.createIndex('day', 'day');
    };
    q.onsuccess = () => { recDB = q.result; res(recDB); };
    q.onerror = () => rej(q.error);
  });
}
function recAdd(day, blob) {
  return recdb().then(db => new Promise((res, rej) => {
    const tx = db.transaction('recs', 'readwrite');
    tx.objectStore('recs').add({ day, ts: Date.now(), blob });
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  }));
}
function recList(day) {
  return recdb().then(db => new Promise((res, rej) => {
    const q = db.transaction('recs').objectStore('recs').index('day').getAll(day);
    q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
  })).catch(() => []);
}
function recDel(id) {
  return recdb().then(db => new Promise(res => {
    const tx = db.transaction('recs', 'readwrite');
    tx.objectStore('recs').delete(id);
    tx.oncomplete = res;
  }));
}
function renderRecs(day) {
  const box = day.querySelector('.recs');
  if (!box) return;
  const n = DAYS.indexOf(day) + 1;
  recList(n).then(items => {
    if (!items.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<h4>🎙 Mis grabaciones</h4>';
    items.sort((a, b) => b.ts - a.ts).forEach(it => {
      const d = new Date(it.ts);
      const row = document.createElement('div');
      row.className = 'recrow';
      const lbl = document.createElement('span');
      lbl.textContent = d.toLocaleDateString('es-CL') + ' ' +
        d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      const au = document.createElement('audio');
      au.controls = true; au.preload = 'none';
      au.src = URL.createObjectURL(it.blob);
      const del = document.createElement('button');
      del.className = 'danger'; del.textContent = '✕';
      del.addEventListener('click', () => {
        if (del.dataset.arm) recDel(it.id).then(() => renderRecs(day));
        else { del.dataset.arm = '1'; del.textContent = '¿Borrar?'; setTimeout(() => { del.dataset.arm = ''; del.textContent = '✕'; }, 2500); }
      });
      row.append(lbl, au, del);
      box.append(row);
    });
  });
}
/* ============== contador por micrófono (golpes + silencio) ==============
   Cuenta cada ataque (rasgueo/nota) que oye el micrófono. Andrés juzga la
   calidad: si para de tocar (~3 s de silencio), el contador vuelve a 0.
   Con el metrónomo andando compara cada ataque con el clic más cercano y
   dice si va al tempo.
   Detección por FLUJO ESPECTRAL EN dB con envolvente por bin, en dos bandas:
   60–900 Hz (fundamentales) y 2400–6000 Hz (transiente de púa/uña, que es lo
   único que distingue un re-rasgueo del acorde que sigue sonando). Un bin solo
   aporta si supera su propio pico reciente (envolvente que decae 1,5 dB por
   frame): el ring-out nunca lo hace, así que no dispara falsos. Trabajar en dB
   hace al detector independiente del volumen: la nota suelta de un arpegio
   suave cuenta igual que un rasgueo. Las bandas esquivan el clic del metrónomo
   (1250/1800 Hz y sus armónicos 3750/5400, con notch). Calibrado con el banco
   offline de scratchpad/mic-harness2.js: 21/21 ataques, 0 falsos, con clics. */
const mic = { stream: null, an: null, buf: null, env: null, timer: 0, on: false,
  count: 0, floor: 0.003, floorDb: -75, fluxDbAvg: 0, lo: 3, hi: 38,
  lo2: 102, hi2: 256, notch: null, lastOnset: 0, lastSound: 0,
  offsets: [], onCount: null, onReset: null, onTempo: null, silenceMs: 3000,
  dbg: { bandRms: 0, flux: 0 } };

/* Pide el micrófono prefiriendo SIEMPRE el del teléfono: con AirPods/BT el
   sistema entrega el micrófono de los audífonos (baja calidad, pierde ataques
   de guitarra); el audio de la app sigue saliendo por los AirPods igual. */
async function getMicStream() {
  const opts = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: opts });
  } catch (e) { return null; }
  try {
    const bt = /airpod|bluetooth|hands-?free|headset|inal[áa]mbric|wireless/i;
    const cur = (stream.getAudioTracks()[0] || {}).label || '';
    if (bt.test(cur)) {
      const ins = (await navigator.mediaDevices.enumerateDevices())
        .filter(d => d.kind === 'audioinput' && d.label && !bt.test(d.label));
      if (ins.length) {
        const s2 = await navigator.mediaDevices.getUserMedia({
          audio: Object.assign({ deviceId: { exact: ins[0].deviceId } }, opts)
        });
        stream.getTracks().forEach(t => t.stop());
        stream = s2;
      }
    }
  } catch (e) {}
  return stream;
}
async function micStart() {
  if (mic.on) return true;
  audio();
  mic.stream = await getMicStream();
  if (!mic.stream) return false;
  const src = ctx.createMediaStreamSource(mic.stream);
  mic.an = ctx.createAnalyser();
  mic.an.fftSize = 2048;
  mic.an.smoothingTimeConstant = 0; // sin suavizado: el flujo necesita ver el salto
  src.connect(mic.an);
  const binHz = ctx.sampleRate / mic.an.fftSize;
  mic.lo = Math.max(1, Math.round(60 / binHz));
  mic.hi = Math.min(mic.an.frequencyBinCount - 1, Math.round(900 / binHz));
  mic.lo2 = Math.round(2400 / binHz);
  mic.hi2 = Math.min(mic.an.frequencyBinCount - 1, Math.round(6000 / binHz));
  mic.buf = new Float32Array(mic.an.frequencyBinCount);
  mic.env = new Float32Array(mic.hi2 + 1).fill(-100);
  // notch: armónicos del clic del metrónomo (3×1250=3750, 3×1800=5400)
  mic.notch = new Uint8Array(mic.hi2 + 1);
  for (let i = mic.lo2; i <= mic.hi2; i++) {
    const f = i * binHz;
    if (Math.abs(f - 3750) < 160 || Math.abs(f - 5400) < 160) mic.notch[i] = 1;
  }
  mic.on = true; mic.count = 0; mic.floor = 0.003; mic.floorDb = -75;
  mic.fluxDbAvg = 0;
  mic.lastOnset = 0; mic.lastSound = performance.now(); mic.offsets = [];
  mic.silenceMs = 3000;
  // setInterval y no rAF: en iOS rAF se congela con la pantalla atenuada o
  // durante gestos, y se perdían ataques
  mic.timer = setInterval(micLoop, 25);
  return true;
}
function micStop() {
  mic.on = false;
  clearInterval(mic.timer);
  if (mic.stream) { mic.stream.getTracks().forEach(t => t.stop()); mic.stream = null; }
  mic.an = null; mic.onCount = mic.onReset = mic.onTempo = null;
}
function micLoop() {
  if (!mic.on) return;
  mic.an.getFloatFrequencyData(mic.buf);
  let e = 0, fluxDb = 0, meanDb = 0;
  for (let i = mic.lo; i <= mic.hi2; i++) {
    const inB1 = i <= mic.hi, inB2 = i >= mic.lo2 && !mic.notch[i];
    if (!inB1 && !inB2) continue;
    const db = Math.max(mic.buf[i], -100);
    if (inB1) { const lin = Math.pow(10, db / 20); e += lin * lin; meanDb += db; }
    // un bin aporta solo si supera su pico reciente en 5+ dB y está sobre el ruido
    const rise = db - (mic.env[i] + 2);
    if (rise > 3 && db > mic.floorDb + 12) fluxDb += rise;
    mic.env[i] = Math.max(mic.env[i] - 1.5, db);
  }
  const n = mic.hi - mic.lo + 1;
  meanDb /= n;
  const bandRms = Math.sqrt(e / n);
  mic.dbg.bandRms = bandRms; mic.dbg.flux = fluxDb;
  const now = performance.now();
  // piso de ruido adaptativo, lineal (para floorDb) y en dB (para el detector)
  if (bandRms < mic.floor) mic.floor = Math.max(0.0015, mic.floor * 0.995);
  else if (bandRms < mic.floor * 2.5) mic.floor = mic.floor * 1.01;
  if (bandRms < mic.floor * 2.5) mic.floorDb = mic.floorDb * 0.98 + meanDb * 0.02;
  // "hay sonido" en dB: el RMS lineal no veía una nota suave de arpegio y el
  // contador se reiniciaba por silencio aunque Andrés siguiera tocando
  if (meanDb > mic.floorDb + 6) mic.lastSound = now;
  // ataque: flujo en dB sobre su promedio móvil, antirrebote 150 ms
  if (fluxDb > Math.max(20, mic.fluxDbAvg * 2.5) && now - mic.lastOnset > 150) {
    mic.lastOnset = now; mic.lastSound = now;
    mic.count++;
    if (met.on) micTempoMark();
    if (mic.onCount) mic.onCount(mic.count);
  }
  // promedio móvil del flujo, acotado para que un golpe fuerte no lo dispare
  mic.fluxDbAvg = mic.fluxDbAvg * 0.9 + Math.min(fluxDb, mic.fluxDbAvg * 3 + 10) * 0.1;
  // silencio sostenido → contador a cero (Andrés paró porque no le salió)
  if (mic.count > 0 && now - mic.lastSound > mic.silenceMs) {
    mic.count = 0; mic.offsets = [];
    if (mic.onReset) mic.onReset();
  }
}
function micTempoMark() {
  const beat = 60 / met.bpm;
  // desfase respecto del clic más cercano, en segundos (met.next = próximo clic)
  let d = (ctx.currentTime - met.next) % beat;
  if (d > beat / 2) d -= beat; if (d < -beat / 2) d += beat;
  mic.offsets.push(d);
  if (mic.offsets.length > 8) mic.offsets.shift();
  if (!mic.onTempo || mic.offsets.length < 3) return;
  const sorted = [...mic.offsets].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const hits = mic.offsets.filter(o => Math.abs(o) <= 0.09).length / mic.offsets.length;
  let verdict;
  if (hits >= 0.6) verdict = '🎯 al tempo';
  else if (med < -0.07) verdict = '⏩ te adelantas';
  else if (med > 0.07) verdict = '⏪ te atrasas';
  else verdict = '〰 irregular';
  mic.onTempo(verdict, Math.round(hits * 100));
}

const rec = { mr: null, stream: null, timer: null };
async function recToggle(btn) {
  if (rec.mr) { rec.mr.stop(); return; }
  if (!window.MediaRecorder) { alert('Este navegador no soporta grabación de audio.'); return; }
  rec.stream = await getMicStream();
  if (!rec.stream) { alert('Sin acceso al micrófono: autorízalo para poder grabarte.'); return; }
  const chunks = [];
  rec.mr = new MediaRecorder(rec.stream);
  rec.mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.mr.onstop = () => {
    clearTimeout(rec.timer);
    const blob = new Blob(chunks, { type: rec.mr.mimeType || 'audio/mp4' });
    rec.stream.getTracks().forEach(t => t.stop());
    rec.mr = null; rec.stream = null;
    btn.classList.remove('rec');
    const day = DAYS[session.open ? session.dayIdx : currentDayIndex()];
    const n = DAYS.indexOf(day) + 1;
    recAdd(n, blob).then(() => { injectDayNotes(day); renderRecs(day); });
  };
  rec.mr.start();
  btn.classList.add('rec');
  rec.timer = setTimeout(() => { if (rec.mr) rec.mr.stop(); }, 90000); // tope 90 s
}

/* ===================== repaso espaciado ===================== */
// intervalo de repaso según cómo estuvo el día: difícil 3d · normal 7d · fácil 14d
const REVIEW_IV = { d: 3, n: 7, f: 14 };
function reviewDue() {
  const done = load('gc:doneDates', {});
  const diff = load('gc:diff', {});
  const seen = load('gc:reviews', {});
  const today = new Date(isoToday() + 'T00:00:00');
  let best = null;
  Object.keys(done).forEach(n => {
    const last = new Date((seen[n] || done[n]) + 'T00:00:00');
    const days = Math.round((today - last) / 86400000);
    const need = REVIEW_IV[diff[n] || 'n'];
    if (days >= need && (!best || days - need > best.over)) best = { n: +n, over: days - need, days };
  });
  return best;
}
function markReviewed(n) {
  const seen = load('gc:reviews', {});
  seen[n] = isoToday();
  store('gc:reviews', seen);
}

/* ===================== herramientas de práctica ===================== */
function toolModal(html) {
  const ov = document.createElement('div');
  ov.className = 'toolmodal';
  ov.innerHTML = `<div class="toolcard"><button class="toolclose" aria-label="Cerrar">✕</button>${html}</div>`;
  document.body.append(ov);
  const close = () => { ov.remove(); if (ov.__onclose) ov.__onclose(); };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.toolclose')) close(); });
  return ov;
}
// entrenador de cambios de acordes ("one-minute changes")
function openChanges() {
  const st = load('gc:changes', { best: {}, last: ['G', 'C'] });
  const names = Object.keys(CHORDS).sort();
  const opts = sel => names.map(x => `<option${x === sel ? ' selected' : ''}>${x}</option>`).join('');
  const bestRows = Object.keys(st.best).sort()
    .map(p => `<tr><td>${esc(p)}</td><td><b>${st.best[p]}</b></td></tr>`).join('');
  const ov = toolModal(`
    <h3>Cambios de acordes</h3>
    <p class="legend">Un minuto, un par de acordes: alterna entre los dos lo más limpio que puedas
    y toca <b>+1</b> por cada cambio logrado. La meta clásica: 30 por minuto = listo para tocar canciones.</p>
    <div class="chgsel"><select class="cha">${opts(st.last[0])}</select> ⇄ <select class="chb">${opts(st.last[1])}</select>
      <button class="chgo">▶ 60 s</button></div>
    <label class="chgmic"><input type="checkbox" class="chmic"> 🎤 contar con el micrófono (cada rasgueo = 1 cambio)</label>
    <div class="chgrun" hidden>
      <div class="chgtime">60</div>
      <button class="chgbig">+1<small>cambio</small></button>
      <div class="chgcount">0 cambios</div>
    </div>
    <div class="chgres" hidden></div>
    ${bestRows ? `<details class="chgbests"><summary>Mis récords</summary><table>${bestRows}</table></details>` : ''}`);
  const $ = s => ov.querySelector(s);
  let t = null, count = 0, remain = 60;
  ov.__onclose = () => { clearInterval(t); if (mic.on) micStop(); };
  const showCount = () => { $('.chgcount').textContent = count + (count === 1 ? ' cambio' : ' cambios'); };
  $('.chgo').addEventListener('click', async () => {
    const pair = $('.cha').value + '→' + $('.chb').value;
    st.last = [$('.cha').value, $('.chb').value];
    count = 0; remain = 60;
    $('.chgrun').hidden = false; $('.chgres').hidden = true; $('.chgo').disabled = true;
    $('.chgtime').textContent = remain; $('.chgcount').textContent = '0 cambios';
    audio();
    if ($('.chmic').checked) {
      const ok = await micStart();
      if (ok) {
        mic.silenceMs = 1e9; // acá no se reinicia por silencio: cuenta total del minuto
        mic.onCount = () => { if (t) { count++; showCount(); } };
      } else { $('.chmic').checked = false; }
    }
    t = setInterval(() => {
      remain--;
      $('.chgtime').textContent = remain;
      if (remain <= 0) {
        clearInterval(t); t = null;
        if (mic.on) micStop();
        $('.chgrun').hidden = true; $('.chgo').disabled = false;
        const prev = st.best[pair] || 0;
        if (count > prev) st.best[pair] = count;
        store('gc:changes', st);
        chime();
        $('.chgres').hidden = false;
        $('.chgres').innerHTML = `<b>${count} cambios</b> en 60 s (${esc(pair)})` +
          (count > prev ? ' · 🎉 ¡récord nuevo!' : prev ? ` · tu récord: ${prev}` : '') +
          (count >= 30 ? '<br>✅ ¡30+! Este par ya está listo para canciones.' : '');
      }
    }, 1000);
  });
  $('.chgbig').addEventListener('click', () => {
    if (t == null) return;
    count++;
    $('.chgcount').textContent = count + (count === 1 ? ' cambio' : ' cambios');
  });
}
// entrenamiento de oído: ¿qué acorde suena?
function openEar() {
  const st = load('gc:ear', { streak: 0, best: 0 });
  st.streak = 0;
  const ov = toolModal(`
    <h3>Entrena el oído</h3>
    <p class="legend">Suena un acorde del curso: adivina cuál es. Puedes repetirlo las veces que quieras.</p>
    <div class="earscore">Racha: <b class="earstreak">0</b> · Mejor: <b class="earbest">${st.best}</b></div>
    <p><button class="earplay">🔊 Repetir</button></p>
    <div class="earopts"></div>
    <div class="earmsg"></div>`);
  const $ = s => ov.querySelector(s);
  const names = Object.keys(CHORDS).sort();
  let answer = null, locked = false;
  function playAnswer() { if (answer) { stopPlayback(); strumChord(answer, ctx ? ctx.currentTime + 0.05 : 0, 0.9); } }
  function next() {
    locked = false;
    $('.earmsg').textContent = '';
    answer = names[Math.floor(Math.random() * names.length)];
    const pool = names.filter(x => x !== answer);
    const opts = [answer];
    while (opts.length < Math.min(4, names.length)) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      opts.push(c);
    }
    opts.sort(() => Math.random() - 0.5);
    const box = $('.earopts');
    box.innerHTML = '';
    opts.forEach(name => {
      const b = document.createElement('button');
      b.textContent = name;
      b.addEventListener('click', () => {
        if (locked) return;
        locked = true;
        const good = name === answer;
        b.classList.add(good ? 'good' : 'bad');
        if (!good) [...box.children].find(x => x.textContent === answer).classList.add('good');
        st.streak = good ? st.streak + 1 : 0;
        if (st.streak > st.best) st.best = st.streak;
        store('gc:ear', { best: st.best });
        $('.earstreak').textContent = st.streak;
        $('.earbest').textContent = st.best;
        $('.earmsg').textContent = good ? '✅ ¡Ese era!' : `Era ${answer}. Escúchalos de nuevo y sigue.`;
        setTimeout(() => { next(); playAnswer(); }, good ? 900 : 1800);
      });
      box.append(b);
    });
    playAnswer();
  }
  $('.earplay').addEventListener('click', playAnswer);
  audio();
  next();
}
// verificador de acordes con micrófono (beta): ¿están sonando las notas del acorde?
async function chordCheck(name, out) {
  const c = CHORDS[name];
  if (!c) return;
  out.textContent = 'Pidiendo micrófono…';
  const stream = await getMicStream();
  if (!stream) { out.textContent = 'Sin acceso al micrófono.'; return; }
  audio();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 8192;
  an.smoothingTimeConstant = 0.5;
  src.connect(an);
  const bins = new Float32Array(an.frequencyBinCount);
  const chroma = new Float32Array(12);
  out.innerHTML = '🎙 <b>Toca el acorde ahora</b> (rasguea una vez, fuerte)…';
  const t0 = performance.now();
  await new Promise(res => {
    (function loop() {
      an.getFloatFrequencyData(bins);
      const hz = ctx.sampleRate / an.fftSize;
      for (let i = Math.ceil(70 / hz); i < Math.min(bins.length, 1100 / hz); i++) {
        const f = i * hz;
        const mag = Math.pow(10, bins[i] / 20);
        const pc = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
        if (mag > chroma[pc]) chroma[pc] = mag;
      }
      if (performance.now() - t0 < 2600) requestAnimationFrame(loop); else res();
    })();
  });
  stream.getTracks().forEach(t => t.stop());
  const want = [...new Set(chordMidis(c.frets).map(m => m % 12))];
  const max = Math.max.apply(null, [...chroma]);
  if (max < 1e-6) { out.textContent = 'No escuché nada: acércate al micrófono y rasguea fuerte.'; return; }
  const res = want.map(pc => ({ pc, ok: chroma[pc] >= max * 0.18 }));
  const okAll = res.every(r => r.ok);
  out.innerHTML = res.map(r =>
    `<span class="ccnote ${r.ok ? 'ok' : 'no'}">${PC_LAT[r.pc]} ${r.ok ? '✓' : '✗'}</span>`).join(' ') +
    `<div class="ccverdict">${okAll ? '✅ ¡Suena completo!' :
      '⚠️ Falta que suene ' + res.filter(r => !r.ok).map(r => PC_LAT[r.pc]).join(' y ') +
      ': revisa que esas cuerdas no estén muteadas.'}</div>`;
}

/* ===================== inicio ("Hoy") ===================== */
function nextDayIdx() {
  const done = doneSet();
  for (let i = 0; i < DAYS.length; i++) if (!done.has(i + 1)) return i;
  return DAYS.length - 1;
}
function dayTitle(d) {
  const h = d.querySelector('h2');
  return h ? h.textContent.trim() : '';
}
function dayMeta(d) {
  const e = d.querySelector('.eyebrow');
  return e ? e.textContent.trim() : '';
}
function buildHomeView() {
  const view = document.createElement('section');
  view.id = 'view-hoy';
  view.className = 'view';
  document.querySelector('main').append(view);
  renderHome();
}
function renderHome() {
  const view = document.getElementById('view-hoy');
  if (!view) return;
  const done = doneSet();
  const idx = nextDayIdx();
  const d = DAYS[idx];
  const pct = done.size / DAYS.length;
  const R = 34, CIRC = 2 * Math.PI * R;
  view.innerHTML = `
    <div class="homehead">
      <div class="homering">
        <svg viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="${R}" class="ringbg"/>
          <circle cx="40" cy="40" r="${R}" class="ringfg" stroke-dasharray="${CIRC}"
            stroke-dashoffset="${CIRC * (1 - pct)}" transform="rotate(-90 40 40)"/>
        </svg>
        <div class="ringtxt"><b>${done.size}</b><span>/${DAYS.length}</span></div>
      </div>
      <div class="homestats">
        <h2>Tu curso</h2>
        <div class="homestreak">🔥 Racha: <b>${streakDays()}</b> ${streakDays() === 1 ? 'día' : 'días'}</div>
        <div class="homepct">${Math.round(pct * 100)}% del curso completado</div>
      </div>
    </div>
    <div class="todaycard">
      <div class="eyebrow">${esc(dayMeta(d) || 'Sesión de hoy')}</div>
      <h3>${esc(dayTitle(d) || 'Día ' + (idx + 1))}</h3>
      <button class="homego">▶ Empezar la sesión de hoy</button>
      <button class="homeread ghost">Leer el día completo</button>
    </div>
    ${(() => {
      const r = reviewDue();
      if (!r) return '';
      const rd = DAYS[r.n - 1];
      return `<div class="revcard">
        <div class="eyebrow">🔁 Repaso sugerido · hace ${r.days} días</div>
        <h3>Día ${r.n}: ${esc(dayTitle(rd))}</h3>
        <div class="revbtns"><button class="revgo" data-n="${r.n}">Repasar 5–10 min</button>
        <button class="revskip ghost" data-n="${r.n}">Hoy no</button></div>
      </div>`;
    })()}
    <h3 class="homeh">Práctica libre</h3>
    <div class="homerow">
      <button class="homechg">⇄ Cambios de acordes</button>
      <button class="homeear">👂 Entrena el oído</button>
    </div>
    <div class="homerow">
      <button class="homecal">${ICONS.chart} Progreso</button>
      <button class="homefb">${ICONS.mail} Feedback</button>
    </div>
    <p class="legend homefoot">El feedback se envía por correo a Andrés para mejorar la app en futuras versiones.</p>`;
  view.querySelector('.homego').addEventListener('click', () => {
    setView('curso'); gotoDay(idx); startSession(idx);
  });
  view.querySelector('.homeread').addEventListener('click', () => { setView('curso'); gotoDay(idx); });
  view.querySelector('.homecal').addEventListener('click', openProgress);
  view.querySelector('.homefb').addEventListener('click', sendFeedbackMail);
  view.querySelector('.homechg').addEventListener('click', openChanges);
  view.querySelector('.homeear').addEventListener('click', openEar);
  const rg = view.querySelector('.revgo');
  if (rg) rg.addEventListener('click', () => {
    const n = +rg.dataset.n;
    markReviewed(n);
    setView('curso'); gotoDay(n - 1);
  });
  const rs = view.querySelector('.revskip');
  if (rs) rs.addEventListener('click', () => { markReviewed(+rs.dataset.n); renderHome(); });
}

/* ===================== feedback por correo ===================== */
function sendFeedbackMail() {
  const done = doneSet(), notes = getNotes();
  let body = `Progreso: ${done.size}/${DAYS.length} días · racha ${streakDays()} días\n\n`;
  const keys = Object.keys(notes).map(Number).sort((a, b) => a - b);
  if (keys.length) {
    body += 'Mis notas por día:\n';
    keys.forEach(k => { body += `— Día ${k}: ${notes[k]}\n`; });
    body += '\n';
  }
  body += 'Feedback / mejoras que quiero para la app:\n· \n';
  if (body.length > 1700) body = body.slice(0, 1700) + '\n…(notas recortadas; exporta el respaldo para el detalle completo)';
  location.href = 'mailto:andres@nikolaventures.com?subject=' +
    encodeURIComponent('Curso guitarra · notas y feedback') +
    '&body=' + encodeURIComponent(body);
}

/* ===================== init ===================== */
function buildChordDict() {
  document.querySelectorAll('.chord').forEach(div => {
    try {
      const c = parseChordDiv(div);
      if (c && c.name && !CHORDS[c.name]) CHORDS[c.name] = { frets: c.frets, sample: div.innerHTML };
    } catch (e) { window.__gcerr.push('chord: ' + e.message); }
  });
}
function wireChordTaps() {
  document.addEventListener('click', e => {
    const div = e.target.closest('.chord');
    if (!div || !div.querySelector('svg')) return;
    const nameEl = div.querySelector('b');
    if (!nameEl) return;
    const parsed = parseChordDiv(div);
    if (!parsed) return;
    const midis = chordMidis(parsed.frets);
    if (!midis.length) return;
    const t = audio().currentTime;
    midis.forEach((m, i) => pluck(m, t + i * 0.035));
    div.classList.add('playing');
    setTimeout(() => div.classList.remove('playing'), 350);
  });
  document.addEventListener('click', e => {
    const tok = e.target.closest('.chtok');
    if (!tok) return;
    if (!strumChord(tok.dataset.ch)) {
      const m = /^([A-G])([#b]?)/.exec(tok.dataset.ch || '');
      if (m) pluck(48 + NOTE_ANG.indexOf(m[1] + (m[2] === '#' ? '#' : '')));
    }
    tok.classList.add('playing');
    setTimeout(() => tok.classList.remove('playing'), 350);
  });
}
/* iOS standalone a veces reporta un viewport (100dvh / innerHeight) más corto que la
   pantalla real, y el shell quedaba flotando sobre el bottom. Medimos la altura útil:
   si la dimensión de pantalla es apenas mayor que innerHeight (sin teclado abierto),
   esa es la buena. Se fija como --appH y se recalcula en cada resize/rotación. */
function shellFit() {
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let h = window.innerHeight;
  if (standalone) {
    for (const c of [screen.height, screen.width]) {
      if (c > h && c - h < 160) { h = c; break; }
    }
  }
  document.documentElement.style.setProperty('--appH', h + 'px');
}
function init() {
  shellFit();
  addEventListener('resize', shellFit);
  addEventListener('orientationchange', () => setTimeout(shellFit, 250));
  if (window.visualViewport) visualViewport.addEventListener('resize', shellFit);
  DAYS = [...document.querySelectorAll('.day')];
  buildChordDict();
  injectTabbar();
  injectMetronome();
  injectDoneButtons();
  injectSessionButtons();
  observeDays();
  buildSongsView();
  buildRefView();
  buildTunerView();
  buildHomeView();
  wireChordTaps();
  // botón de progreso junto al selector de día
  const ctr = document.querySelector('.controls');
  if (ctr) {
    const b = document.createElement('button');
    b.className = 'progbtn';
    b.innerHTML = ICONS.chart;
    b.setAttribute('aria-label', 'Progreso');
    b.addEventListener('click', openProgress);
    ctr.append(b);
  }
  const saved = load('gc:day', null);
  if (!/day-\d+/.test(location.hash) && saved != null && saved !== currentDayIndex()) gotoDay(saved);
  const cur = currentDayIndex();
  if (cur >= 0) buildDemos(DAYS[cur]);
  setView(/day-\d+/.test(location.hash) ? 'curso' : 'hoy');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
