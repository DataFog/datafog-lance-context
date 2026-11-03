const campaigns = new Set(['lancedb-email', 'qa']);
const events = new Set(['visit', 'engaged']);

// Stores campaign totals only, without visitor identifiers or request headers.
export class CampaignVisits {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    if (request.method === 'GET') return Response.json((await this.ctx.storage.get('totals')) || {});
    const {campaign, event} = await request.json();
    if (!campaigns.has(campaign) || !events.has(event)) return new Response('Invalid event', {status: 400});
    await this.ctx.storage.transaction(async storage => {
      const totals = (await storage.get('totals')) || {};
      const entry = totals[campaign] || {visit: 0, engaged: 0};
      entry[event]++;
      entry[`last_${event}_at`] = new Date().toISOString();
      totals[campaign] = entry;
      await storage.put('totals', totals);
    });
    return new Response(null, {status: 204});
  }
}

export async function handleVisits(request, env) {
  const url = new URL(request.url);
  const headers = {'Cache-Control': 'no-store'};
  if (url.pathname === '/api/visits') {
    if (request.method !== 'GET' || !env.VISITS_READ_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.VISITS_READ_TOKEN}`) return new Response('Not found', {status: 404, headers});
    const response = await env.CAMPAIGN_VISITS.getByName('campaigns').fetch(new Request('https://visits.internal/'));
    return new Response(response.body, {headers: {...headers, 'Content-Type': 'application/json'}});
  }
  if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return new Response('Not found', {status: 404, headers});
  let event;
  try { event = await request.json(); } catch { return new Response('Invalid event', {status: 400, headers}); }
  if (!campaigns.has(event?.campaign) || !events.has(event?.event)) return new Response('Invalid event', {status: 400, headers});
  await env.CAMPAIGN_VISITS.getByName('campaigns').fetch(new Request('https://visits.internal/', {method: 'POST', body: JSON.stringify({campaign: event.campaign, event: event.event})}));
  return new Response(null, {status: 204, headers});
}
