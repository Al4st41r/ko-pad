// Persistence: projects and settings in localStorage, user samples in IndexedDB.
import { USER_SAMPLE_MIN, USER_SAMPLE_MAX } from './data.js';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export const storage = {
  get(key, fallback = null) {
    return safe(() => { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }, fallback);
  },
  set(key, value) { return safe(() => { localStorage.setItem(key, JSON.stringify(value)); return true; }, false); },
  remove(key) { safe(() => localStorage.removeItem(key)); },
};

// User samples (recordings and imports). Each record: { id, name, data:ArrayBuffer, dur }.
class UserSamples {
  constructor() { this.db = null; this.meta = new Map(); }

  async open() {
    if (this.db) return;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('ko-samples', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('s', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = await this._all();
    this.meta = new Map(all.map((s) => [s.id, { id: s.id, name: s.name, dur: s.dur }]));
  }

  _tx(mode) { return this.db.transaction('s', mode).objectStore('s'); }
  _req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  _all() { return this._req(this._tx('readonly').getAll()); }

  async get(id) { await this.open(); return this._req(this._tx('readonly').get(id)); }

  list() { return [...this.meta.values()].sort((a, b) => a.id - b.id); }

  nextFreeId() {
    for (let i = USER_SAMPLE_MIN; i <= USER_SAMPLE_MAX; i++) if (!this.meta.has(i)) return i;
    return null;
  }

  async put(name, data, dur) {
    await this.open();
    const id = this.nextFreeId();
    if (id === null) throw new Error('All 400 user sample slots are in use');
    await this._req(this._tx('readwrite').put({ id, name, data, dur }));
    this.meta.set(id, { id, name, dur });
    return id;
  }

  async clear() {
    await this.open();
    await this._req(this._tx('readwrite').clear());
    this.meta.clear();
  }

  async remove(id) {
    await this.open();
    await this._req(this._tx('readwrite').delete(id));
    this.meta.delete(id);
  }
}

export const userSamples = new UserSamples();
