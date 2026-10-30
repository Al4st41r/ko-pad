// Right-hand panel: STEP, SOUND, FX, MIX, SONG and PROJECT tabs.
import { GRIDS, STEP_PAGE_BARS, BAR_TICKS, PAD_LABELS, EFFECTS, PUNCH_FX, GROUPS, USER_SAMPLE_MIN, SCALES } from './data.js';
import { toggleStep, clearPattern, patternTicks, barTicks, beatsOf, sceneFromCurrent, FITS, eraseScene, songInsert, songCut, songMove, clearAuto, getPattern, nudgeEvent, changeVelocity, changeDuration, eventAt, copyOf, pasteInto, normaliseProject } from './model.js';
import { encodeWav } from './audio.js';
import { equalBounds, transientBounds, marksToBounds, assignSlices, silenceBounds } from './chop.js';
import { storage, userSamples } from './store.js';

export const TABS = ['STEP', 'SOUND', 'FX', 'MIX', 'SONG', 'PROJECT'];

const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let soundState = { cat: 'ALL', q: '', scroll: 0 };
let stepVel = 100;

export function renderTab(A, name, body) {
  A.onFrame = null;
  const keep = body.scrollTop;
  body.replaceChildren();
  ({ STEP: stepTab, SOUND: soundTab, FX: fxTab, MIX: mixTab, SONG: songTab, PROJECT: projectTab }[name])(A, body);
  body.scrollTop = keep;
}

// ---- STEP ----------------------------------------------------------------------
function stepTab(A, body) {
  const pat = A.pattern(false);
  const grid = GRIDS[A.stepGrid], bars = pat ? pat.bars : 1;
  const bt = pat ? barTicks(pat) : BAR_TICKS;
  const cols = (bars * bt) / grid;
  const pageCols = (STEP_PAGE_BARS * bt) / grid, pages = Math.ceil(cols / pageCols);
  A.stepPage = Math.max(0, Math.min(pages - 1, A.stepPage || 0));
  const c0 = A.stepPage * pageCols, c1 = Math.min(cols, c0 + pageCols);
  const gridOpts = ['1/8', '1/8T', '1/16', '1/16T', '1/32'].map((k) => `<option ${k === A.stepGrid ? 'selected' : ''}>${k}</option>`).join('');

  const head = h(`<div class="row">
    <span class="lab">GRID</span><select id="sg">${gridOpts}</select>
    <span class="lab">VELOCITY</span><input id="sv" type="range" min="10" max="127" value="${stepVel}" style="width:110px">
    <button class="btn small" id="cp">COPY</button><button class="btn small" id="ps">PASTE</button><button class="btn small" id="cl">CLEAR</button>
    <button class="btn small ${A.stepEdit ? 'on' : ''}" id="ed" aria-pressed="${!!A.stepEdit}">EDIT NOTES</button>
    ${pages > 1 ? `<span class="lab">BARS ${A.stepPage * STEP_PAGE_BARS + 1} TO ${Math.min(bars, (A.stepPage + 1) * STEP_PAGE_BARS)}</span>
    <button class="btn small" id="pp" ${A.stepPage ? '' : 'disabled'}>&lsaquo;</button><button class="btn small" id="pn" ${A.stepPage < pages - 1 ? '' : 'disabled'}>&rsaquo;</button>
    <button class="btn small ${A.stepFollow !== false ? 'on' : ''}" id="pf" aria-pressed="${A.stepFollow !== false}">FOLLOW</button>` : ''}
  </div>`);
  body.append(head);
  head.querySelector('#sg').onchange = (e) => { A.stepGrid = e.target.value; A.renderPanel(); };
  head.querySelector('#sv').oninput = (e) => { stepVel = +e.target.value; };
  head.querySelector('#cp').onclick = () => { const p = A.pattern(); if (!p) return A.toast('Pattern is empty'); A.clipboard = copyOf(p); A.toast('Pattern copied'); };
  head.querySelector('#ps').onclick = () => {
    if (!A.clipboard) return A.toast('Nothing copied');
    const p = A.pattern(true); A.beforeEdit(A.g, p);
    pasteInto(p, A.clipboard); A.save(); A.renderPanel(); A.refreshModes(); A.toast('Pasted');
  };
  head.querySelector('#cl').onclick = () => { const p = A.pattern(); if (!p) return; A.beforeEdit(A.g, p); clearPattern(p); A.save(); A.renderPanel(); };

  if (pages > 1) {
    head.querySelector('#pp').onclick = () => { A.stepPage--; A.stepFollow = false; A.renderPanel(); };
    head.querySelector('#pn').onclick = () => { A.stepPage++; A.stepFollow = false; A.renderPanel(); };
    head.querySelector('#pf').onclick = () => { A.stepFollow = A.stepFollow === false; A.renderPanel(); };
  }
  head.querySelector('#ed').onclick = () => { A.stepEdit = !A.stepEdit; A.selEv = null; A.renderPanel(); };
  if (A.selEv && !(pat && pat.ev.includes(A.selEv.ev))) A.selEv = null;
  if (A.stepEdit) noteEditBar(A, body, pat, grid);

  const wrap = h('<div class="stepwrap"></div>');
  const steps = h('<div class="steps"></div>');
  steps.style.gridTemplateColumns = `104px repeat(${c1 - c0}, minmax(${grid <= 16 ? 18 : 24}px, 1fr))`;
  const on = new Map();
  if (pat) for (const e of pat.ev) on.set(`${e.p}:${Math.floor(e.t / grid)}`, e.v);
  const frag = document.createDocumentFragment();
  for (let r = 0; r < 12; r++) {
    const pad = A.grp().pads[r];
    const lab = h(`<div class="steplab ${r === A.sel ? 'sel' : ''}" data-r="${r}"><b>${PAD_LABELS[r]}</b><span>${esc(A.sampleName(pad.s))}</span></div>`);
    frag.append(lab);
    for (let c = c0; c < c1; c++) {
      const tick = c * grid, endT = tick + grid;
      const cls = ['sc'];
      if (endT % bt === 0) cls.push('bar'); else if (endT % 96 === 0) cls.push('beat');
      if (Math.floor(tick / 96) % 2) cls.push('alt');
      const v = on.get(`${r}:${c}`);
      if (v !== undefined) cls.push('on');
      if (A.selEv && A.selEv.ev.p === r && Math.floor(A.selEv.ev.t / grid) === c) cls.push('sel');
      const d = document.createElement('div');
      d.className = cls.join(' '); d.dataset.r = r; d.dataset.c = c;
      if (v !== undefined) d.style.setProperty('--v', v / 127);
      frag.append(d);
    }
  }
  steps.append(frag);
  const ph = h('<div class="playhead"></div>');
  steps.append(ph); wrap.append(steps); body.append(wrap);
  body.append(h(`<p class="note">Tap a cell to place or remove a hit. Pad hits recorded live appear here. ${bars} bar${bars > 1 ? 's' : ''}, ${pat ? beatsOf(pat) : 4}/4. Use BARS under the pads to change length (up to 99). Long patterns show four bars at a time.</p>`));

  steps.addEventListener('pointerdown', (e) => {
    const lab = e.target.closest('.steplab');
    if (lab) {
      const r = +lab.dataset.r; A.sel = r; A.refreshPads(); A.refreshLcd();
      steps.querySelectorAll('.steplab').forEach((l) => l.classList.toggle('sel', +l.dataset.r === r));
      if (A.engine.ctx) A.engine.trigger(A.g, r, A.grp().pads[r], 100);
      return;
    }
    const cell = e.target.closest('.sc'); if (!cell || !A.engine.ctx) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    if (A.stepEdit) {
      const hit = pat && eventAt(pat, r, c * grid, grid);
      A.selEv = hit ? { ev: hit } : null;
      if (hit) A.engine.trigger(A.g, r, A.grp().pads[r], hit.v);
      A.renderPanel(); return;
    }
    const p = A.pattern(true); A.beforeEdit(A.g, p);
    const added = toggleStep(p, c * grid, r, grid, stepVel);
    cell.classList.toggle('on', added);
    if (added) { cell.style.setProperty('--v', stepVel / 127); A.engine.trigger(A.g, r, A.grp().pads[r], stepVel); }
    A.save();
  });

  const labW = 104;
  let stepsW = 0;
  new ResizeObserver(() => { stepsW = steps.scrollWidth; }).observe(steps);
  A.onFrame = (pos) => {
    if (pos === null || pos < 0) { ph.style.display = 'none'; return; }
    const p = A.pattern(); const len = p ? patternTicks(p) : BAR_TICKS;
    const base = A.seq.songMode ? pos - A.seq.sceneStart : pos;
    const at = base % len, pageTicks = STEP_PAGE_BARS * bt;
    if (A.stepFollow !== false && A.seq.playing && Math.floor(at / pageTicks) !== A.stepPage) { A.stepPage = Math.floor(at / pageTicks); A.renderPanel(); return; }
    const off = at - c0 * grid, span = (c1 - c0) * grid;
    if (off < 0 || off >= span) { ph.style.display = 'none'; return; }
    const total = (stepsW || steps.scrollWidth) - labW;
    ph.style.display = 'block';
    ph.style.left = `${labW + (off / span) * total}px`;
  };
}

