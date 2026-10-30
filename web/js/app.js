// App shell: state, deck (LCD, groups, pads, mode row), transport, persistence, boot.
import { GROUPS, PAD_LABELS, GRIDS, STEP_PAGE_BARS, PROJECT_COUNT, PATTERNS_PER_GROUP, MAX_BARS, NOTE_NAMES, EFFECTS, USER_SAMPLE_MIN } from './data.js';
import { factoryProject, normaliseProject, getPattern, setBars, setBeats, beatsOf, clearPad, nextEmptyPattern, doubleLength, halveLength, correctEvents, clearPattern, padSemitone, scaleNote, nudgeEvent, copyOf, pasteInto, patternTicks, nextFreeScene, sceneFromCurrent, UndoStack, ticksToPosition } from './model.js';
import { Engine } from './audio.js';
import { Sequencer } from './seq.js';
import { storage, userSamples } from './store.js';
import { TABS, renderTab, storeBuffer, knob, fader } from './panels.js';

const $ = (s, r = document) => r.querySelector(s);

export const A = window.A = {
  project: null, pi: 1, g: 0, sel: 9, tab: 'STEP',
  keys: false, shift: false, latched: new Map(), oct: 0, keysPad: 9, erase: false,
  velMode: 'fixed', stepGrid: '1/16', clipboard: null,
  catalogue: [], byId: new Map(), undo: new UndoStack(), lastUndoPush: 0,
};

A.settings = Object.assign({ pi: 1, quantise: '1/16', metronome: false, countIn: true, velMode: 'fixed', master: 0.9, scale: 'chromatic', theme: 'light', layout: 'hardware' }, storage.get('ko.settings', {}));

// ---- helpers -------------------------------------------------------------------
A.toast = (msg, ms = 2200) => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(A._toastT); A._toastT = setTimeout(() => t.classList.remove('show'), ms);
};
A.sampleName = (id) => {
  if (!id) return 'EMPTY';
  const f = A.byId.get(id); if (f) return f.name;
  return userSamples.meta.get(id)?.name || `sample ${id}`;
};
A.sampleDur = (id) => A.byId.get(id)?.dur ?? userSamples.meta.get(id)?.dur ?? 0;
A.grp = () => A.project.groups[A.g];
A.pad = (i = A.sel) => A.grp().pads[i];
A.pattern = (create = false) => getPattern(A.project, A.g, null, create);

let saveT;
A.save = () => {
  clearTimeout(saveT);
  saveT = setTimeout(() => { if (!A.resetting) storage.set(`ko.proj.${A.pi}`, A.project); }, 300);
};
A.saveSettings = () => storage.set('ko.settings', A.settings);

// Snapshot a pattern before an edit. Rapid edits (live recording) share one undo step.
// The key is found from the pattern object itself, because the playing pattern can differ from the selected one.
A.beforeEdit = (g, pat, coalesce = false) => {
  const n = Object.keys(A.project.groups[g].patterns).find((k) => A.project.groups[g].patterns[k] === pat);
  if (n === undefined) return;
  const now = performance.now(), key = `${g}:${n}`;
  if (!coalesce || now - A.lastUndoPush > 1500 || A.lastKey !== key) A.undo.push(key, pat);
  A.lastUndoPush = coalesce ? now : 0; A.lastKey = key;
};
A.undoLast = () => {
  const it = A.undo.pop();
  if (!it) return A.toast('Nothing to undo');
  const [g, n] = it.key.split(':').map(Number);
  A.project.groups[g].patterns[String(n)] = it.snap;
  A.lastUndoPush = 0; A.save(); A.refresh();
};

// ---- engine and sequencer ------------------------------------------------------
A.engine = new Engine(userSamples);
const reported = new Set();
A.engine.onMissing = (id) => {
  if (reported.has(id)) return;
  reported.add(id);
  A.toast(`Sound ${id} is not available on this device. Import it again in the SOUND tab.`, 5000);
};
A.seq = new Sequencer(A.engine, {
  project: () => A.project,
  beforeEdit: (g, pat, coalesce) => A.beforeEdit(g, pat, coalesce),
  onChange: () => { A.save(); A.panelDirty = true; },
  onScene: () => A.refresh(),
  onStop: () => A.applyMix(),
  onHit: (g, p, time) => {
    if (g !== A.g || A.keys) return;
    setTimeout(() => flash(p), Math.max(0, (time - A.engine.now) * 1000));
  },
});

