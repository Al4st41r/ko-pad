// Project and pattern data model. Pure functions only, so it can be tested under Node.
import { PRESETS, GROUPS, PPQ, BAR_TICKS, MAX_BARS, GRIDS, EFFECTS, SCALES } from './data.js';

export const clone = (o) => JSON.parse(JSON.stringify(o));

export function defaultPad(sample = 0) {
  return { s: sample, vol: 1, pitch: 0, pan: 0, start: 0, end: 1, mode: 'oneshot', fit: 0, atk: 0, rel: 0.02, mg: 0 };
}

// Playback rate that makes the played part of a sound last `bars` bars at this tempo (varispeed:
// the pitch moves with the rate). Returns 1 when fit is off or the numbers are unusable.
export function fitRate(seconds, bars, bpm) {
  if (!bars || !(seconds > 0) || !(bpm > 0)) return 1;
  return seconds / (bars * 4 * 60 / bpm);
}

export function emptyPattern(bars = 1) {
  return { bars, ev: [] };
}

export function emptyGroup(samples = null) {
  return {
    pads: Array.from({ length: 12 }, (_, i) => defaultPad(samples ? samples[i] : 0)),
    patterns: {},
    cur: 1,
    vol: 0.8,
    send: 1,
    mute: false,
  };
}

export function newProject(name = 'EMPTY', preset = null) {
  const fx = { active: 'none', params: {} };
  for (const [k, v] of Object.entries(EFFECTS)) fx.params[k] = [...v.def];
  return {
    v: 1,
    name,
    bpm: 120,
    swing: 0,
    groups: GROUPS.map((g) => emptyGroup(preset && preset[g] ? preset[g] : null)),
    fx,
    scenes: {},
    song: [],
  };
}

// Projects 1-4 ship with banks A-C loaded; D is empty, as on the hardware.
export function factoryProject(n) {
  return PRESETS[n] ? newProject(`P${n}`, PRESETS[n]) : newProject(`P${n}`);
}

export function getPattern(project, g, n = null, create = false) {
  const grp = project.groups[g];
  const key = String(n ?? grp.cur);
  if (!grp.patterns[key] && create) grp.patterns[key] = emptyPattern();
  return grp.patterns[key] || null;
}

export const MAX_BEATS = 12;                    // beats per bar, over a quarter-note beat (x/4)
export const beatsOf = (pat) => pat.beats || 4;
export const barTicks = (pat) => beatsOf(pat) * PPQ;
export const patternTicks = (pat) => pat.bars * barTicks(pat);

// Change the beats in each bar (the top of x/4). Hits and automation past the new end are dropped.
export function setBeats(pat, beats) {
  const b = Math.max(1, Math.min(MAX_BEATS, Math.round(beats)));
  if (b === 4) delete pat.beats; else pat.beats = b;
  const len = patternTicks(pat);
  pat.ev = pat.ev.filter((e) => e.t < len);
  dropAutoPast(pat, len);
}

function dropAutoPast(pat, len) {
  if (!pat.auto) return;
  pat.auto = pat.auto.filter((a) => a.t < len);
  if (!pat.auto.length) delete pat.auto;
}

export function setBars(pat, bars) {
  pat.bars = Math.max(1, Math.min(MAX_BARS, bars));
  const len = patternTicks(pat);
  pat.ev = pat.ev.filter((e) => e.t < len);
  dropAutoPast(pat, len);
}

export function quantiseTick(t, gridName, len) {
  const g = GRIDS[gridName];
  if (!g) return Math.max(0, Math.min(len - 1, Math.round(t)));
  return (Math.round(t / g) * g) % len;
}

// One event per pad per tick: adding again replaces the earlier one.
export function addEvent(pat, ev) {
  pat.ev = pat.ev.filter((e) => !(e.t === ev.t && e.p === ev.p));
  pat.ev.push(ev);
  pat.ev.sort((a, b) => a.t - b.t || a.p - b.p);
  return ev;
}

