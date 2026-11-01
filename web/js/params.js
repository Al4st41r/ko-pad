// The single -/+ pair, as on the EP-133: a selector button picks which value the pair changes.
export const PARAMS = [
  { id: 'pattern', label: 'PATTERN', min: 1, max: 99, wrap: true },
  { id: 'sound', label: 'SOUND', min: 1, max: 999, wrap: true },
  { id: 'step', label: 'STEP', min: 1, max: 9999, wrap: true },
  { id: 'bars', label: 'BARS', min: 1, max: 99 },
  { id: 'bpm', label: 'BPM', min: 40, max: 300 },
  { id: 'beats', label: 'BEATS /4', min: 1, max: 12 },
  { id: 'octave', label: 'OCTAVE', min: -3, max: 3 },
];

// Next (dir 1) or previous (dir -1) parameter id, wrapping at the ends.
export function cycleParam(id, dir = 1) {
  const i = PARAMS.findIndex((p) => p.id === id);
  return PARAMS[(Math.max(0, i) + dir + PARAMS.length) % PARAMS.length].id;
}

// New value after a step; wraps for the pattern number, clamps for everything else.
export function stepValue(id, value, dir) {
  const p = PARAMS.find((q) => q.id === id);
  if (!p) return value;
  const v = value + dir;
  if (v > p.max) return p.wrap ? p.min : p.max;
  if (v < p.min) return p.wrap ? p.max : p.min;
  return v;
}

// The TIMING button on the device cycles through the timing values.
export const TIMING = ['bpm', 'bars', 'beats', 'octave'];
export const nextTiming = (id) => TIMING[(TIMING.indexOf(id) + 1) % TIMING.length];

// The sound after (dir 1) or before (dir -1) the current one in a list of sound numbers, wrapping.
// An empty pad (or a sound no longer in the list) starts at the first sound going up, the last going down.
export function nextSound(ids, current, dir) {
  if (!ids.length) return current;
  const i = ids.indexOf(current);
  if (i < 0) return dir > 0 ? ids[0] : ids[ids.length - 1];
  return ids[(i + dir + ids.length) % ids.length];
}

// The step cursor: a 0-based sixteenth-note position, wrapping inside the pattern.
export const moveStep = (cur, dir, total) => ((cur + dir) % total + total) % total;

// "bar.beat.step", the same form as the LCD position.
export function stepText(cur, beats = 4) {
  const perBar = beats * 4;
  return `${Math.floor(cur / perBar) + 1}.${Math.floor((cur % perBar) / 4) + 1}.${(cur % 4) + 1}`;
}