A.applyMix = () => {
  A.project.groups.forEach((g, i) => { A.engine.setGroupLevel(i, g.vol, g.mute); A.engine.setGroupSend(i, g.send ?? 1); });
  A.engine.setMaster(A.settings.master);
};
A.applyFx = () => A.engine.applyFx(A.project.fx.active, A.project.fx.params);

A.preload = async (project = A.project) => {
  const ids = [...new Set(project.groups.flatMap((g) => g.pads.map((p) => p.s)).filter(Boolean))];
  let done = 0;
  const msg = $('#startMsg');
  await Promise.all(ids.map((id) => A.engine.load(id).catch(() => null).then(() => {
    done++; if (!$('#start').classList.contains('hide')) msg.textContent = `Loading sounds ${done} of ${ids.length}`;
  })));
};

// ---- project load/switch -------------------------------------------------------
A.loadProject = async (n) => {
  if (A.project) { A.seq.stop(); storage.set(`ko.proj.${A.pi}`, A.project); }
  A.pi = n; A.settings.pi = n; A.saveSettings();
  const raw = storage.get(`ko.proj.${n}`);
  A.project = raw ? normaliseProject(raw) : factoryProject(n);
  if (!raw) for (const g of A.project.groups) for (const p of g.pads) if (p.s && p.s < USER_SAMPLE_MIN && !A.byId.has(p.s)) p.s = 0;
  A.undo = new UndoStack(); A.g = 0; A.sel = 9;
  A.stepPage = 0; A.lastChop = null; A.songSel = null; A.songUndo = null; A.soloG = null; A.soloP = null; A.engine.setSoloGroup(null); A.engine.setSoloPad(null);
  $('#projectSel').value = String(n);
  $('#swing').value = Math.round(A.project.swing * 100);
  if (A.engine.ctx) {
    A.applyMix(); A.applyFx(); A.engine.setBpm(A.project.bpm);
    A.engine.retain(A.project.groups.flatMap((g) => g.pads.map((p) => p.s)));
    await A.preload();
  }
  A.refresh();
};

A.resetProject = async () => {
  storage.remove(`ko.proj.${A.pi}`);
  await A.loadProject(A.pi);
  A.toast(`Project ${A.pi} reset`);
};

// ---- deck ----------------------------------------------------------------------
const padsEl = $('#pads');
const padEls = PAD_LABELS.map((lab, i) => {
  const el = document.createElement('div');
  el.className = 'pad'; el.dataset.i = i;
  el.innerHTML = `<span class="num">${lab}</span><span class="id"></span><span class="nm"></span><i class="led" data-g="0"></i>`;
  padsEl.append(el);
  return el;
});
const groupEls = GROUPS.map((g, i) => {
  const b = document.createElement('button'); b.className = 'btn'; b.textContent = g;
  b.addEventListener('click', () => {
    // SHIFT + B undoes, SHIFT + C copies the pattern, SHIFT + D pastes it (as on the hardware). SHIFT + A selects as usual.
    if (A.shift && i === 1) return A.undoLast();
    if (A.shift && i === 2) return copyPattern();
    if (A.shift && i === 3) return pastePattern();
    A.g = i; A.refresh();
  });
  $('#groups').append(b); return b;
});

function copyPattern() {
  const p = A.pattern(); if (!p) return A.toast('Pattern is empty');
  A.clipboard = copyOf(p); A.toast('Pattern copied');
}
function pastePattern() {
  if (!A.clipboard) return A.toast('Nothing copied');
  const p = A.pattern(true); A.beforeEdit(A.g, p);
  pasteInto(p, A.clipboard); A.save(); A.refresh(); A.toast('Pasted');
}

function flash(i) {
  const el = padEls[i]; if (!el) return;
  el.classList.add('lit'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('lit'), 110);
}

A.refreshPads = () => {
  const grp = A.grp();
  padEls.forEach((el, i) => {
    const pad = grp.pads[i];
    el.classList.toggle('sel', !A.keys && i === A.sel);
    el.classList.toggle('empty', !pad.s);
    el.classList.toggle('armed', A.sampleMode && !pad.s && !A.keys);
    if (A.keys) {
      const n = keyNote(i);
      el.querySelector('.nm').textContent = `${NOTE_NAMES[((n % 12) + 12) % 12]}${3 + Math.floor(n / 12)}`;
      el.querySelector('.id').textContent = '';
    } else {
      el.querySelector('.nm').textContent = A.sampleName(pad.s);
      el.querySelector('.id').textContent = pad.s || '';
    }
  });
  groupEls.forEach((b, i) => { b.classList.toggle('on', i === A.g); b.setAttribute('aria-pressed', i === A.g); });
};

