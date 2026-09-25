import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fixtureDraft } from './helpers.mjs';
import { claimKey } from '../../shared/quality.mjs';

const read = async (f, id) => (await (await f.call(`/jobs/${id}`)).json()).job;
async function drafted(f, draft = fixtureDraft, metadata = { source: 'full-text' }) {
  const job = await f.create(); const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken);
  await f.call(`/jobs/${job.id}/complete`, { method: 'POST', role: 'worker', data: { leaseToken, artifacts: ['source'], draft, metadata } });
  return read(f, job.id);
}
const decide = (f, job, claim, status, note) => f.call(`/jobs/${job.id}/claims`, { method: 'PATCH', data: { key: claimKey(claim), status, ...(note ? { note } : {}) } });
const render = (f, job, extra = {}) => f.call(`/jobs/${job.id}/render`, { method: 'POST', data: { revision: job.revision, design: { imageStyle: 'none' }, ...extra } });

test('rendering is refused until every claim is locked or rejected (gate A)', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  const refused = await render(f, job);
  assert.equal(refused.status, 409);
  const body = await refused.json();
  assert.equal(body.error.code, 'QUALITY_GATE'); assert.match(body.error.message, /主張/);
  const locked = await decide(f, job, fixtureDraft.claims[0], 'locked');
  assert.equal(locked.status, 200);
  const { job: after } = await locked.json();
  assert.equal(after.revision, job.revision, 'a claim decision does not invalidate unsaved editor revisions');
  assert.equal(after.metadata.claimReview.decisions[claimKey(fixtureDraft.claims[0])].status, 'locked');
  assert.equal((await render(f, after)).status, 200);
});

test('claim decisions validate the key, status and job state, and can be undone', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  assert.equal((await f.call(`/jobs/${job.id}/claims`, { method: 'PATCH', data: { key: 'ffffffffffffffff', status: 'locked' } })).status, 404);
  assert.equal((await decide(f, job, fixtureDraft.claims[0], 'approved')).status, 400);
  assert.equal((await decide(f, job, fixtureDraft.claims[0], 'rejected', '原文未支持'.repeat(200))).status, 400);
  const rejected = await (await decide(f, job, fixtureDraft.claims[0], 'rejected', '原文未支持')).json();
  assert.equal(rejected.job.metadata.claimReview.decisions[claimKey(fixtureDraft.claims[0])].note, '原文未支持');
  const refused = await (await render(f, rejected.job)).json();
  assert.match(refused.error.message, /駁回/);
  const undone = await (await decide(f, job, fixtureDraft.claims[0], 'pending')).json();
  assert.equal(undone.job.metadata.claimReview.decisions[claimKey(fixtureDraft.claims[0])], undefined);
  const queued = await f.create();
  assert.equal((await f.call(`/jobs/${queued.id}/claims`, { method: 'PATCH', data: { key: claimKey(fixtureDraft.claims[0]), status: 'locked' } })).status, 409, 'no draft yet');
});

test('hard errors such as simplified characters block; source-number mismatches need explicit acceptance', async (t) => {
  const f = await fixture(); t.after(f.close);
  const simplified = await drafted(f, { ...fixtureDraft, post: '不能据此判定' });
  await decide(f, simplified, fixtureDraft.claims[0], 'locked');
  const blocked = await render(f, await read(f, simplified.id), { acceptWarnings: true });
  assert.equal(blocked.status, 409); assert.match((await blocked.json()).error.message, /簡體字/);

  const numbers = await drafted(f, { ...fixtureDraft, post: '約85%在8週內回場' }, { sourceNumbers: ['12', '30'] });
  await decide(f, numbers, fixtureDraft.claims[0], 'locked');
  const current = await read(f, numbers.id);
  const needsAck = await render(f, current);
  assert.equal(needsAck.status, 409); assert.match((await needsAck.json()).error.message, /85%/);
  const accepted = await render(f, current, { acceptWarnings: true });
  assert.equal(accepted.status, 200);
  const queued = (await accepted.json()).job;
  assert.deepEqual(queued.metadata.gateAcceptance.codes, ['NUMBER_NOT_IN_SOURCE']);
});

test('a revise request copies the chosen verified findings and requeues research without touching the draft', async (t) => {
  const f = await fixture(); t.after(f.close);
  const reviews = [{ provider: 'claude', status: 'ran', findings: [
    { severity: 'medium', claim: '標題過度推論', reason: '原文說資料有限', suggestion: '改寫標題', locator: 'p:1', quote: 'limited data', sourceVerified: true },
    { severity: 'low', claim: '簡體字', reason: '据', suggestion: '改為據', locator: '', quote: '', sourceVerified: false },
  ] }];
  const job = await drafted(f, fixtureDraft, { reviews });
  await decide(f, job, fixtureDraft.claims[0], 'locked');
  const current = await read(f, job.id);
  assert.equal((await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: current.revision, findings: [{ provider: 'claude', index: 9 }] } })).status, 400);
  const response = await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: current.revision, findings: [{ provider: 'claude', index: 0 }, { provider: 'claude', index: 1 }], instructions: '語氣更口語' } });
  assert.equal(response.status, 200);
  const { job: queued } = await response.json();
  assert.equal(queued.status, 'queued'); assert.equal(queued.phase, 'research');
  assert.deepEqual(queued.draft, fixtureDraft);
  const request = queued.metadata.reviseRequest;
  assert.match(request.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(request.findings.map(x => x.claim), ['標題過度推論', '簡體字']);
  assert.equal(request.instructions, '語氣更口語');
  assert.deepEqual(request.lockedClaims, fixtureDraft.claims);
  assert.ok(Array.isArray(request.gateIssues));
  const { job: claimed } = await f.claim();
  assert.equal(claimed.metadata.reviseRequest.id, request.id);
});

test('revise needs a draft, a matching revision and something to do', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  assert.equal((await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: job.revision - 1, findings: [], instructions: '改短' } })).status, 409);
  assert.equal((await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: job.revision, findings: [] } })).status, 400);
  assert.equal((await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: job.revision, findings: [], instructions: 'x'.repeat(1001) } })).status, 400);
  assert.equal((await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: job.revision, findings: [], instructions: '改短一點' } })).status, 200);
});
