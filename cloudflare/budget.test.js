import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the deployed class with Cloudflare's runtime boundary replaced.
const source = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');
const classSource = source.slice(source.indexOf('export class LanceDemoContainer'), source.indexOf('const SAMPLE_FILES')).replace('export class', 'class');
function engine(expires = Date.now() + 86400000) {
  const stored = new Map();
  const storage = {get: async key => stored.get(key), put: async (key, value) => stored.set(key, value)};
  storage.transaction = callback => callback(storage);
  class Container {
    constructor() { this.ctx = {storage}; this.env = {DEMO_EXPIRES_AT: new Date(expires).toISOString()}; this.starts = 0; }
    async fetch() { this.starts++; return new Response('done'); }
    async schedule(...args) { this.scheduled = args; }
    async destroy() { this.destroyed = true; }
  }
  const Class = vm.runInNewContext(classSource + '\nLanceDemoContainer', {Container, Response, Date, crypto, r2S3: () => {}});
  return new Class();
}

test('expired and exhausted allowances never start additional compute', async () => {
  const expired = engine(Date.now() - 1);
  assert.equal((await expired.fetch(new Request('https://demo/api/enrichment'))).status, 429);
  assert.equal(expired.starts, 0);
  const demo = engine();
  for (let i = 0; i < 40; i++) assert.equal((await demo.fetch(new Request('https://demo/api/enrichment'))).status, 200);
  assert.equal((await demo.fetch(new Request('https://demo/api/enrichment'))).status, 429);
  assert.equal(demo.starts, 40);
});

test('each wake schedules a hard stop and old callbacks cannot stop a new wake', async () => {
  const demo = engine();
  await demo.onStart();
  assert.equal(demo.scheduled[0], 600);
  await demo.stopForBudget('old-wake');
  assert.equal(demo.destroyed, undefined);
  await demo.stopForBudget(demo.scheduled[2]);
  assert.equal(demo.destroyed, true);
});