// Toggle on a step grid cell. A cell covers [t, t+grid) so triplet and straight grids can coexist.
export function toggleStep(pat, t, p, grid, vel = 100) {
  const hit = pat.ev.filter((e) => e.p === p && e.t >= t && e.t < t + grid);
  if (hit.length) {
    pat.ev = pat.ev.filter((e) => !hit.includes(e));
    return false;
  }
  addEvent(pat, { t, p, v: vel, d: grid });
  return true;
}

// ---- pattern tools ----
export const copyOf = (pat) => ({ bars: pat.bars, beats: pat.beats, ev: clone(pat.ev), auto: pat.auto ? clone(pat.auto) : undefined });

export function pasteInto(pat, clip) {
  pat.bars = clip.bars; pat.ev = clone(clip.ev);
  if (clip.beats && clip.beats !== 4) pat.beats = clip.beats; else delete pat.beats;
  if (clip.auto && clip.auto.length) pat.auto = clone(clip.auto); else delete pat.auto;
}

// First pattern number in a group with no hits (a pattern that does not exist yet counts as empty).
export function nextEmptyPattern(project, g, from = 1) {
  const pats = project.groups[g].patterns;
  for (let i = 1; i <= 99; i++) {
    const n = ((from - 1 + i) % 99) + 1;
    if (!pats[String(n)] || !pats[String(n)].ev.length) return n;
  }
  return null;
}

// x2: repeats the pattern into a longer one. Returns false when it would pass the maximum length.
export function doubleLength(pat) {
  if (pat.bars * 2 > MAX_BARS) return false;
  const len = patternTicks(pat);
  const extra = pat.ev.map((e) => ({ ...e, t: e.t + len }));
  pat.bars *= 2;
  pat.ev = [...pat.ev, ...extra];
  if (pat.auto) pat.auto = [...pat.auto, ...pat.auto.map((a) => ({ ...a, t: a.t + len }))];
  return true;
}

// /2: keeps the first half. Returns false when the pattern is already one bar.
export function halveLength(pat) {
  if (pat.bars <= 1) return false;
  setBars(pat, Math.ceil(pat.bars / 2));
  return true;
}

// Snap existing hits to the grid. pad = null corrects every pad. Returns how many hits moved.
export function correctEvents(pat, gridName, pad = null) {
  if (!GRIDS[gridName]) return 0;
  const len = patternTicks(pat);
  let moved = 0;
  const keep = [], fix = [];
  for (const e of pat.ev) (pad === null || e.p === pad ? fix : keep).push(e);
  pat.ev = keep;
  for (const e of fix) {
    const t = quantiseTick(e.t, gridName, len);
    if (t !== e.t) moved++;
    addEvent(pat, { ...e, t });
  }
  return moved;
}

// ---- fader automation: pat.auto = [{t, v}], a group level (0..1) that applies from tick t ----
export const AUTO_STEP = 4;       // ticks between stored points, so a drag does not write hundreds
export function addAuto(pat, t, v) {
  const len = patternTicks(pat);
  const at = (Math.round(t / AUTO_STEP) * AUTO_STEP) % len;
  pat.auto = (pat.auto || []).filter((a) => a.t !== at);
  pat.auto.push({ t: at, v: Math.max(0, Math.min(1, v)) });
  pat.auto.sort((a, b) => a.t - b.t);
}
export const clearAuto = (pat) => { delete pat.auto; };
export function buildAutoIndex(pat) {
  const m = new Map();
  for (const a of pat.auto || []) m.set(a.t, a.v);
  return m;
}