function noteEditBar(A, body, pat, grid) {
  const sel = A.selEv?.ev;
  const bar = h(`<div class="row"><span class="lab">NOTE</span>
    <button class="btn small" data-k="n-g" ${sel ? '' : 'disabled'}>&laquo; STEP</button><button class="btn small" data-k="n-1" ${sel ? '' : 'disabled'}>&lsaquo; TICK</button>
    <button class="btn small" data-k="n+1" ${sel ? '' : 'disabled'}>TICK &rsaquo;</button><button class="btn small" data-k="n+g" ${sel ? '' : 'disabled'}>STEP &raquo;</button>
    <button class="btn small" data-k="v-" ${sel ? '' : 'disabled'}>VEL &minus;</button><button class="btn small" data-k="v+" ${sel ? '' : 'disabled'}>VEL +</button>
    <button class="btn small" data-k="d-" ${sel ? '' : 'disabled'}>LEN &minus;</button><button class="btn small" data-k="d+" ${sel ? '' : 'disabled'}>LEN +</button>
    <span class="dim" id="ninfo">${sel ? `tick ${sel.t}  vel ${sel.v}  length ${sel.d || 24}` : 'Tap a placed hit to select it'}</span></div>`);
  body.append(bar);
  bar.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k || !sel || !pat) return;
    A.beforeEdit(A.g, pat);
    ({ 'n-g': () => nudgeEvent(pat, sel, -grid), 'n-1': () => nudgeEvent(pat, sel, -1), 'n+1': () => nudgeEvent(pat, sel, 1), 'n+g': () => nudgeEvent(pat, sel, grid),
      'v-': () => changeVelocity(sel, -8), 'v+': () => changeVelocity(sel, 8), 'd-': () => changeDuration(pat, sel, -grid / 2), 'd+': () => changeDuration(pat, sel, grid / 2) })[k]();
    A.save(); A.renderPanel();
  });
}

