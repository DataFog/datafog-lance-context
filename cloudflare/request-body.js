// A valid 2 MiB JSONL file can double when wrapped in a JSON string. The extra
// KiB covers the filename and envelope fields sent by the browser uploader.
export const MAX_JSON_REQUEST_BYTES = 2 * 2 * 1024 * 1024 + 1024;

function tooLarge() {
  return Response.json({error: {code: 'UPLOAD_TOO_LARGE', message: 'The upload is larger than this demo supports. Use a JSONL file up to 2 MiB.'}}, {status: 413, headers: {'Cache-Control': 'no-store'}});
}

export async function boundApiRequest(request) {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method) || !request.body) return request;
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_JSON_REQUEST_BYTES) return tooLarge();
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_REQUEST_BYTES) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete('Content-Length');
  return new Request(request, {headers, body});
}
