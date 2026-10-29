import test from 'node:test';
import assert from 'node:assert/strict';
import {boundApiRequest, MAX_JSON_REQUEST_BYTES} from './request-body.js';

test('declared oversized uploads are rejected before consuming their body', async () => {
  let pulled = false;
  const body = new ReadableStream({pull() {pulled = true;}}, {highWaterMark: 0});
  const request = new Request('https://demo.test/api/datasets', {method: 'POST', body, duplex: 'half', headers: {'Content-Length': String(MAX_JSON_REQUEST_BYTES + 1)}});
  const response = await boundApiRequest(request);
  assert.equal(response.status, 413);
  assert.equal(pulled, false);
});

test('actual streaming length is enforced even when length header is absent', async () => {
  let index = 0;
  const body = new ReadableStream({pull(controller) {controller.enqueue(new Uint8Array(1024 * 1024)); if (++index === 5) controller.close();}});
  const response = await boundApiRequest(new Request('https://demo.test/api/datasets', {method: 'POST', body, duplex: 'half'}));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'UPLOAD_TOO_LARGE');
});

test('accepted JSON is forwarded without changing its bytes', async () => {
  const body = JSON.stringify({content: 'café 🧪\\n', filename: 'support.jsonl'});
  const request = await boundApiRequest(new Request('https://demo.test/api/datasets', {method: 'POST', body, headers: {'Content-Type': 'application/json'}}));
  assert.equal(await request.text(), body);
  assert.equal(request.headers.get('Content-Type'), 'application/json');
});

test('download GET requests pass through without a body buffer', async () => {
  const request = new Request('https://demo.test/api/runs/id/bundle');
  assert.equal(await boundApiRequest(request), request);
});
