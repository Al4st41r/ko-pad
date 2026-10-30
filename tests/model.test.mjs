import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PRESETS } from '../web/js/data.js';
import * as M from '../web/js/model.js';

// The sounds are not part of the public repository. This check runs only where a sample set is installed.
const catUrl = new URL('../web/samples/catalogue.json', import.meta.url);
const cat = existsSync(catUrl) ? JSON.parse(readFileSync(catUrl)) : [];
const ids = new Set(cat.map((c) => c.id));

test('every preset sample exists in the catalogue and on disk', { skip: cat.length ? false : 'no sample set installed' }, () => {
  for (const [p, groups] of Object.entries(PRESETS)) {
    for (const [g, list] of Object.entries(groups)) {
      assert.equal(list.length, 12, `P${p} ${g}`);
      for (const id of list) {
        assert.ok(ids.has(id), `P${p} ${g}: sample ${id} missing from catalogue`);
        assert.ok(existsSync(new URL(`../web/samples/${String(id).padStart(3, '0')}.flac`, import.meta.url)));
      }
    }
  }
});

test('factory project 1 has banks A-C filled and D empty', () => {
  const p = M.factoryProject(1);
  assert.equal(p.groups[0].pads[0].s, 343);
  assert.equal(p.groups[0].pads[9].s, 1);
  assert.equal(p.groups[2].pads[11].s, 510);
  assert.ok(p.groups[3].pads.every((x) => x.s === 0));
  assert.ok(M.factoryProject(5).groups[0].pads.every((x) => x.s === 0));
});

test('toggle step adds then removes; triplet grid cell catches off-grid event', () => {
  const pat = M.emptyPattern();
  assert.equal(M.toggleStep(pat, 0, 9, 24), true);
  assert.equal(pat.ev.length, 1);
  assert.equal(M.toggleStep(pat, 0, 9, 24), false);
  assert.equal(pat.ev.length, 0);
  M.addEvent(pat, { t: 5, p: 1, v: 100, d: 5 });
  assert.equal(M.toggleStep(pat, 0, 1, 24), false);
});

test('addEvent replaces same pad and tick, keeps sort order', () => {
  const pat = M.emptyPattern();
  M.addEvent(pat, { t: 48, p: 2, v: 50, d: 24 });
  M.addEvent(pat, { t: 0, p: 2, v: 50, d: 24 });
  M.addEvent(pat, { t: 48, p: 2, v: 99, d: 24 });
  assert.deepEqual(pat.ev.map((e) => [e.t, e.v]), [[0, 50], [48, 99]]);
});

test('quantise snaps and wraps at pattern end', () => {
  assert.equal(M.quantiseTick(13, '1/16', 384), 24);
  assert.equal(M.quantiseTick(11, '1/16', 384), 0);
  assert.equal(M.quantiseTick(380, '1/16', 384), 0);
  assert.equal(M.quantiseTick(13.4, 'off', 384), 13);
});

test('setBars drops events beyond new length', () => {
  const pat = M.emptyPattern(2);
  M.addEvent(pat, { t: 400, p: 0, v: 100, d: 24 });
  M.addEvent(pat, { t: 10, p: 0, v: 100, d: 24 });
  M.setBars(pat, 1);
  assert.equal(pat.ev.length, 1);
  M.setBars(pat, 500);
  assert.equal(pat.bars, 99);
});

test('keys mode maps bottom-left pad to the lowest note', () => {
  assert.equal(M.padSemitone(9), 0);
  assert.equal(M.padSemitone(11), 2);
  assert.equal(M.padSemitone(0), 9);
  assert.equal(M.padSemitone(2), 11);
});

test('undo restores snapshot; normaliseProject fills gaps', () => {
  const pat = M.emptyPattern();
  const u = new M.UndoStack();
  u.push('0:1', pat);
  M.addEvent(pat, { t: 0, p: 0, v: 1, d: 1 });
  assert.equal(u.pop().snap.ev.length, 0);
  const n = M.normaliseProject({ name: 'X', groups: [{ pads: [{ s: 5 }] }] });
  assert.equal(n.groups.length, 4);
  assert.equal(n.groups[0].pads[0].s, 5);
  assert.equal(n.groups[0].pads[0].vol, 1);
  assert.equal(n.groups[0].pads.length, 12);
});

