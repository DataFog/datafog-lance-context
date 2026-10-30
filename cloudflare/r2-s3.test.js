import {test} from 'node:test';
import assert from 'node:assert/strict';
import {r2S3} from './r2-s3.js';

test('S3 transport preserves conditional commits and missing objects', async () => {
  let received;
  const env = {GENEVA_STORAGE: {
    put: async (key, body, options) => {received = {key, options}; return null;},
    head: async () => null,
  }};
  const response = await r2S3(new Request('http://r2.internal/datafog-lance-geneva-demo/lance/a', {method: 'PUT', body: 'commit', headers: {'If-None-Match': '*'}}), env);
  assert.equal(response.status, 412);
  assert.equal(received.key, 'lance/a');
  assert.equal(received.options.onlyIf.get('If-None-Match'), '*');
  assert.equal((await r2S3(new Request('http://r2.internal/datafog-lance-geneva-demo/missing', {method:'HEAD'}), env)).status, 404);
  assert.equal((await r2S3(new Request('http://r2.internal/another-bucket/a'), env)).status, 404);
});

test('S3 transport returns byte ranges and paginated object listings', async () => {
  const env = {GENEVA_STORAGE: {
    get: async () => ({size: 8, range: {offset: 2, length: 3}, httpEtag: '"abc"', uploaded: new Date(0), body: 'cde'}),
    list: async () => ({truncated: true, cursor: 'next&token', delimitedPrefixes: [], objects: [{key:'a&b', size:8, uploaded:new Date(0), httpEtag:'"abc"'}]}),
  }};
  const response = await r2S3(new Request('http://r2.internal/datafog-lance-geneva-demo/a', {headers:{Range:'bytes=2-4'}}), env);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-4/8');
  assert.equal(await response.text(), 'cde');
  const list = await r2S3(new Request('http://r2.internal/datafog-lance-geneva-demo/?list-type=2'), env);
  assert.match(await list.text(), /a&amp;b.*next&amp;token|next&amp;token.*a&amp;b/);
});

test('multipart copy returns XML and preserves conditional publication', async () => {
  let condition;
  let deleted;
  const upload = {uploadPart: async () => ({etag:'part'}), complete: async () => ({})};
  const env = {GENEVA_STORAGE: {
    resumeMultipartUpload: () => upload,
    get: async () => ({arrayBuffer: async () => new ArrayBuffer(0)}),
    put: async (_, body, options) => {condition = options.onlyIf.get('If-None-Match'); return null;},
    delete: async key => {deleted = key;},
  }};
  const id = btoa(JSON.stringify({key:'__transport_uploads/test',id:'upload'}));
  const url = `http://r2.internal/datafog-lance-geneva-demo/target?uploadId=${encodeURIComponent(id)}`;
  const part = await r2S3(new Request(url + '&partNumber=1', {method:'PUT', headers:{'x-amz-copy-source':'/datafog-lance-geneva-demo/source'}}), env);
  assert.match(await part.text(), /<CopyPartResult>/);
  const complete = await r2S3(new Request(url, {method:'POST', body:'<CompleteMultipartUpload><Part><ETag>"part"</ETag><PartNumber>1</PartNumber></Part></CompleteMultipartUpload>',headers:{'If-None-Match':'*'}}), env);
  assert.equal(complete.status, 412);
  assert.equal(condition, '*');
  assert.equal(deleted, '__transport_uploads/test');
});
