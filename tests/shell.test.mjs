import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../web/', import.meta.url);

test('the service worker caches every script, so the app works offline', () => {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const f of readdirSync(new URL('js/', root)).filter((n) => n.endsWith('.js'))) {
    assert.ok(assets.includes(`js/${f}`), `js/${f} is missing from ASSETS in sw.js`);
  }
});

test('every cached asset exists', () => {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((a) => a !== './');
  for (const a of assets) assert.doesNotThrow(() => readFileSync(new URL(a, root)), a);
});