// ---- SOUND ---------------------------------------------------------------------
function soundTab(A, body) {
  const pad = A.pad(), id = pad.s;
  const cats = ['ALL', 'KICK', 'SNARE', 'CYMB', 'PERC', 'BASS', 'MELOD', 'USER'];
  const root = h(`<div class="soundgrid"><div id="L"></div><div id="R"></div></div>`);
  body.append(root);
  const L = root.querySelector('#L'), R = root.querySelector('#R');

  L.append(h(`<h3>SAMPLE FOR PAD ${PAD_LABELS[A.sel]} (GROUP ${GROUPS[A.g]})</h3>`));
  const num = h(`<div class="row tight"><input id="num" type="number" inputmode="numeric" min="1" max="999" placeholder="Sample number" style="width:180px" value=""><button class="btn small" id="go">ASSIGN</button><button class="btn small" id="clr">EMPTY PAD</button></div>`);
  L.append(num);
  const chips = h(`<div class="chips">${cats.map((c) => `<button class="btn small ${c === soundState.cat ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div>`);
  L.append(chips);
  L.append(h(`<div class="row"><input id="q" type="search" placeholder="Search names" style="width:100%" value="${esc(soundState.q)}"></div>`));
  const list = h('<div class="samplelist" role="listbox"></div>'); L.append(list);

  const items = () => {
    const q = soundState.q.toLowerCase();
    const all = [...A.catalogue.map((c) => ({ id: c.id, name: c.name, cat: c.cat, dur: c.dur })),
      ...userSamples.list().map((u) => ({ id: u.id, name: u.name, cat: 'USER', dur: u.dur }))];
    return all.filter((s) => (soundState.cat === 'ALL' || s.cat === soundState.cat) && (!q || s.name.toLowerCase().includes(q) || String(s.id) === q));
  };
  const assign = async (sid) => {
    A.pad().s = sid; A.pad().start = 0; A.pad().end = 1;
    if (A.engine.ctx) { await A.engine.load(sid).catch(() => A.toast(`Sample ${sid} could not be loaded`)); A.engine.preview(sid); }
    A.save(); A.refreshPads(); A.refreshLcd(); A.renderPanel();
  };
  const fill = () => {
    list.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const s of items()) {
      const row = h(`<div class="sample ${s.id === id ? 'cur' : ''}" data-id="${s.id}"><button class="btn small" data-pv="${s.id}" aria-label="Preview">&#9654;</button><span class="n">${s.id}</span><span class="t">${esc(s.name)}</span><span class="d">${s.dur.toFixed(2)}s</span></div>`);
      frag.append(row);
    }
    if (!frag.childNodes.length) frag.append(h(`<div class="sample dim">${A.catalogue.length || userSamples.list().length ? 'No samples match.' : 'No sounds yet. Use IMPORT FILES below to add your own.'}</div>`));
    list.append(frag);
  };
  fill();
  list.scrollTop = soundState.scroll;
  list.addEventListener('scroll', () => { soundState.scroll = list.scrollTop; });
  list.addEventListener('click', (e) => {
    const pv = e.target.closest('[data-pv]');
    if (pv) return A.engine.preview(+pv.dataset.pv);
    const row = e.target.closest('.sample[data-id]'); if (row) assign(+row.dataset.id);
  });
  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; soundState = { cat: b.dataset.c, q: soundState.q, scroll: 0 }; A.renderPanel(); });
  L.querySelector('#q').addEventListener('input', (e) => { soundState.q = e.target.value; soundState.scroll = 0; fill(); });
  num.querySelector('#go').onclick = () => {
    const n = +num.querySelector('#num').value;
    const known = A.byId.has(n) || userSamples.meta.has(n);
    if (!known) return A.toast(`No sample numbered ${n || '?'}`);
    assign(n);
  };
  num.querySelector('#clr').onclick = () => { A.pad().s = 0; A.save(); A.refreshPads(); A.refreshLcd(); A.renderPanel(); };

  // Right column: waveform and parameters.
  R.append(h('<h3>EDIT</h3>'));
  const cv = h('<canvas class="wave"></canvas>'); R.append(cv);
  drawWave(A, cv, pad);
  trimHandles(A, cv, pad);

  const param = (label, key, min, max, step, fmt) => {
    const row = h(`<div class="param"><span class="lab">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${pad[key]}"><span class="v"></span></div>`);
    const v = row.querySelector('.v'), inp = row.querySelector('input');
    const show = () => { v.textContent = fmt(+inp.value); };
    inp.oninput = () => { pad[key] = +inp.value; show(); A.save(); };
    show(); R.append(row);
  };
  param('VOLUME', 'vol', 0, 1.5, 0.01, (x) => `${Math.round(x * 100)}%`);
  param('PITCH', 'pitch', -12, 12, 0.5, (x) => `${x > 0 ? '+' : ''}${x} st`);
  param('PAN', 'pan', -1, 1, 0.05, (x) => (x === 0 ? 'C' : `${x < 0 ? 'L' : 'R'}${Math.round(Math.abs(x) * 100)}`));
  param('ATTACK', 'atk', 0, 1, 0.005, (x) => `${Math.round(x * 1000)} ms`);
  param('RELEASE', 'rel', 0.005, 2, 0.005, (x) => `${Math.round(x * 1000)} ms`);

  const mode = h(`<div class="row" style="margin-top:8px"><span class="lab" style="width:78px">PLAY MODE</span><div class="seg">${['oneshot', 'key', 'loop'].map((m) => `<button data-m="${m}" class="${pad.mode === m ? 'on' : ''}">${{ oneshot: 'ONE-SHOT', key: 'HOLD', loop: 'LOOP' }[m]}</button>`).join('')}</div></div>`);
  mode.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; pad.mode = b.dataset.m; A.save(); A.renderPanel(); });
  R.append(mode);
  const mg = h(`<div class="row"><span class="lab" style="width:78px">MUTE GROUP</span><div class="seg">${[0, 1, 2, 3].map((m) => `<button data-g="${m}" class="${pad.mg === m ? 'on' : ''}">${m ? m : 'OFF'}</button>`).join('')}</div></div>`);
  mg.addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (!b) return; pad.mg = +b.dataset.g; A.save(); A.renderPanel(); });
  R.append(mg);
  const fit = h(`<div class="row"><span class="lab" style="width:78px">FIT TO BARS</span><div class="seg">${FITS.map((f) => `<button data-f="${f}" class="${pad.fit === f ? 'on' : ''}">${f ? f : 'OFF'}</button>`).join('')}</div></div>`);
  fit.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; pad.fit = +b.dataset.f; A.save(); A.renderPanel(); });
  R.append(fit);
  R.append(h('<p class="note">FIT TO BARS speeds the sound up or down so the played part lasts that many bars at the project tempo. It is varispeed, so the pitch changes with the speed. Use it with LOOP to lock a break to the beat.</p>'));

  chopSection(A, R, pad);

  R.append(h('<h3>RECORD OR IMPORT</h3>'));
  const rec = h(`<div class="row"><button class="btn" id="rec">&#9679; RECORD MIC</button><button class="btn" id="imp">IMPORT FILES</button><button class="btn" id="rs">&#9679; RESAMPLE</button><button class="btn small" id="del" ${id >= USER_SAMPLE_MIN ? '' : 'disabled'}>DELETE USER SAMPLE</button><input id="file" type="file" accept="audio/*" multiple hidden></div>`);
  R.append(rec);
  R.append(h('<p class="note">Recordings, imports and resamples are stored on this device (up to 20 s each) in slots 600 to 999 and can be used in any project. RESAMPLE records everything you hear from the main output, so play a pattern or the pads while it runs. TRIM SILENCE removes quiet gaps at the start and end of microphone and resample recordings, not imported files. A resample stops by itself after 20 seconds.</p>'));
  micRecorder(A, rec.querySelector('#rec'), assign);
  const rsBtn = rec.querySelector('#rs');
  // Stops the capture and stores it. Also called by the engine when the 20 s limit is reached.
  const finishResample = async () => {
    if (!A.engine.capturing) return;
    try {
      const buf = A.engine.stopCapture();
      const b = document.querySelector('#rs');
      if (b) { b.innerHTML = '&#9679; RESAMPLE'; b.classList.remove('rec', 'on'); }
      if (!buf) return A.toast('Nothing was recorded');
      assign(await storeBuffer(A, buf, `resample ${userSamples.list().length + 1}`, true));
    } catch (err) { A.toast(`Resample failed: ${err.message || err}`); }
  };
  rsBtn.onclick = async () => {
    try {
      await A.engine.start();
      if (A.engine.capturing) return finishResample();
      await A.engine.startCapture(20, finishResample);
      rsBtn.textContent = '■ STOP RESAMPLE'; rsBtn.classList.add('rec', 'on');
      A.toast('Recording the main output. Play something, then press STOP RESAMPLE.', 3500);
    } catch (err) { A.toast(`Resample failed: ${err.message || err}`); }
  };
  if (A.engine.capturing) { rsBtn.textContent = '■ STOP RESAMPLE'; rsBtn.classList.add('rec', 'on'); }
  const trim = h(`<button class="btn small ${A.settings.trimSilence === false ? '' : 'on'}" id="ts">TRIM SILENCE</button>`);
  trim.onclick = () => { A.settings.trimSilence = A.settings.trimSilence === false; A.saveSettings(); A.renderPanel(); };
  rec.append(trim);
  rec.querySelector('#imp').onclick = () => rec.querySelector('#file').click();
  // Several files at once fill the pads from the selected one onwards (to the end of the group). One file goes to the selected pad.
  // Pads that already hold a sound are replaced, so ask first. Files beyond the last pad are kept in the USER list.
  rec.querySelector('#file').onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    const room = 12 - A.sel, pads = A.grp().pads;
    if (pads.slice(A.sel, A.sel + files.length).some((pd) => pd.s) && !confirm('Importing replaces the sounds already on these pads. Continue?')) return;
    let ok = 0, assigned = 0, last = null;
    try { await A.engine.start(); } catch { /* the decode below reports it */ }
    for (const f of files) {
      try {
        const buf = await A.engine.ctx.decodeAudioData(await f.arrayBuffer());
        const sid = await storeBuffer(A, buf, f.name.replace(/\.[^.]+$/, ''));
        if (assigned < room) { const pd = pads[A.sel + assigned]; pd.s = sid; pd.start = 0; pd.end = 1; await A.engine.load(sid); assigned++; }
        last = sid; ok++;
      } catch (err) { A.toast(`Could not import ${f.name}: ${err.message || 'unsupported file'}`); }
    }
    if (!ok) return;
    A.save(); A.refresh(); A.engine.preview(last);
    const extra = ok - assigned;
    A.toast(files.length === 1 ? `Imported to pad ${PAD_LABELS[A.sel]}` : `Imported ${ok} of ${files.length}, ${assigned} assigned from pad ${PAD_LABELS[A.sel]}${extra ? `. ${extra} more are in the USER list` : ''}`, extra ? 5000 : 2200);
  };
  rec.querySelector('#del').onclick = async () => {
    await userSamples.remove(id); A.engine.forget(id);
    A.project.groups.forEach((g) => g.pads.forEach((p) => { if (p.s === id) p.s = 0; }));
    A.save(); A.refresh(); A.toast('Sample deleted');
  };
}

