/* Runtime de la webapp del curso de guitarra.
   No modifica el contenido del curso: agrega audio (cuerdas de nylon por
   síntesis Karplus-Strong), metrónomo, demos interactivas, canciones,
   referencia de acordes/notas y persistencia de estado. */
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
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
['touchend', 'mousedown', 'keydown'].forEach(ev =>
  document.addEventListener(ev, () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { passive: true }));

function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

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
  src.buffer = pluckBuf(midi);
  const g = ctx.createGain();
  g.gain.value = 0.55 * (vel == null ? 1 : vel);
  src.connect(g); g.connect(master);
  src.start(t);
  liveNodes.push(src);
  if (liveNodes.length > 120) liveNodes = liveNodes.filter(n => { try { return n.context; } catch (e) { return false; } }).slice(-60);
  return src;
}

function click(when, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1800 : 1250;
  g.gain.setValueAtTime(accent ? 0.4 : 0.25, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  o.connect(g); g.connect(master);
  o.start(when); o.stop(when + 0.07);
  liveNodes.push(o);
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

/* ===================== metrónomo (estilo Moises) ===================== */
const SIGS = { '2/4': 2, '3/4': 3, '4/4': 4, '5/4': 5, '6/8': 6, '12/8': 12 };
const met = Object.assign({ bpm: 60, sig: '4/4', on: false, next: 0, count: 0, timer: null }, load('gc:met', {}));
met.on = false;
function metBeats() { return SIGS[met.sig] || 4; }
function metSave() { store('gc:met', { bpm: met.bpm, sig: met.sig }); }
function metStart() {
  audio();
  if (met.on) return;
  met.on = true;
  met.count = 0;
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
    const beat = met.count % metBeats();
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
  if (btn) { btn.classList.toggle('on', met.on); btn.textContent = met.on ? '■ Detener' : '▶ Iniciar'; }
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
  document.querySelectorAll('.play.playing').forEach(b => { b.classList.remove('playing'); b.textContent = '▶'; });
}
// events: [{midis:[..], vel, fbKey}] — un evento por pulso
function playEvents(events, bpm, sigBeats, btn, onBeatFlash) {
  audio();
  stopPlayback();
  const id = playSession;
  const spb = 60 / bpm;
  const useMet = met.on;             // metrónomo activado → count-in + clic durante la demo
  const wasRunning = met.on;
  if (wasRunning) metStop();
  let t = ctx.currentTime + 0.15;
  if (useMet) {
    for (let b = 0; b < sigBeats; b++) { click(t, b === 0); flashBeat(b, (t - ctx.currentTime) * 1000); t += spb; }
  }
  events.forEach((ev, i) => {
    const when = t + i * spb;
    if (useMet) { click(when, (i % sigBeats) === 0); flashBeat(i % sigBeats, (when - ctx.currentTime) * 1000); }
    ev.midis.forEach((m, k) => pluck(m, when + k * 0.035, ev.vel));
    if (onBeatFlash) setTimeout(() => { if (id === playSession) onBeatFlash(ev, i); }, (when - ctx.currentTime) * 1000);
  });
  const end = t + events.length * spb + 0.4;
  if (btn) { btn.classList.add('playing'); btn.textContent = '…'; }
  setTimeout(() => {
    if (id !== playSession) return;
    if (btn) { btn.classList.remove('playing'); btn.textContent = '▶'; }
    if (wasRunning) metStart();
  }, (end - ctx.currentTime) * 1000);
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
  const prog = findProgression(text);
  if (prog) return { type: 'prog', chords: prog, bpm, sig, label: prog.join(' – ') };
  const divChords = [...ex.querySelectorAll('.chord')]
    .map(d => (d.querySelector('b') || {}).textContent).map(n => (n || '').trim()).filter(n => CHORDS[n]);
  if (divChords.length) {
    const uniq = [...new Set(divChords)];
    return { type: 'prog', chords: uniq, bpm, sig, label: uniq.join(' – ') };
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
    seq.forEach(e => evs.push(e));
  } else {
    spec.chords.forEach(name => {
      const c = CHORDS[name];
      if (!c) return;
      const midis = chordMidis(c.frets);
      for (let b = 0; b < beats; b++) {
        evs.push(b === 0 ? { midis, vel: 0.95 } : { midis: midis.slice(-3), vel: 0.4 });
      }
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
  const bpmTxt = spec.bpm ? ` · ${spec.bpm} BPM` : '';
  label.textContent = `Demo: ${spec.label}${bpmTxt}` + (spec.sig ? ` · ${spec.sig}` : '');
  row.append(play, stop, label);
  panel.append(row);
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
}
function doneSet() { return new Set(load('gc:done', [])); }
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
      const done = doneSet();
      const n = i + 1;
      if (done.has(n)) done.delete(n);
      else {
        done.add(n);
        if (i < DAYS.length - 1) setTimeout(() => gotoDay(i + 1), 350);
      }
      store('gc:done', [...done]);
      renderDoneButtons();
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

/* ===================== vistas / pestañas ===================== */
function setView(v) {
  document.body.dataset.view = v;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  window.scrollTo(0, 0);
}
function injectTabbar() {
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  [['curso', '📖', 'Curso'], ['songs', '🎵', 'Canciones'], ['ref', '🎸', 'Referencia']].forEach(([v, ico, lbl]) => {
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
  fab.textContent = '♩';
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
    <button class="metstart">▶ Iniciar</button>
    <div class="metbeat"></div>`;
  document.body.append(fab, panel);
  fab.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelector('#metslider').addEventListener('input', e => { met.bpm = +e.target.value; metSave(); metUI(); });
  panel.querySelector('#bpmdn').addEventListener('click', () => { met.bpm = Math.max(30, met.bpm - 5); metSave(); metUI(); });
  panel.querySelector('#bpmup').addEventListener('click', () => { met.bpm = Math.min(200, met.bpm + 5); metSave(); metUI(); });
  panel.querySelector('#metsig').addEventListener('change', e => { met.sig = e.target.value; metSave(); metUI(); });
  panel.querySelector('.metstart').addEventListener('click', () => { met.on ? metStop() : metStart(); });
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
    <div class="songhint">Los acordes van en su propia línea, sobre la letra. Toca un acorde para oírlo,
    o ▶ para oír la progresión completa. El curso no incluye letras: pega tu propia hoja obtenida
    legalmente con «Editar».</div>
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
      seq.forEach(name => {
        const c = CHORDS[name] || CHORDS[baseChordName(name)];
        if (!c) return;
        const midis = chordMidis(c.frets);
        for (let b = 0; b < beats; b++) evs.push(b === 0 ? { midis, vel: 0.95 } : { midis: midis.slice(-3), vel: 0.4 });
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
      <h3>¿Dónde está cada nota?</h3>
      <p class="legend">Elige una nota y mira todas sus posiciones hasta el traste 12. Toca el diapasón para oírla.</p>
      <div class="notebtns" id="notebtns"></div>
      <div class="fbwrap" id="notefb"></div>
    </div>`;
  document.querySelector('main').append(view);

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
    <div class="sesscontent"></div>
    <div class="sessbanner"><span>⏰ ¡Tiempo!</span>
      <button class="bnrepeat">🔁 Repetir</button><button class="bnnext">Siguiente →</button></div>
    <footer class="sessfoot">
      <button class="sessprev" aria-label="Anterior">←</button>
      <button class="sesstimerbtn">▶ Empezar</button>
      <button class="sessmet" aria-label="Metrónomo">♩</button>
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
  sessionWakeLock();
  showSessionEx(0);
}
function sessionMetUI() {
  const b = session.el && session.el.querySelector('.sessmet');
  if (b) b.classList.toggle('on', met.on);
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
    <button class="sessfinish">✓ Marcar día completado</button></div>`;
  session.el.querySelector('.sesstitle b').textContent = 'Fin de la sesión';
  session.total = null;
  updateTimerUI();
  content.querySelector('.sessfinish').addEventListener('click', () => {
    const done = doneSet();
    done.add(session.dayIdx + 1);
    store('gc:done', [...done]);
    renderDoneButtons();
    closeSession();
    if (session.dayIdx < DAYS.length - 1) gotoDay(session.dayIdx + 1);
  });
}
function closeSession() {
  if (!session.open) return;
  stopTimer();
  stopPlayback();
  metStop();
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
function init() {
  DAYS = [...document.querySelectorAll('.day')];
  buildChordDict();
  injectTabbar();
  injectMetronome();
  injectDoneButtons();
  injectSessionButtons();
  observeDays();
  buildSongsView();
  buildRefView();
  wireChordTaps();
  setView('curso');
  const saved = load('gc:day', null);
  if (!/day-\d+/.test(location.hash) && saved != null && saved !== currentDayIndex()) gotoDay(saved);
  const cur = currentDayIndex();
  if (cur >= 0) buildDemos(DAYS[cur]);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
