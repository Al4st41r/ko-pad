import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory IndexedDB stand-in. Writes complete on a later tick, like the real thing.
const rows = new Map();
const later = (fn) => { const r = {}; setTimeout(() => { r.result = fn(); r.onsuccess?.(); }, 5); return r; };
const store = {
  getAll: () => later(() => [...rows.values()]),
  put: (v) => later(() => { rows.set(v.id, v); return v.id; }),
};
globalThis.indexedDB = {
  open() {
    const r = {}; setTimeout(() => { r.result = { transaction: () => ({ objectStore: () => store }) }; r.onsuccess?.(); }, 1); return r;
  },
};
const { userSamples } = await import('../web/js/store.js');

test('concurrent put() calls get different slots', async () => {
  const ids = await Promise.all([userSamples.put('a', new ArrayBuffer(1), 1), userSamples.put('b', new ArrayBuffer(1), 1), userSamples.put('c', new ArrayBuffer(1), 1)]);
  assert.equal(new Set(ids).size, 3);
  assert.equal(rows.size, 3);
});
