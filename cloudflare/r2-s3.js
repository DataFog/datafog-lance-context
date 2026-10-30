// Private S3 transport for Lance's object-store client. Only container outbound
// interception calls this handler; no public Worker route exposes the bucket.
const xml = (value) => String(value).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const unxml = value => value.replace(/&(lt|gt|amp|quot|apos);/g, (_, name) => ({lt:'<', gt:'>', amp:'&', quot:'"', apos:"'"}[name]));
const reply = (body, status = 200) => new Response(body, {status, headers: {'Content-Type': 'application/xml'}});
const missing = () => reply('<Error><Code>NoSuchKey</Code></Error>', 404);

export async function r2S3(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.slice(1).split('/');
  if (parts.shift() !== 'datafog-lance-geneva-demo') return missing();
  const key = decodeURIComponent(parts.join('/'));
  const bucket = env.GENEVA_STORAGE;
  const query = url.searchParams;
  if (request.method === 'POST' && !key && query.has('delete')) {
    const body = await request.text();
    const keys = [...body.matchAll(/<Key>(.*?)<\/Key>/gs)].map(match => unxml(match[1]));
    await bucket.delete(keys);
    return reply(`<DeleteResult>${keys.map(key => `<Deleted><Key>${xml(key)}</Key></Deleted>`).join('')}</DeleteResult>`);
  }
  if (request.method === 'GET' && !key) {
    const result = await bucket.list({prefix: query.get('prefix') || '',
      delimiter: query.get('delimiter') || undefined,
      cursor: query.get('continuation-token') || undefined,
      limit: Math.min(Number(query.get('max-keys')) || 1000, 1000)});
    return reply(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>datafog-lance-geneva-demo</Name><Prefix>${xml(query.get('prefix') || '')}</Prefix><IsTruncated>${result.truncated}</IsTruncated>${result.truncated ? `<NextContinuationToken>${xml(result.cursor)}</NextContinuationToken>` : ''}${result.objects.map(o => `<Contents><Key>${xml(o.key)}</Key><LastModified>${o.uploaded.toISOString()}</LastModified><ETag>${xml(o.httpEtag)}</ETag><Size>${o.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`).join('')}${result.delimitedPrefixes.map(p => `<CommonPrefixes><Prefix>${xml(p)}</Prefix></CommonPrefixes>`).join('')}</ListBucketResult>`);
  }
  if (!key && request.method === 'HEAD') return new Response(null);
  if (request.method === 'HEAD' || request.method === 'GET') {
    const object = request.method === 'HEAD' ? await bucket.head(key) : await bucket.get(key, {range: request.headers});
    if (!object) return missing();
    const headers = new Headers({'ETag': object.httpEtag, 'Last-Modified': object.uploaded.toUTCString(), 'Accept-Ranges': 'bytes'});
    let status = 200;
    if (object.range && object.range.length !== undefined) {
      const offset = object.range.offset ?? (object.size - object.range.suffix);
      headers.set('Content-Range', `bytes ${offset}-${offset + object.range.length - 1}/${object.size}`);
      headers.set('Content-Length', String(object.range.length));
      status = 206;
    } else headers.set('Content-Length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, {status, headers});
  }
  if (request.method === 'POST' && query.has('uploads')) {
    const staging = '__transport_uploads/' + crypto.randomUUID();
    const upload = await bucket.createMultipartUpload(staging);
    const id = btoa(JSON.stringify({key: staging, id: upload.uploadId}));
    return reply(`<InitiateMultipartUploadResult><Bucket>datafog-lance-geneva-demo</Bucket><Key>${xml(key)}</Key><UploadId>${xml(id)}</UploadId></InitiateMultipartUploadResult>`);
  }
  if (query.has('uploadId')) {
    const saved = JSON.parse(atob(query.get('uploadId')));
    const upload = bucket.resumeMultipartUpload(saved.key, saved.id);
    if (request.method === 'PUT') {
      const source = request.headers.get('x-amz-copy-source');
      let body;
      if (source) {
        const sourceKey = decodeURIComponent(source).replace(/^\/?datafog-lance-geneva-demo\//, '');
        const headers = new Headers();
        if (request.headers.has('x-amz-copy-source-range')) headers.set('Range', request.headers.get('x-amz-copy-source-range'));
        const object = await bucket.get(sourceKey, {range: headers});
        if (!object) return missing();
        body = await object.arrayBuffer();
      } else body = await request.arrayBuffer();
      const part = await upload.uploadPart(Number(query.get('partNumber')), body);
      if (source) return reply(`<CopyPartResult><ETag>${xml(`"${part.etag}"`)}</ETag><LastModified>${new Date().toISOString()}</LastModified></CopyPartResult>`);
      return new Response(null, {headers: {'ETag': `"${part.etag}"`}});
    }
    if (request.method === 'POST') {
      const body = await request.text();
      const parts = [...body.matchAll(/<Part>(.*?)<\/Part>/gs)]
        .map(match => ({partNumber: Number(match[1].match(/<PartNumber>(\d+)<\/PartNumber>/)[1]), etag: match[1].match(/<ETag>(.*?)<\/ETag>/s)[1].replace(/&quot;/g, '"').replaceAll('"', '')}));
      await upload.complete(parts);
      try {
        const staged = await bucket.get(saved.key);
        const object = await bucket.put(key, await staged.arrayBuffer(), {onlyIf: request.headers});
        return object ? reply(`<CompleteMultipartUploadResult><Bucket>datafog-lance-geneva-demo</Bucket><Key>${xml(key)}</Key><ETag>${xml(object.httpEtag)}</ETag></CompleteMultipartUploadResult>`) : reply('<Error><Code>PreconditionFailed</Code></Error>', 412);
      } finally { await bucket.delete(saved.key); }
    }
    if (request.method === 'DELETE') { await upload.abort(); return new Response(null, {status: 204}); }
  }
  if (request.method === 'PUT') {
    const source = request.headers.get('x-amz-copy-source');
    if (source) {
      const original = await bucket.get(decodeURIComponent(source).replace(/^\/?datafog-lance-geneva-demo\//, ''));
      if (!original) return missing();
      const object = await bucket.put(key, original.body, {onlyIf: request.headers});
      return object ? reply(`<CopyObjectResult><ETag>${xml(object.httpEtag)}</ETag><LastModified>${object.uploaded.toISOString()}</LastModified></CopyObjectResult>`) : reply('<Error><Code>PreconditionFailed</Code></Error>', 412);
    }
    // Conditional commits must remain conditional when transported to R2.
    const object = await bucket.put(key, await request.arrayBuffer(), {onlyIf: request.headers});
    return object ? new Response(null, {headers: {'ETag': object.httpEtag}}) : reply('<Error><Code>PreconditionFailed</Code></Error>', 412);
  }
  if (request.method === 'DELETE') { await bucket.delete(key); return new Response(null, {status: 204}); }
  return reply('<Error><Code>NotImplemented</Code></Error>', 501);
}
