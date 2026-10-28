// Web Audio engine: sample loading, voices, group buses, one-at-a-time effects, punch-in FX.
import { USER_SAMPLE_MIN } from './data.js';
import { fitRate } from './model.js';

const pad3 = (n) => String(n).padStart(3, '0');
const dbToGain = (db) => 10 ** (db / 20);
const expMap = (x, lo, hi) => lo * (hi / lo) ** x;

function noiseImpulse(ctx, seconds, damp) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const decay = (1 - i / len) ** 3;
      lp += (Math.random() * 2 - 1 - lp) * damp;   // one-pole low-pass darkens the tail
      d[i] = lp * decay;
    }
  }
  return buf;
}

function distCurve(amount, steps = 0) {
  const n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = (i / (n - 1)) * 2 - 1;
    if (steps) x = Math.round(x * steps) / steps;
    c[i] = steps ? x : Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

export class Engine {
  constructor(userSamples) {
    this.userSamples = userSamples;   // object with get(id) -> {data:ArrayBuffer}|undefined
    this.buffers = new Map();
    this.pending = new Map();
    this.active = new Set();          // live voices
    this.rateMul = 1;
    this.bpm = 120;
    this.triggerCount = 0;            // exposed for tests
    this.ctx = null;
  }

  // Must be called from a user gesture on iOS.
  async start() {
    if (!this.ctx) this._build();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  _build() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new Ctx({ latencyHint: 'interactive' });
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    // Four group buses summing into the FX chain.
    // Each group splits into a dry path and an FX send. The send feeds the single active effect.
    this.groupBus = [0, 1, 2, 3].map(() => g(0.8));
    this.dryMix = g(1);
    this.fxIn = g(1);
    this.mix = this.fxIn;
    this.dryG = []; this.sendG = [];
    this.groupBus.forEach((b) => {
      const d = g(1), s = g(1);
      b.connect(d); b.connect(s); d.connect(this.dryMix); s.connect(this.fxIn);
      this.dryG.push(d); this.sendG.push(s);
    });

    // Filter: LP then HP, neutral until used.
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 22000;
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 20;
    this.mix.connect(this.lp); this.lp.connect(this.hp);

    // Wet/dry insert helper.
    const insert = (input, proc) => {
      const out = g(1), dry = g(1), wet = g(0);
      input.connect(dry); dry.connect(out);
      input.connect(proc.in); proc.out.connect(wet); wet.connect(out);
      return { out, dry, wet };
    };

    // Distortion (effect) + tone.
    this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '2x';
    this.distTone = ctx.createBiquadFilter(); this.distTone.type = 'lowpass';
    this.shaper.connect(this.distTone);
    this.dist = insert(this.hp, { in: this.shaper, out: this.distTone });

    // Compressor (effect) with make-up drive.
    this.compDrive = g(1);
    this.comp = ctx.createDynamicsCompressor();
    this.compDrive.connect(this.comp);
    this.compIns = insert(this.dist.out, { in: this.compDrive, out: this.comp });

    // Chorus: modulated short delay, added in parallel.
    this.chDelay = ctx.createDelay(0.05); this.chDelay.delayTime.value = 0.015;
    this.chLfo = ctx.createOscillator(); this.chLfo.frequency.value = 0.8;
    this.chDepth = g(0.002); this.chLfo.connect(this.chDepth); this.chDepth.connect(this.chDelay.delayTime);
    this.chFb = g(0); this.chDelay.connect(this.chFb); this.chFb.connect(this.chDelay);
    this.chLfo.start();
    this.chorusIns = insert(this.compIns.out, { in: this.chDelay, out: this.chDelay });
    this.fxOut = g(0);
    this.chorusIns.out.connect(this.fxOut);

    // Punch-in stage: stutter gate, bitcrush, dedicated distortion, LP/HP sweep.
    this.stutter = g(1);
    this.dryMix.connect(this.stutter);
    this.fxOut.connect(this.stutter);
    this.crush = ctx.createWaveShaper();
    this.crushIns = insert(this.stutter, { in: this.crush, out: this.crush });
    this.pDist = ctx.createWaveShaper(); this.pDist.curve = distCurve(12);
    this.pDistIns = insert(this.crushIns.out, { in: this.pDist, out: this.pDist });
    this.pLp = ctx.createBiquadFilter(); this.pLp.type = 'lowpass'; this.pLp.frequency.value = 22000;
    this.pHp = ctx.createBiquadFilter(); this.pHp.type = 'highpass'; this.pHp.frequency.value = 20;
    this.pDistIns.out.connect(this.pLp); this.pLp.connect(this.pHp);
    this.post = this.pHp;

    // Parallel sends: delay and reverb.
    this.delay = ctx.createDelay(2);
    this.delayFb = g(0.4); this.delaySend = g(0); this.delayRet = g(1);
    this.delaySend.connect(this.delay); this.delay.connect(this.delayFb); this.delayFb.connect(this.delay);
    this.delay.connect(this.delayRet);
    this.post.connect(this.delaySend);          // punch-in throw (whole mix)
    this.delayFx = g(0); this.fxIn.connect(this.delayFx); this.delayFx.connect(this.delay);   // delay effect (sent groups)
    this.reverb = ctx.createConvolver();
    this.verbTone = ctx.createBiquadFilter(); this.verbTone.type = 'lowpass'; this.verbTone.frequency.value = 6000;
    this.reverbSend = g(0); this.reverbRet = g(1);
    this.post.connect(this.reverbSend); this.reverbSend.connect(this.reverb);
    this.reverbFx = g(0); this.fxIn.connect(this.reverbFx); this.reverbFx.connect(this.reverb);
    this.reverb.connect(this.verbTone); this.verbTone.connect(this.reverbRet);

    // Master: sum, volume, safety limiter, meter.
    this.master = g(0.9);
    this.post.connect(this.master); this.delayRet.connect(this.master); this.reverbRet.connect(this.master);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.1;
    this.master.connect(this.limiter);
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512;
    this.limiter.connect(this.analyser); this.limiter.connect(ctx.destination);
    // Tap for recording the main output is not needed; mic goes through a separate path.

    this.fxState = { active: 'none', params: {} };
    this.sends = [1, 1, 1, 1];
    this._reverbKey = '';
    this.applyFx('none', {});
    this.reverb.buffer = noiseImpulse(ctx, 1.5, 0.5);
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  get latency() { return this.ctx ? (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0; }

  setBpm(b) { this.bpm = b; if (this.fxState.active === 'delay') this.applyFx('delay', this.fxState.params); }
  setGroupSend(i, v) { this.sends[i] = v; this.updateSends(); }

  // Dry/send balance per group. Insert effects crossfade; parallel effects leave the dry path alone.
  updateSends() {
    if (!this.ctx) return;
    const a = this.fxState.active;
    const insert = a === 'filter' || a === 'distortion' || a === 'compressor';
    for (let i = 0; i < 4; i++) {
      let dry = insert ? 1 - this.sends[i] : 1, send = a === 'none' ? 0 : this.sends[i];
      if (this._flange) { dry = 0; send = 1; }
      this._glide(this.dryG[i].gain, dry); this._glide(this.sendG[i].gain, send);
    }
    this._glide(this.fxOut.gain, this._flange || insert || a === 'chorus' ? 1 : 0);
  }

  // Short glide to a new value. Clears pending automation first so repeated calls in one tick cannot stack.
  _glide(param, v) {
    const t = this.now;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(v, t, 0.02);
  }

  setMaster(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.now, 0.01); }
  // `at` schedules the change on the audio clock (used by fader automation); without it the change is immediate.
  setGroupLevel(i, v, muted, at) {
    if (at === undefined) (this._groupLvl ||= [])[i] = { v, muted };
    if (this.groupBus && at === undefined) this.groupBus[i].gain.cancelScheduledValues(this.now);   // drop queued automation
    if (this.groupBus) this.groupBus[i].gain.setTargetAtTime(muted || (this.soloGroup != null && this.soloGroup !== i) ? 0 : v, at ?? this.now, 0.01);
  }

  // Solo one group (others go silent) or one pad within a group. null clears.
  setSoloGroup(g) {
    this.soloGroup = g;
    (this._groupLvl || []).forEach((l, i) => l && this.setGroupLevel(i, l.v, l.muted));
  }
  setSoloPad(g, p) { this.soloPad = g == null ? null : { g, p }; }

  // ---- samples -----------------------------------------------------------
  async load(id) {
    if (!id) return null;
    if (this.buffers.has(id)) return this.buffers.get(id);
    if (this.pending.has(id)) return this.pending.get(id);
    const p = (async () => {
      let data;
      if (id >= USER_SAMPLE_MIN) {
        const rec = await this.userSamples.get(id);
        if (!rec) return null;
        data = rec.data.slice(0);
      } else {
        let r;
        try { r = await fetch(`samples/${pad3(id)}.flac`); } catch { r = null; }
        if (!r || !r.ok) { this.onMissing?.(id); throw new Error(`sample ${id} not available`); }
        data = await r.arrayBuffer();
      }
      const buf = await this.ctx.decodeAudioData(data);
      this.buffers.set(id, buf);
      return buf;
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    return p;
  }

  forget(id) { this.buffers.delete(id); }

  // ---- resample: record the main output ----------------------------------
  async startCapture(maxSeconds = 20, onLimit = null) {
    if (!this.ctx.audioWorklet) throw new Error('Resampling needs a newer browser');
    if (!this._capReady) {
      const src = 'registerProcessor("kopad-cap", class extends AudioWorkletProcessor { process(i) { const x = i[0]; if (x && x.length) this.port.postMessage([x[0].slice(), (x[1] || x[0]).slice()]); return true; } });';
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
      this._capReady = true;
    }
    const node = new AudioWorkletNode(this.ctx, 'kopad-cap', { numberOfOutputs: 0 });
    const chunks = [[], []], limit = Math.floor(this.ctx.sampleRate * maxSeconds);
    let frames = 0;
    node.port.onmessage = (e) => {
      if (frames >= limit) return;
      chunks[0].push(e.data[0]); chunks[1].push(e.data[1]); frames += e.data[0].length;
      if (frames >= limit && onLimit) queueMicrotask(onLimit);
    };
    this.limiter.connect(node);
    this._cap = { node, chunks, get frames() { return frames; }, limit };
  }

  // Stops a capture and returns it as an AudioBuffer (null when nothing was captured).
  stopCapture() {
    const c = this._cap; if (!c) return null;
    this._cap = null;
    try { this.limiter.disconnect(c.node); } catch { /* already gone */ }
    c.node.port.onmessage = null; c.node.disconnect();
    const n = Math.min(c.frames, c.limit);
    if (!n) return null;
    const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const out = buf.getChannelData(ch); let o = 0;
      for (const part of c.chunks[ch]) { const take = Math.min(part.length, n - o); out.set(part.subarray(0, take), o); o += take; if (o >= n) break; }
    }
    return buf;
  }
  get capturing() { return !!this._cap; }

  // Free decoded sounds that the open project does not use (decoded audio is large on an iPad).
  retain(ids) {
    const keep = new Set(ids);
    for (const id of [...this.buffers.keys()]) if (!keep.has(id)) this.buffers.delete(id);
  }

  // ---- voices ------------------------------------------------------------
  // Returns a voice or null if the sample is not decoded yet (it is then requested for next time).
  trigger(group, padIdx, pad, vel = 100, when = 0, semis = 0) {
    if (!this.ctx || !pad.s) return null;
    if (this.soloPad && this.soloPad.g === group && this.soloPad.p !== padIdx) return null;
    const buf = this.buffers.get(pad.s);
    if (!buf) { this.load(pad.s).catch(() => {}); return null; }
    const ctx = this.ctx;
    const t0 = Math.max(when, ctx.currentTime);

    if (pad.mg) for (const v of [...this.active]) if (v.group === group && v.mg === pad.mg) v.stop(t0);
    if (pad.mode !== 'oneshot') for (const v of [...this.active]) if (v.group === group && v.pad === padIdx) v.stop(t0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const baseRate = 2 ** ((pad.pitch + semis) / 12) * fitRate((Math.min(1, pad.end) - Math.max(0, pad.start)) * buf.duration, pad.fit, this.bpm);
    src.playbackRate.value = baseRate * this.rateMul;
    const dur = buf.duration;
    const a = Math.min(pad.start, pad.end - 0.001) * dur;
    const b = pad.end * dur;
    if (pad.mode === 'loop') { src.loop = true; src.loopStart = a; src.loopEnd = b; }

    const env = ctx.createGain();
    const level = pad.vol * (vel / 127) ** 1.2;
    const atk = Math.max(0.001, pad.atk || 0);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(level, t0 + atk);
    const pan = ctx.createStereoPanner(); pan.pan.value = pad.pan;
    src.connect(env); env.connect(pan); pan.connect(this.groupBus[group]);

    if (pad.mode === 'loop') src.start(t0, a);
    else {
      src.start(t0, a, (b - a));
      if (pad.end < 1) {          // short fade so a trimmed end does not click
        const endT = t0 + (b - a) / (baseRate * this.rateMul);
        env.gain.setValueAtTime(level, Math.max(t0 + atk, endT - 0.005));
        env.gain.linearRampToValueAtTime(0, endT);
      }
    }
    this.triggerCount++;

    const voice = {
      group, pad: padIdx, mg: pad.mg, src, env, baseRate, level, rel: pad.rel || 0.02, done: false,
      stop: (at = ctx.currentTime) => {
        if (voice.done) return;
        voice.done = true;
        const t = Math.max(at, ctx.currentTime);
        env.gain.cancelScheduledValues(t);
        env.gain.setValueAtTime(env.gain.value, t);
        env.gain.linearRampToValueAtTime(0, t + Math.max(0.005, voice.rel));
        try { src.stop(t + Math.max(0.005, voice.rel) + 0.01); } catch { /* already stopped */ }
      },
    };
    src.onended = () => { voice.done = true; this.active.delete(voice); src.disconnect(); env.disconnect(); pan.disconnect(); };
    this.active.add(voice);
    return voice;
  }

  preview(id, vel = 100) {
    if (!this.ctx) return;
    const buf = this.buffers.get(id);
    if (!buf) { this.load(id).then(() => this.preview(id, vel)).catch(() => {}); return; }
    if (this._pv) { try { this._pv.stop(); } catch { /* ended */ } }
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = (vel / 127) ** 1.2;
    s.connect(g); g.connect(this.master); s.start();
    this._pv = s;
  }

  stopAll() { for (const v of [...this.active]) v.stop(); }

  click(when, accent) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.35, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g); g.connect(this.limiter); o.start(when); o.stop(when + 0.06);
  }

  // ---- effects: one active at a time, like the hardware ---------------------
  applyFx(name, params) {
    if (!this.ctx) return;
    const t = this.now, tc = 0.02;
    this.fxState = { active: name, params };
    const P = (k) => params[k] || [0.5, 0.5];
    const set = (p, v) => p.setTargetAtTime(v, t, tc);

    // Neutral state for everything first.
    set(this.lp.frequency, 22000); set(this.hp.frequency, 20);
    this.lp.Q.value = 0.7; this.hp.Q.value = 0.7;
    set(this.dist.wet.gain, 0); set(this.dist.dry.gain, 1);
    set(this.compIns.wet.gain, 0); set(this.compIns.dry.gain, 1);
    set(this.chorusIns.wet.gain, 0); set(this.chorusIns.dry.gain, 1);
    set(this.delayFx.gain, 0); set(this.reverbFx.gain, 0);

    if (name === 'delay') {
      const [x, y] = P('delay');
      const beat = 60 / this.bpm;
      const steps = [beat / 8, beat / 4, beat / 3, beat / 2, beat * 0.75, beat];  // 1/32 ... 1/4
      set(this.delay.delayTime, steps[Math.min(5, Math.floor(x * 6))]);
      set(this.delayFb.gain, y * 0.88);
      set(this.delayFx.gain, 0.6);
    } else if (name === 'reverb') {
      const [x, y] = P('reverb');
      const key = x.toFixed(2);
      if (key !== this._reverbKey) {
        this._reverbKey = key;
        clearTimeout(this._verbTimer);
        this._verbTimer = setTimeout(() => { this.reverb.buffer = noiseImpulse(this.ctx, 0.3 + x * 3.2, 0.5); }, 60);
      }
      set(this.verbTone.frequency, expMap(y, 800, 14000));
      set(this.reverbFx.gain, 0.55);
    } else if (name === 'distortion') {
      const [x, y] = P('distortion');
      this.shaper.curve = distCurve(1 + x * 24);
      set(this.distTone.frequency, expMap(y, 600, 14000));
      this.distTone.Q.value = 0.7 + y * 4;
      set(this.dist.wet.gain, 0.9); set(this.dist.dry.gain, 0);
    } else if (name === 'chorus') {
      const [x, y] = P('chorus');
      set(this.chLfo.frequency, expMap(x, 0.1, 7));
      set(this.chDepth.gain, 0.0015 + x * 0.004);
      set(this.chFb.gain, y * 0.75);
      set(this.chorusIns.wet.gain, 0.8); set(this.chorusIns.dry.gain, 0);
    } else if (name === 'filter') {
      const [x, y] = P('filter');
      const q = 0.7 + y * 14;
      if (x < 0.5) { set(this.lp.frequency, expMap(x * 2, 150, 22000)); this.lp.Q.value = q; }
      else { set(this.hp.frequency, expMap((x - 0.5) * 2, 20, 7000)); this.hp.Q.value = q; }
    } else if (name === 'compressor') {
      const [x, y] = P('compressor');
      set(this.compDrive.gain, dbToGain(x * 20));
      this.comp.threshold.value = -30 + (1 - x) * 12;
      this.comp.ratio.value = 8;
      this.comp.attack.value = expMap(1 - y, 0.001, 0.08);
      this.comp.release.value = expMap(1 - y, 0.03, 0.4);
      set(this.compIns.wet.gain, 1); set(this.compIns.dry.gain, 0);
    }
    this.updateSends();
  }

  // ---- punch-in FX (momentary) ------------------------------------------------
  punch(i, on) {
    if (!this.ctx) return;
    const t = this.now, c = this.ctx;
    const ramp = (p, v, d = 0.03) => { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + d); };
    switch (i) {
      case 0: ramp(this.pLp.frequency, on ? 320 : 22000, on ? 0.25 : 0.05); break;
      case 1: ramp(this.pHp.frequency, on ? 1800 : 20, on ? 0.25 : 0.05); break;
      case 2:
        if (on) { this._dt = { time: this.delay.delayTime.value, fb: this.delayFb.gain.value, send: this.delaySend.gain.value };
          this.delay.delayTime.setValueAtTime(60 / this.bpm * 0.75, t); this.delayFb.gain.setValueAtTime(0.72, t); this.delaySend.gain.setValueAtTime(1, t); }
        else { const s = this._dt || { time: 0.3, fb: 0.4, send: 0 };
          this.delaySend.gain.setValueAtTime(s.send, t); this.delayFb.gain.setTargetAtTime(s.fb, t + 1.2, 0.3); this.delay.delayTime.setValueAtTime(s.time, t + 2); }
        break;
      case 3:
        if (on) { this._vt = this.reverbSend.gain.value; ramp(this.reverbSend.gain, 1, 0.02); }
        else ramp(this.reverbSend.gain, this._vt || 0, 0.8);
        break;
      case 4:
        ramp(this.pDistIns.wet.gain, on ? 0.9 : 0, 0.02); ramp(this.pDistIns.dry.gain, on ? 0.1 : 1, 0.02); break;
      case 5:
        if (on) { this._flange = true; this.updateSends();
          this.chLfo.frequency.setValueAtTime(0.35, t); this.chDepth.gain.setValueAtTime(0.0045, t); this.chFb.gain.setValueAtTime(0.85, t); ramp(this.chorusIns.wet.gain, 1, 0.02); }
        else { this._flange = false; this.applyFx(this.fxState.active, this.fxState.params); }
        break;
      case 6: case 7: {
        if (on) {
          const hz = (this.bpm / 60) * (i === 6 ? 2 : 4);   // one gate cycle per note value
          const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = hz;
          const amp = c.createGain(); amp.gain.value = 0.5;
          this.stutter.gain.cancelScheduledValues(t); this.stutter.gain.setValueAtTime(0.5, t);
          lfo.connect(amp); amp.connect(this.stutter.gain); lfo.start(t);
          this._stut = { lfo, amp };
        } else if (this._stut) {
          this._stut.lfo.stop(t); this._stut.amp.disconnect(); this._stut = null;
          this.stutter.gain.cancelScheduledValues(t); this.stutter.gain.setValueAtTime(1, t);
        }
        break;
      }
      case 8:
        this.crush.curve = on ? distCurve(1, 6) : null;
        ramp(this.crushIns.wet.gain, on ? 1 : 0, 0.01); ramp(this.crushIns.dry.gain, on ? 0 : 1, 0.01); break;
      case 9: this._rate(on ? 0.02 : 1, on ? 0.9 : 0.08); break;
      case 10: this._rate(on ? 0.5 : 1, 0.05); break;
      case 11: this._rate(on ? 2 : 1, 0.05); break;
      default:
    }
  }

  _rate(target, dur) {
    const t = this.now;
    this.rateMul = target;
    for (const v of this.active) {
      const p = v.src.playbackRate;
      p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(Math.max(0.01, v.baseRate * target), t + dur);
    }
  }

  punchHold(i, on) { (this._held ||= [])[i] = on; this.punch(i, on); }

  level() {
    if (!this.analyser) return 0;
    const a = this.analyser, d = (this._lvl ||= new Float32Array(a.fftSize));
    a.getFloatTimeDomainData(d);
    let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    return m;
  }
}

// Encode an AudioBuffer as 16-bit PCM WAV (used to store mic recordings and imports).
export function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const out = new ArrayBuffer(44 + len * ch * 2), v = new DataView(out);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch).keys()].map((c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return out;
}
