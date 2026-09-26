import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, primaryReview } from './helpers.mjs';

const read = async (f, id) => (await (await f.call(`/jobs/${id}`)).json()).job;
const finding = { severity: 'high', claim: 'Check the conclusion', reason: 'Missing qualifier', suggestion: 'Keep the qualifier', locator: '', quote: '' };
const render = (f, job) => f.call(`/jobs/${job.id}/render`, { method: 'POST', data: { revision: job.revision, design: { imageStyle: 'none', palette: 'emerald', format: 'square' }, acceptWarnings: true } });

async function ready(f, reviews = [primaryReview()]) {
  const job = await f.create(), claim = await f.claim();
  await f.upload(job.id, claim.leaseToken);
  await f.complete(job.id, claim.leaseToken, undefined, undefined, { reviews });
  await f.approve(job.id);
  return read(f, job.id);
}
async function edit(f, job) {
  const response = await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: { ...job.draft, post: 'An edited conclusion awaiting review' } } });
  assert.equal(response.status, 200);
  return (await response.json()).job;
}
async function blocked(f, job) {
  const response = await render(f, job);
  assert.equal(response.status, 409, 'accepting warnings cannot bypass an outdated review');
  const body = await response.json();
  assert.equal(body.error.code, 'QUALITY_GATE');
  assert.match(body.error.message, /重新審核目前版本/);
  assert.equal((await read(f, job.id)).status, 'needs_review');
  assert.equal((await f.claim()).job, null, 'no render work is queued');
}

test('editing requires a new review even after all old findings are resolved in bulk', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f, [primaryReview([finding])]);
  const edited = await edit(f, job);
  assert.notEqual(edited.draftRevision, edited.metadata.reviewsDraftRevision);
  const response = await f.call(`/jobs/${job.id}/reviews/${job.metadata.reviewRunId}/findings/codex/resolve-remaining`, { method: 'POST' });
  assert.equal(response.status, 200);
  await blocked(f, await read(f, job.id));
});

test('unknown review versions and mismatched versions block even without the stale flag', async t => {
  for (const metadataPatch of [{ reviewsDraftRevision: null }, { reviewsDraftRevision: undefined }, { reviewsDraftRevision: 999 }, { reviewsStale: true }]) {
    const f = await fixture(); t.after(f.close);
    const job = await ready(f);
    await f.env.DB.prepare('UPDATE jobs SET metadata=? WHERE id=?').bind(JSON.stringify({ ...job.metadata, ...metadataPatch }), job.id).run();
    await blocked(f, await read(f, job.id));
  }
});

test('model revision completion keeps the old review stale and cannot render', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  assert.equal((await f.call(`/jobs/${job.id}/revise`, { method: 'POST', data: { revision: job.revision, findings: [], instructions: 'Clarify the conclusion' } })).status, 200);
  const claim = await f.claim();
  await f.upload(job.id, claim.leaseToken, 'revision');
  const response = await f.complete(job.id, claim.leaseToken, ['revision'], { ...job.draft, post: 'A model revision awaiting review' }, { reviseRequest: null });
  assert.equal(response.status, 200);
  await blocked(f, (await response.json()).job);
});

test('restoring previously reviewed text creates a new draft that must be reviewed', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f), edited = await edit(f, job);
  const response = await f.call(`/jobs/${job.id}/restore`, { method: 'POST', data: { revision: edited.revision, version: job.draftRevision } });
  assert.equal(response.status, 200);
  const restored = (await response.json()).job;
  assert.deepEqual(restored.draft, job.draft);
  assert.notEqual(restored.draftRevision, job.draftRevision);
  await blocked(f, restored);
});

test('a successful current-version review still needs its new findings settled before rendering', async t => {
  const f = await fixture(); t.after(f.close);
  const edited = await edit(f, await ready(f));
  assert.equal((await f.call(`/jobs/${edited.id}/review`, { method: 'POST', data: { revision: edited.revision } })).status, 200);
  const claim = await f.claim({ reviewDraft: true });
  await f.upload(edited.id, claim.leaseToken, 'review');
  const response = await f.complete(edited.id, claim.leaseToken, ['review'], null, { reviews: [primaryReview([finding])] });
  assert.equal(response.status, 200);
  const reviewed = (await response.json()).job;
  assert.equal(reviewed.metadata.reviewsDraftRevision, edited.draftRevision);
  assert.equal(reviewed.metadata.reviewsStale, false);
  assert.notEqual(reviewed.revision, reviewed.draftRevision, 'job revisions must not be mistaken for draft versions');
  const unresolved = await render(f, reviewed);
  assert.equal(unresolved.status, 409);
  assert.match((await unresolved.json()).error.message, /意見未處理/);
  await f.call(`/jobs/${edited.id}/reviews/${reviewed.metadata.reviewRunId}/findings/codex/0`, { method: 'PATCH', data: { status: 'rejected', reason: 'The qualifier is already present in the reviewed version.' } });
  assert.equal((await render(f, await read(f, edited.id))).status, 200);
});

test('unchanged saves and reconciliation checkpoints preserve review validity for design changes', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  for (const checkpoint of [false, true]) {
    const response = await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: job.draft, checkpoint } });
    assert.equal(response.status, 200);
    const saved = (await response.json()).job;
    assert.equal(saved.draftRevision, job.draftRevision);
    assert.equal(saved.metadata.reviewsStale, false);
  }
  const response = await render(f, await read(f, job.id));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).job.design.palette, 'emerald');
});
