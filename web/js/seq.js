// Look-ahead sequencer. Ticks are 1/96 of a quarter note; scheduling uses the audio clock.
import { PPQ, BAR_TICKS, GRIDS } from './data.js';
import { getPattern, buildIndex, buildAutoIndex, patternTicks, barTicks, loopPosition, addEvent, addAuto, quantiseTick } from './model.js';

const LOOKAHEAD = 0.12;
const INTERVAL = 25;

export class Sequencer {
  constructor(engine, host) {
    this.engine = engine;
    this.host = host;               // { project, onScene(), onChange() }
    this.playing = false;
    this.recording = false;
    this.metronome = false;
    this.countIn = true;
    this.quantise = '1/16';
    this.songMode = false;
    this.songPos = 0;
    this.sceneStart = 0;
    this.tick = 0;
    this.nextTime = 0;
    this.queue = [];
    this.last = { tick: 0, time: 0 };
    this.indexCache = new WeakMap();
    this.autoCache = new WeakMap();
    this.countLen = BAR_TICKS;
    this.sceneOverride = null;      // per-group pattern numbers while a song plays
    this.held = new Map();          // `${g}:${p}` -> { ev, startTick, voice }
    this.repeats = new Map();       // note repeat: `${g}:${p}` -> { g, p, vel, semis, timer }
    this.timer = null;
  }

  get project() { return this.host.project(); }
  get tickDur() { return 60 / (this.project.bpm * PPQ); }

  start({ record = false, countIn = this.countIn } = {}) {
    if (!this.engine.ctx) return;
    this.recording = record;
    if (this.playing) return;
    this.engine.setBpm(this.project.bpm);
    this.playing = true;
    this.countLen = this._barTicks();
    this.tick = (record && countIn) ? -this.countLen : 0;
    this.sceneStart = 0; this.songPos = 0;
    this.sceneOverride = null;
    if (this.songMode) this._enterScene(0);
    this.nextTime = this.engine.now + 0.06;
    this.queue = []; this.last = { tick: this.tick, time: this.nextTime };
    this.timer = setInterval(() => this._pump(), INTERVAL);
    this._pump();
  }

  stop() {
    if (!this.playing) { this.recording = false; return; }
    clearInterval(this.timer); this.timer = null;
    this.playing = false; this.recording = false;
    this.sceneOverride = null;
    for (const h of this.held.values()) h.voice?.stop();
    this.held.clear();
    this.engine.stopAll();
    this.host.onStop?.();
    this.host.onScene?.();
  }

  // The pattern number that is sounding for a group: the scene's, in song mode, otherwise the selected one.
  _numFor(g) {
    return this.sceneOverride ? this.sceneOverride[g] : this.project.groups[g].cur;
  }

  _patFor(g) {
    const n = this._numFor(g);
    if (!n) return null;
    return getPattern(this.project, g, n);
  }

  _index(pat) {
    // Rebuild whenever the event array identity or length changes (edits replace the array).
    const c = this.indexCache.get(pat);
    if (c && c.ref === pat.ev && c.len === pat.ev.length) return c.map;
    const map = buildIndex(pat);
    this.indexCache.set(pat, { ref: pat.ev, len: pat.ev.length, map });
    return map;
  }

  _autoIndex(pat) {
    const c = this.autoCache.get(pat);
    if (c && c.ref === pat.auto && c.len === pat.auto.length) return c.map;
    const map = buildAutoIndex(pat);
    this.autoCache.set(pat, { ref: pat.auto, len: pat.auto.length, map });
    return map;
  }

  // Write a fader move into the playing pattern while recording.
  recordAuto(g, v) {
    if (!this.playing || !this.recording) return;
    const pos = this.position(); if (pos === null || pos < 0) return;
    const pat = getPattern(this.project, g, this._numFor(g) || this.project.groups[g].cur, true);
    const base = this.songMode ? pos - this.sceneStart : pos;
    this.host.beforeEdit?.(g, pat, true);
    addAuto(pat, base % patternTicks(pat), v);
    this.host.onChange?.();
  }

  _enterScene(pos) {
    const id = this.project.song[pos];
    const scene = this.project.scenes[String(id)];
    this.sceneOverride = scene ? [...scene] : null;
    this.songPos = pos;
    this.countLen = this._barTicks();
    this.host.onScene?.();
  }

  // Length of a bar for the metronome, count-in and position display: that of the first sounding pattern.
  _barTicks() {
    for (let g = 0; g < 4; g++) { const p = this._patFor(g); if (p) return barTicks(p); }
    return BAR_TICKS;
  }

  // Playhead as shown on the counter: wraps at the loop length (longest sounding pattern).
  displayTick(pos) {
    return loopPosition(this.songMode ? pos - this.sceneStart : pos, this._sceneLen());
  }

  _sceneLen() {
    let max = this._barTicks();
    for (let g = 0; g < 4; g++) { const p = this._patFor(g); if (p) max = Math.max(max, patternTicks(p)); }
    return max;
  }

  _pump() {
    const e = this.engine;
    while (this.nextTime < e.now + LOOKAHEAD) {
      this._processTick(this.tick, this.nextTime);
      this.queue.push({ tick: this.tick, time: this.nextTime });
      this.nextTime += this.tickDur;
      this.tick++;
      if (this.queue.length > 400) this.queue.shift();
    }
  }

