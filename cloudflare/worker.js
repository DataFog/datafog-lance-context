import {Container} from '@cloudflare/containers';
export {ContainerProxy} from '@cloudflare/containers';
import {boundApiRequest} from './request-body.js';
import {r2S3} from './r2-s3.js';

export class LanceDemoContainer extends Container {
  defaultPort = 8080;
  enableInternet = false;
  sleepAfter = '3m';
  envVars = {GENEVA_DATABASE_URI: 's3://datafog-lance-geneva-demo/lance', GENEVA_STORAGE_ENDPOINT: 'http://r2.internal', AWS_EC2_METADATA_DISABLED: 'true', RAY_USAGE_STATS_ENABLED: '0', OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1'};
  async startBudgetWindow() {
    const generation = crypto.randomUUID();
    await this.ctx.storage.put('generation', generation);
    // Each accepted request buys at most ten minutes, including startup.
    await this.schedule(600, 'stopForBudget', generation);
  }
  async stopForBudget(generation) {
    if (await this.ctx.storage.get('generation') === generation) await this.destroy();
  }
  async fetch(request) {
    if (this.running) return Response.json({error: {message: 'An ingestion run is active. Retry shortly.'}}, {status: 409});
    this.running = true;
    try {
      const accepted = await this.ctx.storage.transaction(async storage => {
        const runs = (await storage.get('runs')) || 0;
        if (Date.now() >= Date.parse(this.env.DEMO_EXPIRES_AT) || runs >= 40) return false;
        await storage.put('runs', runs + 1);
        return true;
      });
      if (!accepted) return Response.json({error: {message: 'This week’s demo run allowance has ended.'}}, {status: 429});
      await this.startBudgetWindow();
      return await super.fetch(request);
    } finally { this.running = false; }
  }
}
// Use the SDK setter so ContainerProxy's separate isolate registers the handler.
LanceDemoContainer.outboundByHost = {'r2.internal': r2S3};

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
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return Response.json({status: 'ok', execution: 'Self-hosted Geneva on Cloudflare; R2 storage', expires_at: env.DEMO_EXPIRES_AT});
      }
      // Public compute is limited to the fixed synthetic backfill, with no input.
      if (url.pathname !== '/api/enrichment' || request.method !== 'POST') return new Response('Not found', {status: 404});
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