// ---- CHOP ----------------------------------------------------------------------
let chopState = { n: 8, how: 'equal' };
let live = null;                 // { t0, marks } while live chopping

function chopSection(A, R, pad) {
  R.append(h('<h3>CHOP</h3>'));
  if (live && live.id !== pad.s) live = null;
  const first = A.sel, room = 12 - first;
  const box = h(`<div class="chop">
    <div class="row"><span class="lab" style="width:78px">SLICES</span><input id="cn" type="number" min="2" max="12" value="${Math.min(chopState.n, Math.max(2, room))}" style="width:70px">
      <div class="seg" id="ch">${[['equal', 'EQUAL'], ['transient', 'TRANSIENT']].map(([v, t]) => `<button data-v="${v}" class="${chopState.how === v ? 'on' : ''}">${t}</button>`).join('')}</div>
      <button class="btn small" id="auto" ${pad.s ? '' : 'disabled'}>AUTOCHOP</button><button class="btn small" id="cu" ${A.lastChop ? '' : 'disabled'}>UNDO CHOP</button></div>
    <div class="row"><span class="lab" style="width:78px">LIVE CHOP</span><button class="btn small" id="ls" ${pad.s ? '' : 'disabled'}>${live ? 'RESTART' : 'PLAY'}</button>
      <button class="btn small" id="lm" ${live ? '' : 'disabled'}>MARK</button><button class="btn small" id="la" ${live ? '' : 'disabled'}>APPLY${live ? ` (${live.marks.length})` : ''}</button></div>
  </div>`);
  R.append(box);
  R.append(h(`<p class="note">Chopping fills pads from ${PAD_LABELS[first]} onwards (up to ${room} here) with slices of the sample on the selected pad, and replaces what they held. UNDO CHOP puts it back. EQUAL cuts evenly. TRANSIENT cuts at the sharpest attacks. LIVE CHOP plays the sound while you tap MARK at each cut.</p>`));

  const apply = (bounds, how) => {
    const pads = A.grp().pads;
    A.lastChop = { g: A.g, pads: pads.map((p) => ({ ...p })) };
    const changed = assignSlices(pads, first, pad.s, bounds);
    A.save(); A.refreshPads(); A.refreshLcd(); A.renderPanel();
    A.toast(`${how}: ${changed.length} slice${changed.length === 1 ? '' : 's'} on pads ${PAD_LABELS[changed[0]]} to ${PAD_LABELS[changed[changed.length - 1]]}`);
  };
  box.querySelector('#cn').onchange = (e) => { chopState.n = Math.max(2, Math.min(12, Math.round(+e.target.value) || 8)); };
  box.querySelector('#ch').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; chopState.how = b.dataset.v; A.renderPanel(); };
  box.querySelector('#auto').onclick = async () => {
    const n = Math.min(Math.max(2, Math.round(+box.querySelector('#cn').value) || 8), room);
    chopState.n = n;
    if (n < 2 || room < 2) return A.toast('Select an earlier pad: a chop needs at least two pads');
    await A.engine.load(pad.s).catch(() => null);
    const buf = A.engine.buffers.get(pad.s);
    if (!buf) return A.toast('The sample is not loaded yet');
    const bounds = chopState.how === 'transient' ? transientBounds(buf.getChannelData(0), buf.sampleRate, n) : equalBounds(n);
    if (bounds.length < 3) return A.toast('No clear attacks found. Try EQUAL or LIVE CHOP');
    apply(bounds, chopState.how === 'transient' ? 'Transient chop' : 'Equal chop');
  };
  box.querySelector('#cu').onclick = () => {
    const l = A.lastChop; if (!l) return;
    l.pads.forEach((p, i) => Object.assign(A.project.groups[l.g].pads[i], p));
    A.lastChop = null; A.save(); A.refreshPads(); A.refreshLcd(); A.renderPanel(); A.toast('Chop undone');
  };
  box.querySelector('#ls').onclick = async () => {
    await A.engine.start();
    await A.engine.load(pad.s).catch(() => null);
    const buf = A.engine.buffers.get(pad.s); if (!buf) return A.toast('The sample is not loaded yet');
    live = { id: pad.s, dur: buf.duration, marks: [], t0: A.engine.now };
    A.engine.preview(pad.s);
    A.renderPanel();
  };
  box.querySelector('#lm').onclick = () => {
    if (!live) return;
    const f = (A.engine.now - A.engine.latency - live.t0) / live.dur;
    if (f > 0 && f < 1) live.marks.push(f);
    box.querySelector('#la').textContent = `APPLY (${live.marks.length})`;
  };
  box.querySelector('#la').onclick = () => {
    if (!live) return;
    const marks = live.marks; live = null;
    const bounds = marksToBounds(marks).slice(0, room + 1);
    if (bounds.length < 3) { A.renderPanel(); return A.toast('Tap MARK at least once while the sound plays'); }
    bounds[bounds.length - 1] = 1;
    apply(bounds, 'Live chop');
  };
}

