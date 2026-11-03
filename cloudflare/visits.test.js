import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CampaignVisits, handleVisits} from './visits.js';

function fixture() {
  const stored = new Map();
  const storage = {get: async key => structuredClone(stored.get(key)), put: async (key, value) => stored.set(key, structuredClone(value))};
  storage.transaction = fn => fn(storage);
  const object = new CampaignVisits({storage});
  const env = {VISITS_READ_TOKEN: 'test-only', CAMPAIGN_VISITS: {getByName: () => object}};
  return {env, stored};
}
const visit = (campaign = 'lancedb-email', event = 'visit', origin = 'https://demo.test') => new Request('https://demo.test/api/visit', {method: 'POST', headers: {Origin: origin, 'Content-Type':'application/json'}, body:JSON.stringify({campaign,event, visitor_ip:'must-not-store'})});

test('campaign totals distinguish visits and engagement, discard extra data, and isolate QA', async () => {
  const {env, stored} = fixture();
  for (const req of [visit(), visit('lancedb-email','engaged'),visit('qa')]) assert.equal((await handleVisits(req,env)).status,204);
  const totals = stored.get('totals');
  assert.equal(totals['lancedb-email'].visit,1);
  assert.equal(totals['lancedb-email'].engaged,1);
  assert.equal(totals.qa.visit,1);
  assert.equal(JSON.stringify(totals).includes('visitor_ip'),false);
});

test('report is private and unknown campaigns and cross-origin events are rejected', async () => {
  const {env,stored} = fixture();
  assert.equal((await handleVisits(new Request('https://demo.test/api/visits'),env)).status,404);
  assert.equal((await handleVisits(visit('arbitrary'),env)).status,400);
  assert.equal((await handleVisits(visit('qa','visit','https://elsewhere.test'),env)).status,404);
  assert.equal(stored.size,0);
  const report = await handleVisits(new Request('https://demo.test/api/visits',{headers:{Authorization:'Bearer test-only'}}),env);
  assert.equal(report.status,200);
  assert.equal(report.headers.get('Cache-Control'),'no-store');
});