test('scales walk up the degrees and continue into the next octave', () => {
  assert.equal(M.scaleNote(0, 'major'), 0);
  assert.equal(M.scaleNote(2, 'major'), 4);
  assert.equal(M.scaleNote(7, 'major'), 12);
  assert.equal(M.scaleNote(8, 'minor pentatonic'), 12 + 7);
  assert.equal(M.scaleNote(11, 'chromatic'), 11);
  assert.equal(M.scaleNote(3, 'nonsense'), 3);
});

test('nextFreeScene finds the first gap', () => {
  const p = M.newProject();
  assert.equal(M.nextFreeScene(p), 1);
  p.scenes['1'] = [1, 0, 0, 0]; p.scenes['3'] = [1, 0, 0, 0];
  assert.equal(M.nextFreeScene(p), 2);
});

test('new groups default to full FX send', () => {
  assert.equal(M.newProject().groups[0].send, 1);
  assert.equal(M.normaliseProject({ groups: [{}] }).groups[2].send, 1);
});

test('normaliseProject drops bad events and clamps pad values', () => {
  const p = M.normaliseProject({
    bpm: 'fast',
    groups: [{
      pads: [{ start: null, end: 'x', mode: 'bogus', s: 5000 }],
      patterns: { 1: { bars: 500, ev: [{ t: 0, p: 99 }, { t: 'a', p: 1 }, { t: 96, p: 9, v: 500 }, null] } },
    }],
  });
  assert.equal(p.bpm, 120);
  const pad = p.groups[0].pads[0];
  assert.equal(pad.start, 0); assert.equal(pad.end, 1); assert.equal(pad.mode, 'oneshot'); assert.equal(pad.s, 999);
  const pat = p.groups[0].patterns['1'];
  assert.equal(pat.bars, 99);
  assert.equal(pat.ev.length, 1);
  assert.equal(pat.ev[0].v, 127);
});