// ---- note editing: change one hit in place ----
// Move a hit by dt ticks, wrapping inside the pattern. A hit already on the target step is replaced.
export function nudgeEvent(pat, ev, dt) {
  const len = patternTicks(pat);
  const t = (((ev.t + dt) % len) + len) % len;
  pat.ev = pat.ev.filter((e) => e === ev || !(e.p === ev.p && e.t === t));
  ev.t = t;
  pat.ev.sort((a, b) => a.t - b.t || a.p - b.p);
  return ev;
}
export const changeVelocity = (ev, d) => { ev.v = Math.max(1, Math.min(127, Math.round(ev.v + d))); return ev; };
export function changeDuration(pat, ev, d) {
  ev.d = Math.max(1, Math.min(patternTicks(pat), Math.round((ev.d || 24) + d)));
  return ev;
}
// The hit on pad p that starts inside the step [t, t + grid), or undefined.
export const eventAt = (pat, p, t, grid) => pat.ev.find((e) => e.p === p && e.t >= t && e.t < t + grid);

// ---- song editing: each returns a new list and never changes the one passed in ----
const MAX_PATTERN = 99;
export const SONG_MAX = 99;
export function songInsert(song, at, scene) {
  if (song.length >= SONG_MAX) return song;
  const i = Math.max(0, Math.min(song.length, at));
  return [...song.slice(0, i), scene, ...song.slice(i)];
}
export const songCut = (song, at) => (at >= 0 && at < song.length ? [...song.slice(0, at), ...song.slice(at + 1)] : song);
export function songMove(song, at, d) {
  const to = at + d;
  if (at < 0 || at >= song.length || to < 0 || to >= song.length) return song;
  const out = [...song]; [out[at], out[to]] = [out[to], out[at]];
  return out;
}

export function eraseScene(project, n) {
  delete project.scenes[String(n)];
  project.song = project.song.filter((s) => s !== n);
}

export const clearPad = (pat, p) => { pat.ev = pat.ev.filter((e) => e.p !== p); };
export const clearPattern = (pat) => { pat.ev = []; };

// tick -> events, for O(1) lookup in the scheduler.
export function buildIndex(pat) {
  const m = new Map();
  for (const e of pat.ev) {
    const a = m.get(e.t);
    if (a) a.push(e); else m.set(e.t, [e]);
  }
  return m;
}

// Playhead position within the looping pattern, so a one bar pattern always reads bar 1 and a two bar pattern runs 1 to 2.
export function loopPosition(tick, loopTicks) {
  return tick < 0 || !(loopTicks > 0) ? tick : tick % loopTicks;
}

export function ticksToPosition(tick, bar = BAR_TICKS) {
  if (tick < 0) return { bar: 0, beat: 0, sixteenth: 0 };
  return {
    bar: Math.floor(tick / bar) + 1,
    beat: Math.floor((tick % bar) / PPQ) + 1,
    sixteenth: Math.floor((tick % PPQ) / (PPQ / 4)) + 1,
  };
}

// Keys mode: pad grid read as a keyboard, bottom-left = lowest note.
export function padSemitone(padIdx) {
  const row = Math.floor(padIdx / 3);
  return (3 - row) * 3 + (padIdx % 3);
}

// Semitones above the root for key number k (0 = bottom-left pad) in a scale.
export function scaleNote(k, scale = 'chromatic') {
  const s = SCALES[scale] || SCALES.chromatic;
  return 12 * Math.floor(k / s.length) + s[k % s.length];
}

export function nextFreeScene(project) {
  let n = 1;
  while (project.scenes[String(n)]) n++;
  return n;
}

export function sceneFromCurrent(project) {
  return project.groups.map((g) => (g.patterns[String(g.cur)] ? g.cur : 0));
}

// Undo: bounded stack of JSON snapshots of a single pattern.
export class UndoStack {
  constructor(limit = 30) { this.limit = limit; this.items = []; }
  push(key, pat) {
    this.items.push({ key, snap: clone(pat) });
    if (this.items.length > this.limit) this.items.shift();
  }
  pop() { return this.items.pop() || null; }
}

// Fill in anything a stored or imported project is missing, so old saves keep working.
const num = (v, lo, hi, def) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const MODES = ['oneshot', 'key', 'loop'];
export const FITS = [0, 0.5, 1, 2, 4, 8];     // bars a pad's sound is stretched to, 0 = off