  _processTick(tick, time) {
    const e = this.engine, proj = this.project;
    if (this.metronome || tick < 0) {
      const bt = this.countLen || BAR_TICKS;
      const rel = tick < 0 ? tick + bt : tick - (this.songMode ? this.sceneStart : 0);
      if (rel % PPQ === 0) e.click(time, rel % bt === 0);
    }
    if (tick < 0) return;

    if (this.songMode && proj.song.length) {
      if (tick - this.sceneStart >= this._sceneLen()) {
        const next = this.songPos + 1;
        if (next >= proj.song.length) { setTimeout(() => this.stop(), 0); return; }
        this.sceneStart = tick;
        this._enterScene(next);
      }
    }
    const base = this.songMode ? tick - this.sceneStart : tick;
    const swingTicks = proj.swing * 8;       // 0-100% => 0-8 ticks, 8 ticks is a full triplet feel
    for (let g = 0; g < 4; g++) {
      const pat = this._patFor(g);
      if (!pat) continue;
      const grp = proj.groups[g];
      const local = base % patternTicks(pat);
      if (pat.auto) {
        const lv = this._autoIndex(pat).get(local);
        if (lv !== undefined) e.setGroupLevel(g, lv, grp.mute, time);
      }
      if (!pat.ev.length) continue;
      const evs = this._index(pat).get(local);
      if (!evs) continue;
      const off = (local % (PPQ / 2) === PPQ / 4) ? swingTicks * this.tickDur : 0;
      for (const ev of evs) {
        const pad = grp.pads[ev.p];
        if (!pad) continue;
        try {
          const v = e.trigger(g, ev.p, pad, ev.v, time + off, ev.n || 0);
          if (v && pad.mode !== 'oneshot') v.stop(time + off + (ev.d || 24) * this.tickDur);
          this.host.onHit?.(g, ev.p, time + off);
        } catch (err) { console.error('hit skipped', err); }   // one bad hit must not stop the clock
      }
    }
    this._processRepeats(base, time);
  }

  // Note repeat: held pads retrigger on every grid line, and are written to the pattern when recording.
  _processRepeats(base, time) {
    if (!this.repeats.size) return;
    const grid = GRIDS[this.quantise] || 24;
    if (base % grid !== 0) return;
    for (const r of this.repeats.values()) {
      const pad = this.project.groups[r.g].pads[r.p];
      this.engine.trigger(r.g, r.p, pad, r.vel, time, r.semis);
      this.host.onHit?.(r.g, r.p, time);
      if (this.recording) {
        const pat = getPattern(this.project, r.g, this._numFor(r.g) || this.project.groups[r.g].cur, true);
        const ev = { t: base % patternTicks(pat), p: r.p, v: r.vel, d: grid };
        if (r.semis) ev.n = r.semis;
        this.host.beforeEdit?.(r.g, pat, true);
        addEvent(pat, ev);
        this.host.onChange?.();
      }
    }
  }

  startRepeat(g, p, vel, semis = 0) {
    const key = `${g}:${p}`;
    this.stopRepeat(g, p);
    const r = { g, p, vel, semis, timer: null };
    if (!this.playing) {
      const fire = () => this.engine.trigger(g, p, this.project.groups[g].pads[p], vel, 0, semis);
      fire();
      r.timer = setInterval(fire, (GRIDS[this.quantise] || 24) * this.tickDur * 1000);
    }
    this.repeats.set(key, r);
  }

  stopRepeat(g, p) {
    const key = `${g}:${p}`, r = this.repeats.get(key);
    if (r) { clearInterval(r.timer); this.repeats.delete(key); }
  }

  // Playhead in ticks (float), compensated for output latency so it matches what you hear.
  position() {
    if (!this.playing) return null;
    const heard = this.engine.now - this.engine.latency;
    while (this.queue.length && this.queue[0].time <= heard) this.last = this.queue.shift();
    return this.last.tick + (heard - this.last.time) / this.tickDur;
  }

  // Called when a pad goes down. Returns the pattern tick it was stored at, if recording.
  padDown(g, p, vel, semis = 0) {
    const key = `${g}:${p}`;
    const pad = this.project.groups[g].pads[p];
    let voice = null;
    const entry = { voice: null, ev: null, startTick: 0, pat: null };
    if (this.playing && this.recording) {
      const pos = this.position();
      if (pos !== null && pos >= 0) {
        const pat = getPattern(this.project, g, this._numFor(g) || this.project.groups[g].cur, true);
        const base = this.songMode ? pos - this.sceneStart : pos;
        const len = patternTicks(pat);
        const t = quantiseTick(base % len, this.quantise, len);
        const grid = GRIDS[this.quantise] || 24;
        const ev = { t, p, v: vel, d: grid };
        if (semis) ev.n = semis;
        this.host.beforeEdit?.(g, pat, true);
        addEvent(pat, ev);
        Object.assign(entry, { ev, startTick: base, pat });
        this.host.onChange?.();
      }
    }
    voice = this.engine.trigger(g, p, pad, vel, 0, semis);
    entry.voice = voice;
    this.held.set(key, entry);
    return voice;
  }

  padUp(g, p) {
    const key = `${g}:${p}`;
    const h = this.held.get(key);
    this.held.delete(key);
    if (!h) return;
    const pad = this.project.groups[g].pads[p];
    if (pad.mode !== 'oneshot') h.voice?.stop();
    if (h.ev && pad.mode !== 'oneshot') {
      const pos = this.position();
      if (pos !== null) {
        const base = this.songMode ? pos - this.sceneStart : pos;
        const elapsed = Math.round(base - h.startTick);
        h.ev.d = Math.max(GRIDS[this.quantise] || 12, Math.min(patternTicks(h.pat), elapsed));
        this.host.onChange?.();
      }
    }
  }
}