A.refreshModes = () => {
  const grp = A.grp(), pat = getPattern(A.project, A.g);
  $('#patVal').textContent = grp.cur;
  $('#barVal').textContent = pat ? pat.bars : 1;
  $('#beatVal').textContent = pat ? beatsOf(pat) : 4;
  $('#octVal').textContent = A.oct;
  $('#bpmVal').textContent = Math.round(A.project.bpm);
  const set = (id, on) => { const b = $(id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); };
  set('#btnShift', A.shift); set('#sideShift', A.shift); set('#btnKeys', A.keys); set('#sideKeys', A.keys); set('#btnMetro', A.seq.metronome); set('#btnErase', A.erase);
  set('#btnRepeat', !!A.repeat); set('#btnSoloG', A.soloG === A.g); set('#btnSoloP', !!A.soloP && A.soloP.g === A.g && A.soloP.p === A.sel); set('#btnOver', !!A.overwrite); set('#btnSample', !!A.sampleMode);
  $('#btnPlay').classList.toggle('on', A.seq.playing); $('#btnRec').classList.toggle('on', A.seq.recording);
};

A.refreshLcd = () => {
  const grp = A.grp(), pat = getPattern(A.project, A.g);
  $('#lcdProj').textContent = `P${A.pi}`;
  $('#lcdGrp').textContent = `GRP ${GROUPS[A.g]}`;
  $('#lcdPat').textContent = `PAT ${String(grp.cur).padStart(2, '0')}`;
  $('#lcdBars').textContent = `${pat ? pat.bars : 1} BAR${pat && pat.bars > 1 ? 'S' : ''} ${pat ? beatsOf(pat) : 4}/4`;
  const pad = grp.pads[A.keys ? A.keysPad : A.sel];
  $('#lcdSample').textContent = A.keys
    ? `KEYS  ${A.sampleName(grp.pads[A.keysPad].s)}  OCT ${A.oct}`
    : `${PAD_LABELS[A.sel]}  ${pad.s ? `${pad.s} ${A.sampleName(pad.s)}` : 'EMPTY'}`;
};

A.refresh = () => {
  A.refreshPads(); A.refreshModes(); A.refreshLcd();
  A.engine.ctx && A.engine.setBpm(A.project.bpm);
  A.renderPanel();
};

// Dials above the pads (HARDWARE layout) drive the X and Y of the active effect.
const FX_KEYS = ['none', ...Object.keys(EFFECTS)];
const dial = (name, i) => knob('', name, 0.5, (v) => {
  const fx = A.project.fx, p = fx.params[fx.active];
  if (!p) return;
  p[i] = v; A.applyFx(); A.save();
});
const dials = [dial('X', 0), dial('Y', 1)];
$('#dialX').replaceWith(dials[0]); $('#dialY').replaceWith(dials[1]);
$('#fxCycle').addEventListener('click', () => {
  const fx = A.project.fx;
  fx.active = FX_KEYS[(FX_KEYS.indexOf(fx.active) + 1) % FX_KEYS.length];
  A.applyFx(); A.save(); A.refreshDials(); A.renderPanel();
});
A.refreshDials = () => {
  const fx = A.project.fx, def = EFFECTS[fx.active], p = fx.params[fx.active];
  dials[0].setValue(p ? p[0] : 0.5, def ? def.x : '');
  dials[1].setValue(p ? p[1] : 0.5, def ? def.y : '');
  dials.forEach((d) => d.classList.toggle('off', !def));
  $('#fxCycle').textContent = def ? def.label : 'FX OFF';
};
// Volume slider in the side strip: the same main level as the MAIN fader in MIX.
const slider = fader(A.settings.master, (v) => { A.settings.master = v; A.engine.setMaster(v); A.saveSettings(); });
$('#slider').replaceWith(slider); slider.id = 'slider';
$('#sideKeys').addEventListener('click', () => $('#btnKeys').click());
$('#sideFader').addEventListener('click', () => {
  // SHIFT + FADER puts the volume back to its default.
  if (A.shift) { A.settings.master = 0.9; A.engine.setMaster(0.9); A.saveSettings(); slider.setValue(0.9); return A.toast('Volume reset'); }
  A.tab = 'MIX'; setView('panel');
});

