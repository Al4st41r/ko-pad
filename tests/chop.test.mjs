import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../web/js/chop.js';
import { defaultPad } from '../web/js/model.js';

const SR = 8000;
// Four clicks (decaying bursts) at 0, 0.25, 0.5 and 0.75 of a 2 s sound, silence between.
function clicks(at) {
  const d = new Float32Array(SR * 2);
  for (const frac of at) {
    const s = Math.floor(frac * d.length);
    for (let i = 0; i < 400; i++) d[s + i] = Math.sin(i * 0.9) * Math.exp(-i / 120);
  }
  return d;
}

test('equalBounds splits evenly', () => {
  assert.deepEqual(C.equalBounds(4), [0, 0.25, 0.5, 0.75, 1]);
});

test('transientBounds finds the attacks', () => {
  const b = C.transientBounds(clicks([0.1, 0.35, 0.6, 0.85]), SR, 4);
  assert.equal(b.length, 5);                       // 3 cuts plus both ends
  const cuts = b.slice(1, -1);
  for (const c of cuts) assert.ok([0.1, 0.35, 0.6, 0.85].some((x) => Math.abs(c - x) < 0.02), `cut ${c}`);
});

test('transientBounds returns fewer slices than asked when there are fewer attacks', () => {
  const b = C.transientBounds(clicks([0.1, 0.6]), SR, 8);
  assert.ok(b.length >= 2 && b.length <= 4);
});

test('transientBounds copes with silence, tiny and bad input', () => {
  assert.deepEqual(C.transientBounds(new Float32Array(SR), SR, 8), [0, 1]);
  assert.deepEqual(C.transientBounds(new Float32Array(3), SR, 8), [0, 1]);
  assert.deepEqual(C.transientBounds(clicks([0.1, 0.5]), SR, 1), [0, 1]);
});

test('marksToBounds sorts, de-duplicates and drops marks at the ends', () => {
  assert.deepEqual(C.marksToBounds([0.5, 0.25, 0.2501, 0.9999, 0.0001]), [0, 0.25, 0.5, 1]);
});

test('assignSlices fills pads from the first pad and stops at the last pad', () => {
  const pads = Array.from({ length: 12 }, () => defaultPad());
  const ch = C.assignSlices(pads, 10, 77, C.equalBounds(4));
  assert.deepEqual(ch, [10, 11]);
  assert.equal(pads[10].s, 77); assert.equal(pads[10].start, 0); assert.equal(pads[10].end, 0.25);
  assert.equal(pads[11].start, 0.25); assert.equal(pads[9].s, 0);
});

test('silenceBounds trims quiet ends and keeps padding', () => {
  const a = new Float32Array(1000); a[300] = 0.5; a[600] = -0.4;
  assert.deepEqual(C.silenceBounds([a], 0.01, 0), { start: 300, end: 601 });
  assert.deepEqual(C.silenceBounds([a], 0.01, 10), { start: 290, end: 611 });
  const b = new Float32Array(1000); b[100] = 0.9;
  assert.deepEqual(C.silenceBounds([a, b], 0.01, 0), { start: 100, end: 601 });
  assert.equal(C.silenceBounds([new Float32Array(50)], 0.01), null);
  assert.deepEqual(C.silenceBounds([a], 0.01, 5000), { start: 0, end: 1000 });
});

test('assignSlices resets fit so slices play at their own speed', () => {
  const pads = Array.from({ length: 12 }, () => ({ ...defaultPad(), fit: 2 }));
  C.assignSlices(pads, 0, 5, C.equalBounds(2));
  assert.equal(pads[0].fit, 0);
});
