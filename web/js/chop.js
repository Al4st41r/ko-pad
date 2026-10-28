// Sample chopping. Pure functions: they take plain arrays so they can be tested under Node.
const MIN_SLICE = 0.005;          // smallest slice, as a fraction of the sample

// Boundaries for n equal slices: [0, 1/n, ..., 1].
export function equalBounds(n) {
  return Array.from({ length: n + 1 }, (_, i) => i / n);
}

// Find up to n-1 onsets and return boundaries [0, ...onsets, 1]. Fewer are returned when the sound
// does not have enough clear attacks. `data` is one channel of samples in -1..1.
export function transientBounds(data, sampleRate, n) {
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  const frames = Math.floor(data.length / hop);
  if (frames < 4 || n < 2) return [0, 1];
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * hop, e = i + hop; i < e; i++) s += data[i] * data[i];
    energy[f] = Math.log10(1e-6 + s / hop);
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1]);

  const minGap = Math.max(2, Math.round(0.05 * sampleRate / hop));    // 50 ms apart at least
  const peaks = [];
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f] > 0.15 && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1]) peaks.push(f);
  }
  peaks.sort((a, b) => flux[b] - flux[a]);
  const chosen = [];
  for (const f of peaks) {
    if (chosen.length >= n - 1) break;
    if (f / frames < MIN_SLICE * 2) continue;
    if (chosen.every((c) => Math.abs(c - f) >= minGap)) chosen.push(f);
  }
  chosen.sort((a, b) => a - b);
  // Move each cut a little before the attack so the hit is not clipped.
  return [0, ...chosen.map((f) => Math.max(0, (f - 1) / frames)), 1];
}

// Turn marks (fractions 0..1, any order) into boundaries, dropping marks too close together.
export function marksToBounds(marks) {
  const out = [0];
  for (const m of [...marks].sort((a, b) => a - b)) {
    if (m - out[out.length - 1] >= MIN_SLICE && 1 - m >= MIN_SLICE) out.push(m);
  }
  out.push(1);
  return out;
}

// Assign slices to pads in order starting at `first`. Returns the list of pad indexes changed.
// Pads are given as the group's pad objects; each gets the sample and a start/end pair.
export function assignSlices(pads, first, sampleId, bounds) {
  const slices = bounds.length - 1;
  const changed = [];
  for (let i = 0; i < slices && first + i < pads.length; i++) {
    Object.assign(pads[first + i], { s: sampleId, start: bounds[i], end: bounds[i + 1], mode: 'oneshot', pitch: 0, fit: 0 });
    changed.push(first + i);
  }
  return changed;
}

// First and last frame whose level is above `threshold` (0..1) in any channel, widened by `pad` frames.
// Returns null when the whole sound is quieter than the threshold.
export function silenceBounds(channels, threshold = 0.01, pad = 0) {
  const n = Math.min(...channels.map((c) => c.length));
  let a = -1, b = -1;
  for (let i = 0; i < n && a < 0; i++) for (const c of channels) if (Math.abs(c[i]) > threshold) { a = i; break; }
  if (a < 0) return null;
  for (let i = n - 1; i >= a && b < 0; i--) for (const c of channels) if (Math.abs(c[i]) > threshold) { b = i; break; }
  return { start: Math.max(0, a - pad), end: Math.min(n, b + 1 + pad) };
}