// Theme and layout classes live on <html> (js/look.js). HARDWARE is not used on a short landscape phone.
// An unknown theme or layout in the saved settings falls back to the default, so the LOOK buttons show what is in use.
A.applyLook = () => {
  const was = A.hw, r = KoLook.apply(A.settings);
  A.settings.theme = r.theme; A.settings.layout = r.layout; A.hw = r.hw;
  if (A.project) { if (was !== A.hw) setView('pads'); A.refresh(); }
};
for (const q of [KoLook.PHONE, KoLook.SHORT]) matchMedia(q).addEventListener('change', () => A.applyLook());

A.renderPanel = () => {
  A.refreshDials?.(); slider.setValue(A.settings.master);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === A.tab));
  renderTab(A, A.tab, $('#tabBody'));
};

const keyNote = (i) => scaleNote(padSemitone(i), A.settings.scale) + 12 * A.oct;

// SAMPLE mode: empty pads flash. Hold one to record from the microphone, release to stop.
let micStream = null;
const audioSessionType = (t) => { try { if (navigator.audioSession) navigator.audioSession.type = t; } catch { /* unsupported */ } };
async function setSampleMode(on) {
  if (on) {
    try {
      await A.engine.start();
      audioSessionType('play-and-record');
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      A.sampleMode = true;
      A.toast('Sample mode: hold an empty pad to record');
    } catch (err) {
      A.sampleMode = false; audioSessionType('playback');
      A.toast(err.name === 'NotAllowedError' ? 'Microphone permission was declined' : `Microphone unavailable: ${err.message}`);
    }
  } else {
    micStream?.getTracks().forEach((t) => t.stop()); micStream = null;
    audioSessionType('playback'); A.sampleMode = false;
  }
  A.refreshPads(); A.refreshModes();
}
function startSampling(e, el, i) {
  const g = A.g, pad = A.grp().pads[i], chunks = [], t0 = performance.now();
  const mr = new MediaRecorder(micStream);
  mr.ondataavailable = (ev) => chunks.push(ev.data);
  mr.onstop = async () => {
    clearTimeout(limit);
    el.classList.remove('recording');
    if (performance.now() - t0 < 150) return A.toast('Too short, hold the pad while you record');
    try {
      const buf = await A.engine.ctx.decodeAudioData(await new Blob(chunks, { type: mr.mimeType }).arrayBuffer());
      const id = await storeBuffer(A, buf, `rec ${userSamples.list().length + 1}`, true);
      pad.s = id; pad.start = 0; pad.end = 1;
      await A.engine.load(id); A.save(); A.refresh(); A.engine.preview(id);
      A.toast(`Recorded to pad ${PAD_LABELS[i]} (sample ${id})`);
    } catch (err) { A.toast(`Recording failed: ${err.message || err}`); }
  };
  const limit = setTimeout(() => mr.state === 'recording' && mr.stop(), 20000);
  mr.start();
  el.classList.add('recording');
  down.set(e.pointerId, { el, sample: mr, g });
}

// Pads: multi-touch via pointer events.
const down = new Map();
function velocityFor(e, el) {
  if (A.settings.velMode !== 'position') return 100;
  const r = el.getBoundingClientRect();
  return Math.round(35 + 92 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
}
padsEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pad'); if (!el || !A.engine.ctx) return;
  e.preventDefault();
  const i = +el.dataset.i;
  if (A.erase) {
    const pat = A.pattern();
    if (pat) { A.beforeEdit(A.g, pat); clearPad(pat, i); A.save(); A.toast(`Cleared pad ${PAD_LABELS[i]} in this pattern`); A.renderPanel(); }
    el.classList.add('erasing'); down.set(e.pointerId, { el, erase: true });
    return;
  }
  const vel = velocityFor(e, el);
  // A latched note repeat stops when its pad is tapped again.
  const lkey = `${A.g}:${i}`;
  if (A.latched.has(lkey)) { A.seq.stopRepeat(A.g, A.latched.get(lkey)); A.latched.delete(lkey); el.classList.remove('rep'); return; }
  if (A.sampleMode && !A.keys && !A.grp().pads[i].s) { startSampling(e, el, i); return; }
  let padIdx = i, semis = 0;
  if (A.keys) { padIdx = A.keysPad; semis = keyNote(i); }
  else if (A.sel !== i) { A.sel = i; A.refreshPads(); A.refreshLcd(); if (A.tab === 'SOUND') A.renderPanel(); }
  el.classList.add('lit');
  try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  // SHIFT while REPEAT is held keeps the note repeat running after the pad is released.
  const latch = !!(A.repeat && A.shift);
  down.set(e.pointerId, { el, g: A.g, padIdx, repeat: A.repeat, latch, pad: i });
  if (latch) { A.latched.set(lkey, padIdx); el.classList.add('rep'); }
  if (A.repeat) A.seq.startRepeat(A.g, padIdx, vel, semis);
  else A.seq.padDown(A.g, padIdx, vel, semis);
  if (A.panelDirty && A.tab === 'STEP') { A.panelDirty = false; A.renderPanel(); }
});
const release = (e) => {
  const d = down.get(e.pointerId); if (!d) return;
  down.delete(e.pointerId);
  d.el.classList.remove('lit', 'erasing', 'recording');
  if (d.sample) { d.sample.stop(); return; }
  if (d.repeat) { if (!d.latch) A.seq.stopRepeat(d.g, d.padIdx); }
  else if (!d.erase) A.seq.padUp(d.g, d.padIdx);
};
padsEl.addEventListener('pointerup', release);
padsEl.addEventListener('pointercancel', release);
padsEl.addEventListener('contextmenu', (e) => e.preventDefault());

