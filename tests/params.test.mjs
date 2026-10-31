import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PARAMS, cycleParam, stepValue } from '../web/js/params.js';

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
  for (const id of ['pmSel', 'pmDn', 'pmUp']) assert.ok(html.includes(`id="${id}"`), id);
  for (const id of ['patDn', 'patUp', 'barDn', 'barUp', 'bpmDn', 'bpmUp', 'beatDn', 'beatUp', 'octDn', 'octUp']) {
    assert.ok(!html.includes(`id="${id}"`), `${id} should be gone`);
  }
});
