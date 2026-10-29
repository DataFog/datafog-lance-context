const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function json(value, status = 200) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'}});
    }
    if (url.pathname.startsWith('/samples/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return json({error: 'Method not allowed'}, 405);
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('X-Content-Type-Options', 'nosniff');
      if (response.ok) {
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        if (url.pathname.endsWith('.jsonl')) {
          headers.set('Content-Type', 'application/x-ndjson; charset=utf-8');
          headers.set('Content-Disposition', 'attachment; filename="' + url.pathname.split('/').pop() + '"');
        }
      }
      return new Response(response.body, {status: response.status, headers});
    }
    if (url.pathname === '/admin/generate' && request.method === 'POST') {
      if (!env.GENERATOR_TOKEN || request.headers.get('Authorization') !== 'Bearer ' + env.GENERATOR_TOKEN) {
        return json({error: 'Unauthorized'}, 401);
      }
      let body;
      try { body = await request.json(); } catch { return json({error: 'Invalid JSON'}, 400); }
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) return json({error: 'A prompt is required'}, 422);
      try {
        const result = await env.AI.run(MODEL, {
          messages: [
            {role: 'system', content: 'You write fictional customer-support dialogue for software tests. Return the requested JSON only. Use supplied placeholders for all personal details. Never invent names, email addresses, phone numbers or identity numbers.'},
            {role: 'user', content: body.prompt},
          ],
          max_tokens: 5000,
          temperature: 0.65,
          response_format: {type: 'json_object'},
        });
        return json({model: MODEL, generated_at: new Date().toISOString(), result});
      } catch {
        return json({error: 'Workers AI generation failed'}, 502);
      }
    }
    if (request.method === 'GET' && url.pathname === '/') {
      return json({service: 'DataFog Lance synthetic fixtures', dataset: '/samples/support-conversations-v1.jsonl', provenance: '/samples/generation-provenance-v1.json', synthetic: true, generation: 'Authenticated operator only; downloads do not invoke a model.'});
    }
    return json({error: 'Not found'}, 404);
  }
};