// Mode row and transport.
const bind = (sel, fn) => $(sel).addEventListener('click', fn);
// SHIFT + PATTERN -/+: with a pad held, nudge that pad's notes; otherwise move between bars in the STEP grid.
const heldPad = () => { for (const d of down.values()) if (d.pad !== undefined && !d.erase && !d.sample) return d.pad; return null; };
function shiftPattern(d) {
  const pad = heldPad(), pat = A.pattern();
  if (pad !== null) {
    if (!pat) return A.toast('This pattern is empty');
    const step = GRIDS[A.seq.quantise] || 1, hits = pat.ev.filter((e) => e.p === pad);
    if (!hits.length) return A.toast(`No notes on pad ${PAD_LABELS[pad]} to nudge`);
    A.beforeEdit(A.g, pat); hits.forEach((e) => nudgeEvent(pat, e, d * step));
    A.save(); A.renderPanel(); return A.toast(`Nudged pad ${PAD_LABELS[pad]} by ${d * step} tick${step > 1 ? 's' : ''}`);
  }
  const bars = pat ? pat.bars : 1, pages = Math.max(1, Math.ceil(bars / STEP_PAGE_BARS));
  A.stepPage = Math.max(0, Math.min(pages - 1, (A.stepPage || 0) + d));
  A.tab = 'STEP'; A.renderPanel();
  A.toast(`Bars ${A.stepPage * STEP_PAGE_BARS + 1} to ${Math.min(bars, (A.stepPage + 1) * STEP_PAGE_BARS)}`);
}
bind('#patDn', () => { if (A.shift) return shiftPattern(-1); const g = A.grp(); g.cur = g.cur <= 1 ? PATTERNS_PER_GROUP : g.cur - 1; A.save(); A.refresh(); });
bind('#patUp', () => { if (A.shift) return shiftPattern(1); const g = A.grp(); g.cur = g.cur >= PATTERNS_PER_GROUP ? 1 : g.cur + 1; A.save(); A.refresh(); });
const bars = (d) => { const pat = A.pattern(true); A.beforeEdit(A.g, pat); setBars(pat, pat.bars + d); A.save(); A.refresh(); };
// SHIFT + BARS +: duplicate the pattern to twice its length. SHIFT + BARS -: halve it.
bind('#barDn', () => A.shift ? $('#btnHalf').click() : bars(-1)); bind('#barUp', () => A.shift ? $('#btnX2').click() : bars(1));
const beats = (d) => { const pat = A.pattern(true); A.beforeEdit(A.g, pat); setBeats(pat, beatsOf(pat) + d); A.save(); A.refresh(); };
bind('#beatDn', () => beats(-1)); bind('#beatUp', () => beats(1));
bind('#octDn', () => { A.oct = Math.max(-3, A.oct - 1); A.refresh(); });
bind('#octUp', () => { A.oct = Math.min(3, A.oct + 1); A.refresh(); });
bind('#btnKeys', () => { A.keys = !A.keys; if (A.keys) A.keysPad = A.sel; A.refresh(); });
bind('#btnUndo', () => A.undoLast());
bind('#btnMetro', () => { A.seq.metronome = !A.seq.metronome; A.settings.metronome = A.seq.metronome; A.saveSettings(); A.refreshModes(); });
const hold = (id, key) => {
  const b = $(id);
  b.addEventListener('pointerdown', () => { A[key] = true; A.refreshModes(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { A[key] = false; A.refreshModes(); });
};
hold('#btnRepeat', 'repeat');
// SHIFT is held, like the hardware key. The Shift key on a keyboard does the same.
const setShift = (on) => {
  if (A.shift === on) return;
  A.shift = on; document.documentElement.classList.toggle('shift', on); A.refreshModes();
};
for (const id of ['#btnShift', '#sideShift']) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* not capturable */ } setShift(true); });
  for (const ev of ['pointerup', 'pointercancel']) b.addEventListener(ev, () => setShift(false));
}
addEventListener('keydown', (e) => { if (e.key === 'Shift') setShift(true); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') setShift(false); });
addEventListener('blur', () => setShift(false));
bind('#btnCommit', () => {
  const n = nextFreeScene(A.project);
  if (n > 99) return A.toast('All 99 scenes are used');
  A.project.scenes[String(n)] = sceneFromCurrent(A.project); A.project.song.push(n);
  A.save(); A.renderPanel(); A.toast(`Committed as scene ${n} and added to the song`);
});
// Pattern tools.
const edit = (fn) => { const pat = A.pattern(true); A.beforeEdit(A.g, pat); const r = fn(pat); A.save(); A.refresh(); return r; };
bind('#btnNextEmpty', () => {
  const n = nextEmptyPattern(A.project, A.g, A.grp().cur);
  if (n === null) return A.toast('No empty pattern left');
  A.grp().cur = n; A.save(); A.refresh();
});
bind('#btnX2', () => { if (!edit((p) => doubleLength(p))) A.toast(`Patterns can be up to ${MAX_BARS} bars`); });
bind('#btnHalf', () => { if (!edit((p) => halveLength(p))) A.toast('Already one bar'); });
const correct = (pad) => {
  if (!GRIDS[A.seq.quantise]) return A.toast('Set TIMING to a grid first');
  const pat = A.pattern(); if (!pat) return A.toast('This pattern is empty');
  const n = edit((p) => correctEvents(p, A.seq.quantise, pad));
  A.toast(n ? `Corrected ${n} hit${n > 1 ? 's' : ''} to ${A.seq.quantise}` : 'Nothing to correct');
};
bind('#btnCorrPad', () => correct(A.sel));
bind('#btnCorrAll', () => correct(null));
bind('#btnSoloG', () => { A.soloG = A.soloG === A.g ? null : A.g; A.engine.setSoloGroup(A.soloG); A.refreshModes(); });
bind('#btnSoloP', () => {
  const same = A.soloP && A.soloP.g === A.g && A.soloP.p === A.sel;
  A.soloP = same ? null : { g: A.g, p: A.sel }; A.engine.setSoloPad(A.soloP?.g, A.soloP?.p); A.refreshModes();
});
bind('#btnOver', () => { A.overwrite = !A.overwrite; A.refreshModes(); if (A.overwrite) A.toast('The next recording replaces this pattern from the start'); });
// SHIFT + SAMPLE is CHOP on the hardware; the chop tools are in the SOUND tab.
bind('#btnSample', () => { if (A.shift) { A.tab = 'SOUND'; setView('panel'); return A.toast('Chop is in the SOUND tab'); } setSampleMode(!A.sampleMode); });
const erase = $('#btnErase');
erase.addEventListener('pointerdown', () => {
  // SHIFT + ERASE opens the system settings; here that is the PROJECT tab.
  if (A.shift) { A.tab = 'PROJECT'; setView('panel'); return; }
  A.erase = true; A.refreshModes();
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) erase.addEventListener(ev, () => { A.erase = false; A.refreshModes(); });

$('#timingSel').innerHTML = ['off', ...Object.keys(GRIDS)].map((k) => `<option value="${k}">${k === 'off' ? 'OFF' : k}</option>`).join('');
// SHIFT + TIMING opens timing correct (here: correct every note to the current grid).
$('#timingSel').addEventListener('pointerdown', (e) => { if (A.shift) { e.preventDefault(); correct(null); } });
$('#timingSel').addEventListener('change', (e) => { A.seq.quantise = e.target.value; A.settings.quantise = e.target.value; A.saveSettings(); });

bind('#btnPlay', async () => {
  await A.engine.start();
  // SHIFT + PLAY starts again from the beginning of the pattern, keeping record armed.
  if (A.shift && A.seq.playing) { const rec = A.seq.recording; A.seq.stop(); A.seq.start({ record: rec, countIn: false }); wakeLock(true); return A.refreshModes(); }
  if (A.seq.playing) A.seq.stop(); else { A.seq.start(); wakeLock(true); }
  A.refreshModes();
});
bind('#btnStop', () => { A.seq.stop(); wakeLock(false); A.refreshModes(); });
bind('#btnRec', async () => {
  await A.engine.start();
  if (!A.seq.playing) {
    if (A.overwrite) {
      const pat = A.pattern();
      if (pat?.ev.length) { A.beforeEdit(A.g, pat); clearPattern(pat); A.save(); }
      A.overwrite = false;
    }
    A.seq.start({ record: true }); wakeLock(true);
  }
  else A.seq.recording = !A.seq.recording;
  A.refreshModes();
});

// Tempo.
const setBpm = (b) => { A.project.bpm = Math.max(40, Math.min(300, Math.round(b * 10) / 10)); A.engine.ctx && A.engine.setBpm(A.project.bpm); A.save(); A.refreshModes(); };
bind('#bpmDn', () => setBpm(A.project.bpm - 1)); bind('#bpmUp', () => setBpm(A.project.bpm + 1));
let taps = [];
bind('#bpmTap', () => {
  const t = performance.now(); taps = taps.filter((x) => t - x < 2500); taps.push(t);
  if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
});
{
  const v = $('#bpmVal'); let y0, b0;
  v.addEventListener('pointerdown', (e) => { y0 = e.clientY; b0 = A.project.bpm; v.setPointerCapture(e.pointerId); });
  v.addEventListener('pointermove', (e) => { if (y0 !== undefined && v.hasPointerCapture(e.pointerId)) setBpm(b0 + (y0 - e.clientY) / 4); });
  v.addEventListener('pointerup', () => { y0 = undefined; });
}
$('#swing').addEventListener('input', (e) => { A.project.swing = e.target.value / 100; A.save(); });

$('#projectSel').innerHTML = Array.from({ length: PROJECT_COUNT }, (_, i) => `<option value="${i + 1}">PROJECT ${i + 1}</option>`).join('');
$('#projectSel').addEventListener('change', (e) => A.loadProject(+e.target.value));

// Tabs.
// On a phone the bar also carries a PADS button, and the panels take the whole screen (see the phone layer in style.css).
const setView = (v) => {
  A.view = v; closePopups();
  $('#app').classList.toggle('v-pads', v === 'pads'); $('#app').classList.toggle('v-panel', v !== 'pads');
  A.renderPanel();
};
for (const t of TABS) {
  const b = document.createElement('button'); b.textContent = t; b.dataset.tab = t; b.role = 'tab';
  b.addEventListener('click', () => { A.tab = t; setView('panel'); });
  $('#tabs').append(b);
}
const padsBtn = document.createElement('button');
padsBtn.textContent = 'PADS'; padsBtn.dataset.view = 'pads'; padsBtn.className = 'phone-only';
padsBtn.addEventListener('click', () => setView('pads'));
$('#tabs').prepend(padsBtn);

// Phone pop-ups: the header extras (...) and the TOOLS sheet. Tapping anywhere else closes them and still reaches the pad.
const popups = [
  { btn: $('#btnMore'), box: $('#top'), cls: 'open', inside: '#top' },
  { btn: $('#btnTools'), box: $('#modes'), cls: 'sheet', inside: '#modesMore, #btnTools', onOpen: (box) => box.style.setProperty('--sheet-b', `${innerHeight - box.getBoundingClientRect().top + 8}px`) },
];
function closePopups(except) {
  for (const p of popups) if (p !== except) { p.box.classList.remove(p.cls); p.btn.setAttribute('aria-expanded', 'false'); }
}
for (const p of popups) p.btn.addEventListener('click', () => {
  closePopups(p);
  const open = p.box.classList.toggle(p.cls);
  if (open) p.onOpen?.(p.box);
  p.btn.setAttribute('aria-expanded', String(open));
});
addEventListener('pointerdown', (e) => {
  for (const p of popups) if (p.box.classList.contains(p.cls) && !e.target.closest(p.inside)) closePopups();
}, true);

// Pad LEDs, as on the hardware: a pad lights when it holds a note. A small dot shows a pad that has notes in the pattern;
// while playing, the dot is lit on the pads that have a note on the current step (the STEP grid's step size).
const LED_COLOURS = ['--led-a', '--led-b', '--led-c', '--led-d'];
function updateLeds(pos) {
  const playing = pos !== null && pos >= 0;
  const pat = A.keys ? null : (A.seq.playing ? A.seq._patFor(A.g) : A.pattern());
  const has = new Set(), hit = new Set();
  if (pat) {
    const grid = GRIDS[A.stepGrid] || 24;
    let from = -1, to = -1;
    if (playing) {
      const base = A.seq.songMode ? pos - A.seq.sceneStart : pos;
      from = Math.floor((base % patternTicks(pat)) / grid) * grid; to = from + grid;
    }
    for (const ev of pat.ev) { has.add(ev.p); if (ev.t >= from && ev.t < to) hit.add(ev.p); }
  }
  padEls.forEach((el, i) => {
    const st = hit.has(i) ? 'hit' : has.has(i) ? 'has' : '';
    if (el._led === st && el._ledG === A.g) return;
    el._led = st; el._ledG = A.g;
    const led = el.lastElementChild;
    led.className = `led ${st}`; led.style.setProperty('--led', `var(${LED_COLOURS[A.g]})`);
  });
}

// Frame loop: LCD position, meter, step playhead.
const lcdPos = $('#lcdPos'), meterEl = $('#meter');
function frame() {
  const pos = A.seq.position();
  const el = lcdPos;
  if (pos === null) el.textContent = '--.-.-';
  else if (pos < 0) el.textContent = 'COUNT';
  else { const p = ticksToPosition(Math.floor(pos), A.seq.countLen); el.textContent = `${String(p.bar).padStart(2, '0')}.${p.beat}.${p.sixteenth}`; }
  updateLeds(pos);
  meterEl.style.width = `${Math.min(100, A.engine.level() * 100)}%`;
  A.onFrame?.(pos);
  if (A.seq.playing === false && A._wasPlaying) { A._wasPlaying = false; A.refreshModes(); }
  if (A.seq.playing) A._wasPlaying = true;
  requestAnimationFrame(frame);
}

// Screen wake lock while playing (helps on long flights).
let lock = null, wantLock = false;
document.addEventListener('visibilitychange', () => {
  // The system drops the lock when the page is hidden; take it again on return.
  if (document.visibilityState === 'visible' && wantLock && A.seq.playing) wakeLock(true);
});
async function wakeLock(on) {
  wantLock = on;
  try {
    if (on && 'wakeLock' in navigator) lock = await navigator.wakeLock.request('screen');
    else if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* not allowed, ignore */ }
}

// iOS: route Web Audio to the media channel so the silent switch does not mute it.
function audioSession() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
}

// ---- boot ----------------------------------------------------------------------
async function boot() {
  A.applyLook();
  A.seq.metronome = A.settings.metronome; A.seq.countIn = A.settings.countIn; A.seq.quantise = A.settings.quantise;
  $('#timingSel').value = A.settings.quantise;
  // The catalogue lists the sounds in samples/. It is optional: without it the app runs on imported and recorded sounds only.
  try {
    const r = await fetch('samples/catalogue.json');
    const list = r.ok ? await r.json() : [];
    A.catalogue = Array.isArray(list) ? list : [];
    A.byId = new Map(A.catalogue.map((c) => [c.id, c]));
  } catch { A.catalogue = []; }
  try { await userSamples.open(); } catch { /* private mode: user samples unavailable */ }
  await A.loadProject(A.settings.pi || 1);
  requestAnimationFrame(frame);

  $('#startBtn').addEventListener('click', async () => {
    audioSession();
    await A.engine.start();
    A.applyMix(); A.applyFx(); A.engine.setBpm(A.project.bpm);
    $('#startBtn').disabled = true;
    await A.preload();
    $('#start').classList.add('hide');
    A.refresh();
  });
  // iOS can suspend or interrupt the context (calls, backgrounding). Resume on any touch.
  addEventListener('pointerdown', () => { const c = A.engine.ctx; if (c && c.state !== 'running') c.resume(); }, true);
  document.addEventListener('visibilitychange', () => { const c = A.engine.ctx; if (!document.hidden && c && c.state !== 'running') c.resume(); });
  addEventListener('pagehide', () => { if (!A.resetting) storage.set(`ko.proj.${A.pi}`, A.project); });
  // Block double-tap zoom and pinch on iPad.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  const { initOffline } = await import('./offline.js');
  initOffline(A);
}
boot();
