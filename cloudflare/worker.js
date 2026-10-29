import {Container} from '@cloudflare/containers';
import {boundApiRequest} from './request-body.js';

export class LanceDemoContainer extends Container {
  defaultPort = 8080;
  // Runtime uploads stay in the engine; only the separate fixture generator uses AI.
  enableInternet = false;
  // Keep an in-memory source available during a live meeting; idle instances sleep.
  sleepAfter = '20m';
}

const SAMPLE_FILES = new Set([
  '/samples/support-conversations-v1.jsonl',
  '/samples/ground-truth-v1.json',
  '/samples/generation-provenance-v1.json',
]);

export function publicSampleHeaders(pathname, originalHeaders = {}) {
  const headers = new Headers(originalHeaders);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (pathname.endsWith('.jsonl')) {
    headers.set('Content-Type', 'application/x-ndjson; charset=utf-8');
    headers.set('Content-Disposition', 'attachment; filename="support-conversations-v1.jsonl"');
  }
  return headers;
}

function unavailable() {
  return Response.json({error: {code: 'ENGINE_UNAVAILABLE', message: 'The demo engine is starting or temporarily unavailable. Please retry.'}}, {status: 503, headers: {'Cache-Control': 'no-store', 'Retry-After': '5'}});
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/samples/')) {
      if (request.method === 'OPTIONS') return new Response(null, {headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS'}});
      if (!SAMPLE_FILES.has(url.pathname)) return new Response('Sample not found', {status: 404});
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405});
      const response = await env.ASSETS.fetch(request);
      return new Response(response.body, {status: response.status, headers: response.ok ? publicSampleHeaders(url.pathname, response.headers) : response.headers});
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        const bounded = await boundApiRequest(request);
        if (bounded instanceof Response) return bounded;
        const response = await env.DEMO.getByName(env.CONTAINER_REVISION || 'demo-v1').fetch(bounded);
        if (response.status === 503) {
          await response.body?.cancel();
          return unavailable();
        }
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Referrer-Policy', 'no-referrer');
        return new Response(response.body, {status: response.status, headers});
      } catch {
        return unavailable();
      }
    }
    return env.ASSETS.fetch(request);
  }
};
