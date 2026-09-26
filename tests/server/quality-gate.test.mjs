import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fixtureDraft, primaryReview } from './helpers.mjs';
import { claimKey } from '../../shared/quality.mjs';

const read = async (f, id) => (await (await f.call(`/jobs/${id}`)).json()).job;
async function drafted(f, draft = fixtureDraft, metadata = { source: 'full-text', reviews: [primaryReview()] }) {
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

  const numbers = await drafted(f, { ...fixtureDraft, post: '約85%在8週內回場' }, { sourceNumbers: ['12', '30'], reviews: [primaryReview()] });
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

test('gate B: rendering waits for every primary finding; the rejection list is frozen with the render', async (t) => {
  const f = await fixture(); t.after(f.close);
  const finding = { severity: 'high', claim: '分母錯誤', reason: '原文 n=40', suggestion: '改為 40', locator: 'p:2', quote: 'n=40 athletes' };
  const job = await drafted(f, fixtureDraft, { reviews: [primaryReview([finding, { ...finding, claim: '誇大療效' }]), { provider: 'grok', status: 'ran', findings: [finding] }] });
  await decide(f, job, fixtureDraft.claims[0], 'locked');
  const blocked = await render(f, await read(f, job.id));
  assert.equal(blocked.status, 409); assert.match((await blocked.json()).error.message, /主審 Codex 還有 2 條/);
  const { runs } = await (await f.call(`/jobs/${job.id}/reviews`)).json();
  const settle = (index, status, reason = '') => f.call(`/jobs/${job.id}/reviews/${runs[0].id}/findings/codex/${index}`, { method: 'PATCH', data: { status, reason } });
  assert.equal((await settle(1, 'rejected')).status, 400, 'a rejection needs a reason');
  await settle(0, 'resolved');
  const settled = await (await settle(1, 'rejected', '原文第 3 頁明寫 improved')).json();
  assert.equal(settled.job.id, job.id, 'the updated job comes back for the gate');
  assert.deepEqual(settled.job.metadata.reviewDispositions['codex:1'], { status: 'rejected', reason: '原文第 3 頁明寫 improved' });
  const current = await read(f, job.id);
  const queued = await render(f, current);
  assert.equal(queued.status, 200, 'the open grok finding does not block');
  const { job: rendering } = await queued.json();
  assert.deepEqual(rendering.metadata.primaryRejections.map(item => [item.index, item.claim, item.rejection]), [[1, '誇大療效', '原文第 3 頁明寫 improved']]);
});

test('a job without a successful primary review cannot render until it is re-reviewed', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f, fixtureDraft, { reviews: [{ provider: 'codex', status: 'failed', error: 'timeout', findings: [] }] });
  await decide(f, job, fixtureDraft.claims[0], 'locked');
  const refused = await render(f, await read(f, job.id), { acceptWarnings: true });
  assert.equal(refused.status, 409); assert.match((await refused.json()).error.message, /重新審核/);
});

test('seat statistics count confirmed and rejected findings and average durations per month', async (t) => {
  const f = await fixture(); t.after(f.close);
  const finding = { severity: 'low', claim: 'c', reason: 'r', suggestion: 's', locator: '', quote: '' };
  const job = await drafted(f, fixtureDraft, { reviews: [primaryReview([finding, finding, finding]), { provider: 'grok', status: 'failed', findings: [], durationSeconds: 600 }] });
  const { runs } = await (await f.call(`/jobs/${job.id}/reviews`)).json();
  const settle = (index, status, reason = '') => f.call(`/jobs/${job.id}/reviews/${runs[0].id}/findings/codex/${index}`, { method: 'PATCH', data: { status, reason } });
  await settle(0, 'resolved'); await settle(1, 'resolved'); await settle(2, 'rejected', '原文有寫');
  const { stats } = await (await f.call('/reviewer-stats')).json();
  const codex = stats.find(item => item.provider === 'codex'), grok = stats.find(item => item.provider === 'grok');
  assert.deepEqual({ runs: codex.runs, ran: codex.ran, findings: codex.findings, resolved: codex.resolved, rejected: codex.rejected, averageSeconds: codex.averageSeconds }, { runs: 1, ran: 1, findings: 3, resolved: 2, rejected: 1, averageSeconds: 300 });
  assert.deepEqual({ ran: grok.ran, averageSeconds: grok.averageSeconds }, { ran: 0, averageSeconds: 600 });
  assert.match(codex.month, /^\d{4}-\d{2}$/);
  assert.equal((await f.call('/reviewer-stats', { role: 'worker' })).status >= 400, true, 'owner only');
});

test('revise accepts primary findings by provider name', async (t) => {
  const f = await fixture(); t.after(f.close);
  const finding = { severity: 'high', claim: '分母錯誤', reason: 'r', suggestion: '改為 40', locator: 'p:2', quote: 'n=40 athletes' };
  const job = await drafted(f, fixtureDraft, { reviews: [primaryReview([finding])] });
  const response = await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: job.revision, findings: [{ provider: 'codex', index: 0 }] } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.metadata.reviseRequest.findings[0].provider, 'codex');
});
