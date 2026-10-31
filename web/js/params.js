// The single -/+ pair, as on the EP-133: a selector button picks which value the pair changes.
export const PARAMS = [
  { id: 'pattern', label: 'PATTERN', min: 1, max: 99, wrap: true },
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