function cleanPad(src) {
  const d = defaultPad(), p = Object.assign(d, src || {});
  p.s = Math.round(num(p.s, 0, 999, 0));
  p.vol = num(p.vol, 0, 2, 1); p.pitch = num(p.pitch, -48, 48, 0); p.pan = num(p.pan, -1, 1, 0);
  p.start = num(p.start, 0, 1, 0); p.end = num(p.end, 0, 1, 1);
  if (p.end <= p.start) { p.start = 0; p.end = 1; }
  p.atk = num(p.atk, 0, 5, 0); p.rel = num(p.rel, 0, 5, 0.02); p.mg = Math.round(num(p.mg, 0, 8, 0));
  p.fit = FITS.includes(p.fit) ? p.fit : 0;
  if (!MODES.includes(p.mode)) p.mode = 'oneshot';
  return p;
}

function cleanPattern(src) {
  const bars = Math.round(num(src?.bars, 1, MAX_BARS, 1)), beats = Math.round(num(src?.beats, 1, MAX_BEATS, 4)), len = bars * beats * PPQ;
  const ev = (Array.isArray(src?.ev) ? src.ev : [])
    .filter((e) => e && Number.isInteger(e.p) && e.p >= 0 && e.p < 12 && Number.isFinite(e.t) && e.t >= 0 && e.t < len)
    .map((e) => {
      const o = { t: Math.round(e.t), p: e.p, v: num(e.v, 1, 127, 100), d: Math.round(num(e.d, 1, len, 24)) };
      if (Number.isFinite(e.n) && e.n) o.n = e.n;
      return o;
    });
  const auto = (Array.isArray(src?.auto) ? src.auto : [])
    .filter((a) => a && Number.isFinite(a.t) && a.t >= 0 && a.t < len && Number.isFinite(a.v))
    .map((a) => ({ t: Math.round(a.t), v: num(a.v, 0, 1, 1) }))
    .sort((a, b) => a.t - b.t);
  const out = { bars, ev };
  if (beats !== 4) out.beats = beats;
  if (auto.length) out.auto = auto;
  return out;
}

export function normaliseProject(p) {
  const base = newProject(p?.name || 'EMPTY');
  const out = Object.assign(base, p || {});
  out.bpm = num(out.bpm, 40, 300, 120);
  out.swing = num(out.swing, 0, 1, 0);
  out.groups = GROUPS.map((_, i) => {
    const g = Object.assign(emptyGroup(), p?.groups?.[i] || {});
    g.pads = Array.from({ length: 12 }, (_, k) => cleanPad(g.pads?.[k]));
    const pats = {};
    for (const [k, v] of Object.entries(g.patterns && typeof g.patterns === 'object' ? g.patterns : {})) pats[k] = cleanPattern(v);
    g.patterns = pats;
    g.cur = Math.round(num(g.cur, 1, MAX_PATTERN, 1)); g.mute = !!g.mute;
    g.vol = num(g.vol, 0, 1.5, 0.8); g.send = num(g.send, 0, 1, 1);
    return g;
  });
  const scenes = {};
  for (const [k, v] of Object.entries(out.scenes && typeof out.scenes === 'object' ? out.scenes : {})) {
    if (Array.isArray(v) && v.length === GROUPS.length && v.every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_PATTERN)) scenes[k] = [...v];
  }
  out.scenes = scenes;
  out.song = Array.isArray(out.song) ? out.song.filter((n) => scenes[String(n)]).slice(0, SONG_MAX) : [];
  const fx = p?.fx && typeof p.fx === 'object' ? p.fx : {};
  const defaults = newProject().fx.params;
  out.fx = { active: fx.active in EFFECTS ? fx.active : 'none', params: defaults };
  for (const [k, def] of Object.entries(defaults)) {
    const v = fx.params?.[k];
    if (Array.isArray(v) && v.length === def.length && v.every(Number.isFinite)) out.fx.params[k] = v.map((x) => num(x, 0, 1, 0));
  }
  return out;
}