// Cut leading and trailing silence (when the setting is on) and keep a few ms either side.
function trimSilence(A, buf) {
  const ch = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const b = silenceBounds(ch, 0.01, Math.round(buf.sampleRate * 0.005));
  if (!b || (b.start === 0 && b.end === buf.length)) return buf;
  const out = A.engine.ctx.createBuffer(buf.numberOfChannels, b.end - b.start, buf.sampleRate);
  ch.forEach((d, c) => out.copyToChannel(d.subarray(b.start, b.end), c));
  return out;
}

// trim = true for our own recordings (mic, resample); imported files are kept as they are.
export async function storeBuffer(A, buf, name, trim = false) {
  if (trim && A.settings.trimSilence !== false) buf = trimSilence(A, buf);
  const max = Math.floor(buf.sampleRate * 20);
  if (buf.length > max) {
    const cut = A.engine.ctx.createBuffer(buf.numberOfChannels, max, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) cut.copyToChannel(buf.getChannelData(c).subarray(0, max), c);
    buf = cut; A.toast('Trimmed to 20 seconds');
  }
  return userSamples.put(name.slice(0, 40) || 'recording', encodeWav(buf), buf.duration);
}

function micRecorder(A, btn, assign) {
  let mr = null, stream = null, timer = null;
  const setSession = (t) => { try { if (navigator.audioSession) navigator.audioSession.type = t; } catch { /* unsupported */ } };
  const finish = () => { clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); setSession('playback'); btn.innerHTML = '&#9679; RECORD MIC'; btn.classList.remove('rec', 'on'); mr = null; };
  btn.onclick = async () => {
    if (mr) { mr.stop(); return; }
    try {
      await A.engine.start();
      setSession('play-and-record');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        const type = mr.mimeType; finish();
        try {
          const buf = await A.engine.ctx.decodeAudioData(await new Blob(chunks, { type }).arrayBuffer());
          const n = userSamples.list().length + 1;
          assign(await storeBuffer(A, buf, `rec ${n}`, true));
        } catch (err) { A.toast(`Recording failed: ${err.message || err}`); }
      };
      mr.start();
      btn.textContent = '■ STOP'; btn.classList.add('rec', 'on');
      timer = setTimeout(() => mr?.stop(), 20000);
    } catch (err) {
      finish();
      A.toast(err.name === 'NotAllowedError' ? 'Microphone permission was declined' : `Microphone unavailable: ${err.message}`);
    }
  };
}

function drawWave(A, cv, pad) {
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth || 300, hh = cv.clientHeight || 110;
  cv.width = w * dpr; cv.height = hh * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue('--well'); g.fillRect(0, 0, w, hh);
  const buf = A.engine.buffers.get(pad.s);
  if (!buf) { g.fillStyle = css.getPropertyValue('--dim'); g.font = '12px system-ui'; g.fillText(pad.s ? 'Loading sample' : 'No sample on this pad', 12, 24); return; }
  const d = buf.getChannelData(0), per = d.length / w;
  g.fillStyle = css.getPropertyValue('--accent');
  for (let x = 0; x < w; x++) {
    let mx = 0; const a = Math.floor(x * per), b = Math.min(d.length, Math.floor((x + 1) * per));
    for (let i = a; i < b; i += Math.max(1, Math.floor(per / 16))) mx = Math.max(mx, Math.abs(d[i]));
    const y = mx * (hh / 2 - 4); g.fillRect(x, hh / 2 - y, 1, Math.max(1, y * 2));
  }
  g.fillStyle = 'rgba(0,0,0,.6)';
  g.fillRect(0, 0, pad.start * w, hh); g.fillRect(pad.end * w, 0, (1 - pad.end) * w, hh);
  g.fillStyle = css.getPropertyValue('--text'); g.fillRect(pad.start * w - 1, 0, 2, hh); g.fillRect(pad.end * w - 1, 0, 2, hh);
}

function trimHandles(A, cv, pad) {
  let which = null;
  const frac = (e) => { const r = cv.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  cv.addEventListener('pointerdown', (e) => {
    const f = frac(e); which = Math.abs(f - pad.start) <= Math.abs(f - pad.end) ? 'start' : 'end';
    cv.setPointerCapture(e.pointerId); move(e);
  });
  const move = (e) => {
    if (!which) return; const f = frac(e);
    if (which === 'start') pad.start = Math.min(f, pad.end - 0.005); else pad.end = Math.max(f, pad.start + 0.005);
    drawWave(A, cv, pad); A.save();
  };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', () => {
    if (which && A.engine.ctx && pad.s) A.engine.trigger(A.g, A.sel, pad, 100);
    which = null;
  });
}

