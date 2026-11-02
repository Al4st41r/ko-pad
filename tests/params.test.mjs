import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARAMS, TIMING, cycleParam, stepValue, nextTiming, nextSound, moveStep, stepText } from '../web/js/params.js';

test('the selector cycles through every parameter and wraps', () => {
  let id = PARAMS[0].id; const seen = [id];
  for (let i = 1; i < PARAMS.length; i++) seen.push(id = cycleParam(id));
  assert.deepEqual(seen, PARAMS.map((p) => p.id));
  assert.equal(cycleParam(id), PARAMS[0].id);
  assert.equal(cycleParam(PARAMS[0].id, -1), PARAMS.at(-1).id);
});

test('the pattern number wraps; other values clamp', () => {
  assert.equal(stepValue('pattern', 99, 1), 1);
  assert.equal(stepValue('pattern', 1, -1), 99);
  assert.equal(stepValue('bars', 99, 1), 99);
  assert.equal(stepValue('bars', 1, -1), 1);
  assert.equal(stepValue('bpm', 120, 1), 121);
  assert.equal(stepValue('bpm', 300, 1), 300);
  assert.equal(stepValue('octave', -3, -1), -3);
  assert.equal(stepValue('beats', 12, 1), 12);
});

test('the page has one -/+ pair for pattern, bars, tempo, beats and octave', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const id of ['pmPattern', 'pmSound', 'pmStep', 'pmTiming', 'pmDn', 'pmUp']) assert.ok(html.includes(`id="${id}"`), id);
  for (const id of ['patDn', 'patUp', 'barDn', 'barUp', 'bpmDn', 'bpmUp', 'beatDn', 'beatUp', 'octDn', 'octUp']) {
    assert.ok(!html.includes(`id="${id}"`), `${id} should be gone`);
  }
});

test('TIMING cycles tempo, bars, beats, octave and wraps', () => {
  assert.deepEqual(TIMING, ['interval', 'bpm', 'bars', 'beats', 'octave']);
  assert.equal(nextTiming('bpm'), 'bars');
  assert.equal(nextTiming('octave'), 'interval');
  assert.equal(nextTiming('pattern'), 'interval');
});

test('SOUND steps through the sound list and wraps', () => {
  const ids = [1, 5, 9];
  assert.equal(nextSound(ids, 1, 1), 5);
  assert.equal(nextSound(ids, 9, 1), 1);
  assert.equal(nextSound(ids, 1, -1), 9);
  assert.equal(nextSound(ids, 0, 1), 1, 'an empty pad goes to the first sound');
  assert.equal(nextSound(ids, 0, -1), 9, 'an empty pad goes to the last sound going down');
  assert.equal(nextSound(ids, 7, 1), 1, 'a sound no longer in the list starts again');
  assert.equal(nextSound([], 3, 1), 3);
});

test('STEP cursor wraps inside the pattern and reads as bar.beat.step', () => {
  assert.equal(moveStep(0, -1, 16), 15);
  assert.equal(moveStep(15, 1, 16), 0);
  assert.equal(moveStep(3, 1, 16), 4);
  assert.equal(stepText(0), '1.1.1');
  assert.equal(stepText(5), '1.2.2');
  assert.equal(stepText(16), '2.1.1');
  assert.equal(stepText(15, 3), '2.1.4', '3/4 has 12 steps a bar');
});

test('TIMING interval knob maps across the eight intervals', async () => {
  const { INTERVALS, intervalAt, intervalValue } = await import('../web/js/params.js');
  assert.equal(INTERVALS.length, 8);
  assert.equal(intervalAt(0), '1/1');
  assert.equal(intervalAt(1), '1/32');
  for (const n of INTERVALS) assert.equal(intervalAt(intervalValue(n)), n);
});