test('normaliseProject keeps a valid project unchanged', () => {
  const a = M.factoryProject(1);
  a.groups[0].patterns['1'] = { bars: 2, ev: [{ t: 96, p: 9, v: 100, d: 24 }, { t: 400, p: 3, v: 80, d: 48, n: 4 }] };
  const b = M.normaliseProject(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(b.groups[0].patterns, a.groups[0].patterns);
  assert.deepEqual(b.groups[0].pads, a.groups[0].pads);
});

test('modal scales are complete', () => {
  for (const k of ['phrygian', 'lydian', 'mixolydian', 'locrian']) assert.equal(M.scaleNote(7, k), 12);
  assert.equal(M.scaleNote(1, 'phrygian'), 1);
  assert.equal(M.scaleNote(3, 'lydian'), 6);
});

test('copy and paste make an independent copy', () => {
  const a = { bars: 2, ev: [{ t: 0, p: 1, v: 100, d: 24 }] };
  const clip = M.copyOf(a), b = { bars: 1, ev: [] };
  M.pasteInto(b, clip);
  b.ev[0].v = 5;
  assert.equal(b.bars, 2); assert.equal(a.ev[0].v, 100); assert.equal(clip.ev[0].v, 100);
});

test('nextEmptyPattern skips used patterns and wraps', () => {
  const p = M.newProject();
  p.groups[0].patterns['1'] = { bars: 1, ev: [{ t: 0, p: 0, v: 1, d: 1 }] };
  p.groups[0].patterns['2'] = { bars: 1, ev: [] };
  assert.equal(M.nextEmptyPattern(p, 0, 1), 2);
  for (let i = 1; i <= 99; i++) p.groups[0].patterns[String(i)] = { bars: 1, ev: [{ t: 0, p: 0, v: 1, d: 1 }] };
  assert.equal(M.nextEmptyPattern(p, 0, 1), null);
});

test('length x2 repeats the hits and /2 keeps the first half', () => {
  const pat = { bars: 1, ev: [{ t: 0, p: 1, v: 100, d: 24 }, { t: 96, p: 2, v: 100, d: 24 }] };
  assert.equal(M.doubleLength(pat), true);
  assert.equal(pat.bars, 2); assert.deepEqual(pat.ev.map((e) => e.t), [0, 96, 384, 480]);
  assert.equal(M.halveLength(pat), true);
  assert.equal(pat.bars, 1); assert.equal(pat.ev.length, 2);
  assert.equal(M.halveLength(pat), false);
  pat.bars = 60; assert.equal(M.doubleLength(pat), false);
});

test('correctEvents snaps one pad or all pads', () => {
  const mk = () => ({ bars: 1, ev: [{ t: 5, p: 1, v: 100, d: 24 }, { t: 100, p: 2, v: 100, d: 24 }, { t: 30, p: 1, v: 90, d: 24 }] });
  const a = mk();
  assert.equal(M.correctEvents(a, '1/16', 1), 2);
  assert.deepEqual(a.ev.filter((e) => e.p === 1).map((e) => e.t), [0, 24]);
  assert.equal(a.ev.find((e) => e.p === 2).t, 100);
  const b = mk();
  M.correctEvents(b, '1/16', null);
  assert.equal(b.ev.find((e) => e.p === 2).t, 96);
  assert.equal(M.correctEvents(mk(), 'off', null), 0);
});

test('correctEvents keeps one hit when two land on the same step', () => {
  const pat = { bars: 1, ev: [{ t: 2, p: 1, v: 50, d: 24 }, { t: 5, p: 1, v: 90, d: 24 }] };
  M.correctEvents(pat, '1/16', 1);
  assert.equal(pat.ev.length, 1);
});

test('eraseScene removes the scene and its song entries', () => {
  const p = M.newProject();
  p.scenes = { 1: [1, 0, 0, 0], 2: [2, 0, 0, 0] }; p.song = [1, 2, 1];
  M.eraseScene(p, 1);
  assert.deepEqual(Object.keys(p.scenes), ['2']); assert.deepEqual(p.song, [2]);
});

test('normaliseProject keeps every play mode the SOUND tab offers', () => {
  const p = M.normaliseProject({ groups: [{ pads: [{ mode: 'oneshot' }, { mode: 'key' }, { mode: 'loop' }] }] });
  assert.deepEqual(p.groups[0].pads.slice(0, 3).map((x) => x.mode), ['oneshot', 'key', 'loop']);
});

test('song edit helpers return new lists and respect the ends', () => {
  const s = [1, 2, 3];
  assert.deepEqual(M.songInsert(s, 1, 9), [1, 9, 2, 3]);
  assert.deepEqual(M.songInsert(s, 99, 9), [1, 2, 3, 9]);
  assert.deepEqual(M.songCut(s, 0), [2, 3]);
  assert.equal(M.songCut(s, 5), s);
  assert.deepEqual(M.songMove(s, 0, 1), [2, 1, 3]);
  assert.equal(M.songMove(s, 0, -1), s);
  assert.deepEqual(s, [1, 2, 3]);
  assert.equal(M.songInsert(Array.from({ length: 99 }, () => 1), 0, 2).length, 99);
});

test('nudgeEvent wraps inside the pattern and replaces a hit it lands on', () => {
  const pat = { bars: 1, ev: [{ t: 0, p: 1, v: 100, d: 24 }, { t: 24, p: 1, v: 50, d: 24 }, { t: 24, p: 2, v: 70, d: 24 }] };
  const a = pat.ev[0];
  M.nudgeEvent(pat, a, -1);
  assert.equal(a.t, 383);
  M.nudgeEvent(pat, a, 25);                       // 383 + 25 wraps to 24: replaces the pad 1 hit there
  assert.equal(a.t, 24);
  assert.equal(pat.ev.filter((e) => e.p === 1).length, 1);
  assert.equal(pat.ev.filter((e) => e.p === 2).length, 1);
});

test('velocity and duration changes stay in range', () => {
  const pat = { bars: 1, ev: [] };
  const e = { t: 0, p: 0, v: 120, d: 24 };
  M.changeVelocity(e, 50); assert.equal(e.v, 127);
  M.changeVelocity(e, -500); assert.equal(e.v, 1);
  M.changeDuration(pat, e, -100); assert.equal(e.d, 1);
  M.changeDuration(pat, e, 9999); assert.equal(e.d, 384);
});

test('eventAt finds the hit inside a step', () => {
  const pat = { bars: 1, ev: [{ t: 30, p: 3, v: 100, d: 24 }] };
  assert.equal(M.eventAt(pat, 3, 24, 24), pat.ev[0]);
  assert.equal(M.eventAt(pat, 3, 0, 24), undefined);
  assert.equal(M.eventAt(pat, 4, 24, 24), undefined);
});

test('fitRate makes a sound last the asked number of bars', () => {
  assert.equal(M.fitRate(2, 1, 120), 1);          // one bar at 120 bpm is 2 s
  assert.equal(M.fitRate(4, 1, 120), 2);
  assert.equal(M.fitRate(1, 1, 120), 0.5);
  assert.equal(M.fitRate(2, 0, 120), 1);
  assert.equal(M.fitRate(0, 1, 120), 1);
  assert.equal(M.fitRate(2, 1, 0), 1);
});

test('fit is kept when valid and reset when not', () => {
  const p = M.normaliseProject({ groups: [{ pads: [{ fit: 2 }, { fit: 3 }, { fit: 'x' }] }] });
  assert.deepEqual(p.groups[0].pads.slice(0, 3).map((x) => x.fit), [2, 0, 0]);
});

test('addAuto snaps to the step, replaces a point and clamps', () => {
  const pat = { bars: 1, ev: [] };
  M.addAuto(pat, 3, 0.5); M.addAuto(pat, 5, 0.7); M.addAuto(pat, 100, 2);
  assert.deepEqual(pat.auto, [{ t: 4, v: 0.7 }, { t: 100, v: 1 }]);
  M.addAuto(pat, 383, 0.2);                       // rounds to 384, wraps to 0
  assert.equal(pat.auto[0].t, 0);
  assert.equal(M.buildAutoIndex(pat).get(100), 1);
  M.clearAuto(pat); assert.equal(pat.auto, undefined);
});

test('automation survives loading and bad points are dropped', () => {
  const p = M.normaliseProject({ groups: [{ patterns: { 1: { bars: 1, ev: [], auto: [{ t: 8, v: 0.4 }, { t: 'x', v: 1 }, { t: 9999, v: 1 }, { t: 2, v: 9 }] } } }] });
  assert.deepEqual(p.groups[0].patterns['1'].auto, [{ t: 2, v: 1 }, { t: 8, v: 0.4 }]);
  assert.equal(M.normaliseProject({ groups: [{ patterns: { 1: { bars: 1, ev: [] } } }] }).groups[0].patterns['1'].auto, undefined);
});

test('beats per bar change the pattern length and drop what no longer fits', () => {
  const pat = { bars: 2, ev: [{ t: 0, p: 0, v: 1, d: 1 }, { t: 500, p: 0, v: 1, d: 1 }, { t: 700, p: 0, v: 1, d: 1 }], auto: [{ t: 100, v: 1 }, { t: 700, v: 1 }] };
  assert.equal(M.patternTicks(pat), 768);
  M.setBeats(pat, 3);
  assert.equal(pat.beats, 3); assert.equal(M.patternTicks(pat), 576); assert.equal(M.barTicks(pat), 288);
  assert.deepEqual(pat.ev.map((e) => e.t), [0, 500]); assert.deepEqual(pat.auto, [{ t: 100, v: 1 }]);
  M.setBeats(pat, 4); assert.equal(pat.beats, undefined);
  M.setBeats(pat, 99); assert.equal(pat.beats, 12);
  M.setBeats(pat, 0); assert.equal(pat.beats, 1);
});

test('beats survive loading, copy and paste', () => {
  const p = M.normaliseProject({ groups: [{ patterns: { 1: { bars: 1, beats: 7, ev: [{ t: 600, p: 1, v: 9, d: 5 }, { t: 700, p: 1 }] }, 2: { bars: 1, beats: 'x', ev: [] } } }] });
  assert.equal(p.groups[0].patterns['1'].beats, 7);
  assert.equal(p.groups[0].patterns['1'].ev.length, 1);        // 700 is past 7 * 96 = 672
  assert.equal(p.groups[0].patterns['2'].beats, undefined);
  const clip = M.copyOf(p.groups[0].patterns['1']), dst = { bars: 3, ev: [] };
  M.pasteInto(dst, clip); assert.equal(dst.beats, 7);
  M.pasteInto(dst, { bars: 1, ev: [] }); assert.equal(dst.beats, undefined);
});

test('ticksToPosition follows the bar length', () => {
  assert.deepEqual(M.ticksToPosition(288, 288), { bar: 2, beat: 1, sixteenth: 1 });
  assert.deepEqual(M.ticksToPosition(384), { bar: 2, beat: 1, sixteenth: 1 });
});

test('normaliseProject drops bad scenes, fx settings and pattern numbers', () => {
  const p = M.normaliseProject({
    scenes: { 1: 5, 2: [1, 2, 3, 4], 3: [1, 'x', 3, 4] }, song: [1, 2, 3],
    fx: { active: 'nope', params: { delay: ['a', 'b'] } }, groups: [{ cur: 'x', mute: 1 }],
  });
  assert.deepEqual(Object.keys(p.scenes), ['2']);
  assert.deepEqual(p.song, [2]);
  assert.equal(p.fx.active, 'none');
  assert.ok(p.fx.params.delay.every(Number.isFinite));
  assert.equal(p.groups[0].cur, 1);
  assert.equal(p.groups[0].mute, true);
});

test('paste, x2, /2 and bars keep fader automation in step', () => {
  const a = { bars: 1, ev: [], auto: [{ t: 10, v: 0.5 }] };
  const b = { bars: 2, ev: [], auto: [{ t: 400, v: 1 }] };
  M.pasteInto(b, M.copyOf(a));
  assert.deepEqual(b.auto, [{ t: 10, v: 0.5 }]);
  M.pasteInto(b, M.copyOf({ bars: 1, ev: [] }));
  assert.equal(b.auto, undefined);
  M.doubleLength(a);
  assert.deepEqual(a.auto.map((x) => x.t), [10, 394]);
  M.halveLength(a);
  assert.deepEqual(a.auto.map((x) => x.t), [10]);
  M.setBars(a, 1); a.auto.push({ t: 5, v: 1 });
  assert.equal(a.auto.length, 2);
});

test('nextEmptyPattern skips the current pattern', () => {
  const p = M.newProject();
  assert.equal(M.nextEmptyPattern(p, 0, 5), 6);
  assert.equal(M.nextEmptyPattern(p, 0, 99), 1);
});

test('loopPosition wraps the counter at the pattern length', () => {
  const bar = 384;
  assert.equal(M.loopPosition(bar * 3 + 96, bar), 96);                 // one bar pattern: always bar 1
  assert.equal(M.ticksToPosition(M.loopPosition(bar * 5, bar), bar).bar, 1);
  assert.equal(M.ticksToPosition(M.loopPosition(bar * 3 + 10, bar * 2), bar).bar, 2); // two bar pattern runs 1 to 2
  assert.equal(M.ticksToPosition(M.loopPosition(bar * 4, bar * 2), bar).bar, 1);
  assert.equal(M.loopPosition(-96, bar), -96);                          // count-in is untouched
});