// ---- Knob and fader widgets ----------------------------------------------------
export function knob(label, name, value, onChange) {
  const el = h(`<div class="knob" data-k="${esc(name.toLowerCase())}"><svg viewBox="0 0 100 100"><circle class="kb" cx="50" cy="50" r="42"/><circle class="kc" cx="50" cy="50" r="24"/><line class="ptr" x1="50" y1="50" x2="50" y2="14"/></svg><div class="kn">${esc(name)}</div><div class="kl">${esc(label)}</div></div>`);
  el.setValue = (v, lab) => { value = v; draw(); if (lab !== undefined) el.querySelector('.kl').textContent = lab; };
  const ptr = el.querySelector('.ptr');
  function draw() { ptr.setAttribute('transform', `rotate(${-135 + value * 270} 50 50)`); }
  draw();
  let y0, v0, f0;
  // SHIFT slows the move to a quarter, as on the hardware ("finer control").
  const fineNow = () => document.documentElement.classList.contains('shift');
  el.addEventListener('pointerdown', (e) => { y0 = e.clientY; v0 = value; f0 = fineNow(); el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (y0 === undefined) return;
    const f = fineNow();
    if (f !== f0) { y0 = e.clientY; v0 = value; f0 = f; }
    value = Math.min(1, Math.max(0, v0 + (y0 - e.clientY) / (f ? 640 : 160))); draw(); onChange(value);
  });
  const end = () => { y0 = undefined; };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return el;
}

export function fader(value, onChange) {
  const el = h('<div class="fader"><div class="fill"></div><div class="cap"></div></div>');
  const draw = () => { el.querySelector('.fill').style.height = `${value * 100}%`; el.querySelector('.cap').style.bottom = `calc(${value * 100}% - 16px)`; };
  draw();
  el.setValue = (v) => { value = v; draw(); };
  const set = (e) => { const r = el.getBoundingClientRect(); value = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)); draw(); onChange(value); };
  // With SHIFT held the fader moves relative to where the drag began, at a quarter of the distance.
  const fineNow = () => document.documentElement.classList.contains('shift');
  let on = false, y0, v0;
  el.addEventListener('pointerdown', (e) => {
    on = true; el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = value;
    if (!fineNow()) set(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (!on) return;
    if (!fineNow()) { set(e); y0 = e.clientY; v0 = value; return; }
    const r = el.getBoundingClientRect();
    value = Math.min(1, Math.max(0, v0 + (y0 - e.clientY) / r.height / 4)); draw(); onChange(value);
  });
  const end = () => { on = false; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return el;
}

// ---- FX ------------------------------------------------------------------------
function fxTab(A, body) {
  const fx = A.project.fx;
  body.append(h('<h3>EFFECT (ONE ACTIVE AT A TIME)</h3>'));
  const chips = h(`<div class="chips">${['none', ...Object.keys(EFFECTS)].map((k) => `<button class="btn small ${fx.active === k ? 'on' : ''}" data-k="${k}">${k === 'none' ? 'OFF' : EFFECTS[k].label}</button>`).join('')}</div>`);
  body.append(chips);
  chips.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; fx.active = b.dataset.k; A.applyFx(); A.save(); A.renderPanel(); });

  const def = EFFECTS[fx.active];
  const knobs = h('<div class="knobs"></div>');
  if (def) {
    const p = fx.params[fx.active];
    knobs.append(knob(def.x, 'X', p[0], (v) => { p[0] = v; A.applyFx(); A.save(); }));
    knobs.append(knob(def.y, 'Y', p[1], (v) => { p[1] = v; A.applyFx(); A.save(); }));
  } else knobs.append(h('<p class="note">Choose an effect to use the X and Y knobs. Drag a knob up or down.</p>'));
  body.append(knobs);

  body.append(h('<h3>PUNCH-IN FX (HOLD, COMBINE WITH MULTI-TOUCH)</h3>'));
  const grid = h(`<div class="punch">${PUNCH_FX.map((n, i) => `<div class="pad" data-i="${i}">${n}</div>`).join('')}</div>`);
  body.append(grid);
  const held = new Map();
  grid.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.pad'); if (!el || !A.engine.ctx) return;
    e.preventDefault(); const i = +el.dataset.i; held.set(e.pointerId, i); el.classList.add('lit'); A.engine.punchHold(i, true);
  });
  const up = (e) => { const i = held.get(e.pointerId); if (i === undefined) return; held.delete(e.pointerId); grid.children[i].classList.remove('lit'); A.engine.punchHold(i, false); };
  grid.addEventListener('pointerup', up); grid.addEventListener('pointercancel', up);
  body.append(h('<p class="note">Punch-in effects here are original takes on the idea, not copies of the hardware set. Tape stop and pitch effects act on sounds already playing.</p>'));
}

// ---- MIX -----------------------------------------------------------------------
function mixTab(A, body) {
  body.append(h('<h3>GROUP LEVELS</h3>'));
  const mix = h('<div class="mix"></div>');
  A.project.groups.forEach((g, i) => {
    const ch = h(`<div class="chan"><button class="btn small ${g.mute ? 'on' : ''}" data-m="${i}">MUTE</button></div>`);
    ch.prepend(fader(g.vol, (v) => { g.vol = v; A.engine.setGroupLevel(i, v, g.mute); A.seq.recordAuto(i, v); A.save(); }));
    ch.append(h(`<div class="val">${GROUPS[i]}</div>`));
    const sd = h(`<div><div class="lab" style="text-align:center">FX SEND</div><input type="range" min="0" max="1" step="0.01" value="${g.send ?? 1}" style="width:72px"></div>`);
    sd.querySelector('input').oninput = (e) => { g.send = +e.target.value; A.engine.setGroupSend(i, g.send); A.save(); };
    ch.append(sd);
    ch.querySelector('[data-m]').onclick = (e) => { g.mute = !g.mute; e.target.classList.toggle('on', g.mute); A.engine.setGroupLevel(i, g.vol, g.mute); A.save(); };
    mix.append(ch);
  });
  const m = h('<div class="chan"></div>');
  m.append(fader(A.settings.master, (v) => { A.settings.master = v; A.engine.setMaster(v); A.saveSettings(); }));
  m.append(h('<div class="val">MAIN</div>'));
  mix.append(m);
  body.append(mix);
  body.append(h('<h3>FADER AUTOMATION</h3>'));
  const au = h(`<div class="row">${A.project.groups.map((g, i) => {
    const pat = getPattern(A.project, i); const n = pat?.auto?.length || 0;
    return `<button class="btn small" data-a="${i}" ${n ? '' : 'disabled'}>ERASE ${GROUPS[i]} (${n})</button>`;
  }).join('')}<button class="btn small" id="rf">RESET FADERS</button></div>`);
  body.append(au);
  au.addEventListener('click', (e) => {
    if (e.target.id === 'rf') { A.project.groups.forEach((g) => { g.vol = 0.8; g.send = 1; g.mute = false; }); A.applyMix(); A.save(); A.renderPanel(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const i = +b.dataset.a, pat = getPattern(A.project, i); if (!pat) return;
    A.beforeEdit(i, pat); clearAuto(pat); A.save(); A.renderPanel();
  });
  body.append(h('<p class="note">Press RECORD, then move a group fader: the moves are stored in that group\'s playing pattern and replayed with it. ERASE removes the automation of the pattern selected for that group. Recording again over a pattern adds to it, so erase first to start clean.</p>'));
  body.append(h('<p class="note">FX SEND chooses how much of each group goes to the active effect (set in the FX tab). Raise it to hear the effect on that group. A safety limiter sits on the main output. MAIN is a device setting shared by all projects.</p>'));
}

// ---- SONG ----------------------------------------------------------------------
function songTab(A, body) {
  const p = A.project;
  const ids = Object.keys(p.scenes).map(Number).sort((a, b) => a - b);
  const next = (() => { let n = 1; while (p.scenes[String(n)]) n++; return n; })();
  body.append(h('<h3>SCENES</h3>'));
  body.append(h('<p class="note">A scene remembers which pattern each group plays. Set the patterns you want (pattern buttons under the pads), then store them as a scene.</p>'));
  const store = h(`<div class="row"><span class="lab">SCENE No.</span><input id="sn" type="number" min="1" max="99" value="${next}" style="width:80px"><button class="btn small" id="st">STORE CURRENT PATTERNS</button></div>`);
  body.append(store);
  store.querySelector('#st').onclick = () => {
    const n = +store.querySelector('#sn').value;
    if (!(n >= 1 && n <= 99)) return A.toast('Scene number must be 1 to 99');
    p.scenes[String(n)] = sceneFromCurrent(p); A.save(); A.renderPanel(); A.toast(`Scene ${n} stored`);
  };
  store.append(h('<button class="btn small" id="es">ERASE SCENE</button>'));
  store.querySelector('#es').onclick = () => {
    const n = +store.querySelector('#sn').value;
    if (!p.scenes[String(n)]) return A.toast(`Scene ${n} does not exist`);
    if (!confirm(`Erase scene ${n}? It is also removed from the song.`)) return;
    eraseScene(p, n); A.save(); A.renderPanel(); A.toast(`Scene ${n} erased`);
  };
  const list = h('<div class="chiplist"></div>');
  if (!ids.length) list.append(h('<span class="dim">No scenes yet.</span>'));
  for (const n of ids) {
    const sc = p.scenes[String(n)];
    const c = h(`<button class="songchip" title="Tap to recall, ${sc.map((x, i) => `${GROUPS[i]}${x || '-'}`).join(' ')}">${n}<br><small class="dim">${sc.map((x) => x || '-').join(' ')}</small></button>`);
    c.onclick = () => { p.groups.forEach((g, i) => { if (sc[i]) g.cur = sc[i]; }); A.save(); A.refresh(); A.toast(`Scene ${n} recalled`); };
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    list.append(c);
  }
  body.append(list);

  body.append(h('<h3>SONG</h3>'));
  const row = h(`<div class="row"><button class="btn small ${A.seq.songMode ? 'on' : ''}" id="sm">SONG MODE ${A.seq.songMode ? 'ON' : 'OFF'}</button>
    <span class="lab">ADD SCENE</span><input id="as" type="number" min="1" max="99" value="${ids[0] || 1}" style="width:80px"><button class="btn small" id="ad">ADD</button><button class="btn small" id="rm">REMOVE LAST</button><button class="btn small" id="cs">CLEAR SONG</button></div>`);
  body.append(row);
  row.querySelector('#sm').onclick = () => { A.seq.songMode = !A.seq.songMode; A.renderPanel(); };
  row.querySelector('#ad').onclick = () => {
    const n = +row.querySelector('#as').value;
    if (!p.scenes[String(n)]) return A.toast(`Scene ${n} does not exist`);
    A.songUndo = p.song; p.song = [...p.song, n]; A.save(); A.renderPanel();
  };
  row.querySelector('#rm').onclick = () => { A.songUndo = p.song; p.song = p.song.slice(0, -1); A.save(); A.renderPanel(); };
  row.querySelector('#cs').onclick = () => { A.songUndo = p.song; p.song = []; A.save(); A.renderPanel(); };
  if (A.songSel >= p.song.length) A.songSel = null;
  const sl = h('<div class="chiplist" id="songlist"></div>');
  if (!p.song.length) sl.append(h('<span class="dim">Song is empty.</span>'));
  p.song.forEach((n, i) => sl.append(h(`<button class="songchip ${A.songSel === i ? 'sel' : ''}" data-i="${i}">${n}</button>`)));
  body.append(sl);
  sl.addEventListener('click', (e) => { const c = e.target.closest('[data-i]'); if (!c) return; const i = +c.dataset.i; A.songSel = A.songSel === i ? null : i; A.renderPanel(); });

  const ed = h(`<div class="row"><span class="lab">EDIT</span>
    <button class="btn small" id="si">INSERT SCENE BEFORE</button><button class="btn small" id="sc">CUT</button>
    <button class="btn small" id="sl">MOVE EARLIER</button><button class="btn small" id="sr">MOVE LATER</button><button class="btn small" id="su" ${A.songUndo ? '' : 'disabled'}>UNDO</button></div>`);
  body.append(ed);
  const sel = () => (A.songSel === null || A.songSel === undefined ? -1 : A.songSel);
  // fn gets the song and the selected index; newSel is the selection once the list has really changed.
  const editSong = (fn, newSel, needSel = true) => {
    if (A.seq.playing && A.seq.songMode) return A.toast('Stop the song before editing it');
    if (needSel && sel() < 0) return A.toast('Tap a scene in the song first');
    const next = fn(p.song, sel());
    if (next === p.song) return;
    A.songUndo = p.song; p.song = next; A.songSel = newSel(sel());
    A.save(); A.renderPanel();
  };
  ed.querySelector('#si').onclick = () => {
    const n = +row.querySelector('#as').value;
    if (!p.scenes[String(n)]) return A.toast(`Scene ${n} does not exist`);
    editSong((s, i) => songInsert(s, i < 0 ? s.length : i, n), (i) => (i < 0 ? null : i + 1), false);
  };
  ed.querySelector('#sc').onclick = () => editSong((s, i) => songCut(s, i), () => null);
  ed.querySelector('#sl').onclick = () => editSong((s, i) => songMove(s, i, -1), (i) => Math.max(0, i - 1));
  ed.querySelector('#sr').onclick = () => editSong((s, i) => songMove(s, i, 1), (i) => Math.min(p.song.length - 1, i + 1));
  ed.querySelector('#su').onclick = () => { if (!A.songUndo) return; p.song = A.songUndo; A.songUndo = null; A.save(); A.renderPanel(); };
  body.append(h('<p class="note">With song mode on, PLAY runs the scenes in order and stops at the end. Each scene lasts as long as its longest pattern. Tap a scene in the list to select it, then insert before it, cut it or move it.</p>'));
  A.onFrame = () => { sl.querySelectorAll('.songchip').forEach((c) => c.classList.toggle('on', A.seq.playing && A.seq.songMode && +c.dataset.i === A.seq.songPos)); };
}

// ---- PROJECT -------------------------------------------------------------------
function projectTab(A, body) {
  const p = A.project;
  body.append(h('<h3>PROJECT</h3>'));
  const nm = h(`<div class="row"><span class="lab">NAME</span><input id="nm" type="text" maxlength="24" value="${esc(p.name)}"></div>`);
  nm.querySelector('#nm').oninput = (e) => { p.name = e.target.value; A.save(); };
  body.append(nm);

  const seg = (label, opts, cur, fn) => {
    const el = h(`<div class="row"><span class="lab" style="width:110px">${label}</span><div class="seg">${opts.map(([v, t]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div></div>`);
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; fn(b.dataset.v); A.renderPanel(); });
    body.append(el);
  };
  body.append(h('<h3>LOOK</h3>'));
  seg('THEME', [['dark', 'DARK'], ['light', 'LIGHT'], ['black', 'BLACK']], A.settings.theme, (v) => { A.settings.theme = v; A.saveSettings(); A.applyLook(); });
  seg('LAYOUT', [['auto', 'AUTO'], ['hardware', 'HARDWARE']], A.settings.layout, (v) => { A.settings.layout = v; A.saveSettings(); A.applyLook(); });
  body.append(h('<p class="note">LIGHT follows the grey, white and orange of the hardware. HARDWARE is a portrait layout laid out like the machine: tabs along the top, dials above the pads, a side strip with a volume slider, FADER and KEYS, and the transport along the bottom. AUTO picks the layout from the screen size.</p>'));
  body.append(h('<h3>PLAYING</h3>'));
  seg('PAD VELOCITY', [['fixed', 'FIXED'], ['position', 'TOUCH POSITION']], A.settings.velMode, (v) => { A.settings.velMode = v; A.saveSettings(); });
  seg('KEYS SCALE', Object.keys(SCALES).map((k) => [k, k.toUpperCase()]), A.settings.scale, (v) => { A.settings.scale = v; A.saveSettings(); A.refreshPads(); });
  seg('COUNT-IN', [[true, 'ON'], [false, 'OFF']], A.settings.countIn, (v) => { A.settings.countIn = v === 'true'; A.seq.countIn = A.settings.countIn; A.saveSettings(); });
  body.append(h('<p class="note">Touch position: tapping the lower part of a pad plays harder. An iPad has no pressure-sensitive pads.</p>'));

  body.append(h('<h3>BACKUP</h3>'));
  const bk = h(`<div class="row"><button class="btn small" id="ex">EXPORT PROJECT (JSON)</button><button class="btn small" id="im">IMPORT PROJECT</button><button class="btn small" id="rs">RESET THIS PROJECT</button><button class="btn small" id="rsAll">RESET ALL TO FACTORY</button><input id="f" type="file" accept="application/json,.json" hidden></div>`);
  body.append(bk);
  bk.querySelector('#ex').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `kopad-${A.pi}-${p.name.replace(/\W+/g, '_')}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  bk.querySelector('#im').onclick = () => bk.querySelector('#f').click();
  bk.querySelector('#f').onchange = async (e) => {
    try {
      const f = e.target.files[0]; if (!f) return;
      A.project = normaliseProject(JSON.parse(await f.text()));
      A.save(); await A.preload(); A.refresh(); A.toast('Project imported');
    } catch { A.toast('That file is not a KO Pad project'); }
  };
  bk.querySelector('#rs').onclick = () => { if (confirm(`Reset project ${A.pi} to ${A.pi <= 4 ? 'the factory banks' : 'empty'}? Patterns will be lost.`)) A.resetProject(); };
  bk.querySelector('#rsAll').onclick = async () => {
    if (!confirm('Reset all 9 projects and settings to factory? Every pattern, scene, song and sound assignment is lost.')) return;
    const withSamples = userSamples.list().length > 0 && confirm(`Also delete your ${userSamples.list().length} recorded and imported sounds?\nOK deletes them, Cancel keeps them.`);
    A.seq.stop(); A.resetting = true;
    for (let i = 1; i <= 9; i++) storage.remove(`ko.proj.${i}`);
    storage.remove('ko.settings');
    if (withSamples) await userSamples.clear();
    location.reload();
  };
  body.append(h('<p class="note">Exports hold sound assignments, patterns, scenes and effects. Recorded and imported audio stays on this iPad and is not part of the export.</p>'));

  body.append(h('<h3>OFFLINE</h3>'));
  const off = h('<div id="offbox"></div>'); body.append(off);
  A.renderOffline?.(off);

  body.append(h('<h3>QUICK GUIDE</h3>'));
  body.append(h(`<table class="kv">
    <tr><td>Play a sound</td><td>Tap a pad. Groups A to D hold 12 pads each.</td></tr>
    <tr><td>Record live</td><td>Press REC (count-in plays first), then tap pads. TIMING sets quantise.</td></tr>
    <tr><td>Step edit</td><td>STEP tab: tap cells in the grid.</td></tr>
    <tr><td>Change a sound</td><td>Tap a pad, open SOUND, pick a sample or type its number.</td></tr>
    <tr><td>Play a sample as notes</td><td>KEYS, then pick the octave with OCT.</td></tr>
    <tr><td>Delete hits</td><td>Hold ERASE and tap a pad to clear that pad from the pattern.</td></tr>
    <tr><td>Build a song</td><td>SONG tab: store scenes, then add them in order.</td></tr>
  </table>`));
  body.append(h('<p class="note" style="margin-top:12px">KO Pad is an independent project and is not made or endorsed by Teenage Engineering. Sample numbers 1 to 599 are for sounds placed in the samples folder by the person hosting the app (see the README). Sounds you import are numbered from 600.</p>'));
}
