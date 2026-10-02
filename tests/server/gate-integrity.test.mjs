import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fixtureDraft, primaryReview } from './helpers.mjs';
import { createStore } from '../../server/store.mjs';
import { claimKey } from '../../shared/quality.mjs';

const read = async (f, id) => (await (await f.call(`/jobs/${id}`)).json()).job;
const edit = async (f, job, draft) => (await (await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft } })).json()).job;
const post = (f, job, action, data) => f.call(`/jobs/${job.id}/${action}`, { method: 'POST', ...(data ? { data } : {}) });
const rowOf = (f, id) => f.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();

async function drafted(f, metadata = { source: 'full-text', reviews: [primaryReview()] }) {
  const job = await f.create(); const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken);
  await f.complete(job.id, leaseToken, ['source'], fixtureDraft, metadata);
  return read(f, job.id);
}
async function rendered(f) {
  const job = await drafted(f);
  await f.approve(job.id);
  const queued = (await (await post(f, await read(f, job.id), 'render', { revision: (await read(f, job.id)).revision, design: { imageStyle: 'none' } })).json()).job;
  assert.equal(queued.phase, 'render');
  const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken, 'cover');
  assert.equal((await f.complete(job.id, leaseToken, ['cover'], null, { render: { version: 'v1' } })).status, 200);
  const done = await read(f, job.id);
  assert.equal(done.status, 'completed');
  return done;
}

test('editing a rendered draft then cancel→retry never queues an ungated render', async t => {
  const f = await fixture(); t.after(f.close);
  const done = await rendered(f);
  const edited = await edit(f, done, { ...fixtureDraft, post: '改寫後未重新檢查的結論' });
  assert.equal(edited.status, 'needs_review');
  assert.notEqual(edited.phase, 'render', 'a changed draft leaves the render phase');
  assert.equal((await post(f, edited, 'cancel')).status, 200);
  const retried = (await (await post(f, edited, 'retry')).json()).job;
  assert.equal(retried.status, 'needs_review', 'retry of a cancelled review returns to review, not the queue');
  assert.equal((await f.claim()).job, null, 'nothing reaches the worker without the gate');
  assert.equal(retried.draft.post, '改寫後未重新檢查的結論');
});

test('cancel→retry of an edited research draft keeps the owner edit instead of re-running research', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  const edited = await edit(f, job, { ...fixtureDraft, notes: '醫師手動修改' });
  await post(f, edited, 'cancel');
  const retried = (await (await post(f, edited, 'retry')).json()).job;
  assert.equal(retried.status, 'needs_review');
  assert.equal(retried.draft.notes, '醫師手動修改');
  assert.equal((await f.claim()).job, null);
});

test('a failed render still retries as a render when the draft is unchanged', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  await f.approve(job.id);
  const current = await read(f, job.id);
  await post(f, current, 'render', { revision: current.revision, design: { imageStyle: 'none' } });
  const { leaseToken } = await f.claim();
  await f.call(`/jobs/${job.id}/fail`, { method: 'POST', role: 'worker', data: { leaseToken, code: 'RENDER_FAILED', message: 'boom' } });
  const retried = (await (await post(f, current, 'retry')).json()).job;
  assert.equal(retried.status, 'queued');
  assert.equal(retried.phase, 'render');
});

test('a decision changed between the gate and queueing invalidates the render', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  await f.approve(job.id);
  const store = createStore(f.env.DB);
  const current = await read(f, job.id);
  const passed = await store.gate(job.id, current.revision, false);
  await store.decideClaim(job.id, claimKey(fixtureDraft.claims[0]), 'pending', '');
  await assert.rejects(store.render(job.id, current.revision, { imageStyle: 'none' }, passed), error => error.status === 409);
  assert.equal((await read(f, job.id)).status, 'needs_review');
});

test('a review disposition with no draft snapshot is a conflict, not a server error', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f, { source: 'full-text', reviews: [primaryReview([{ severity: 'high', claim: 'c', reason: 'r', suggestion: '', locator: '', quote: '', sourceVerified: false }])] });
  const runId = (await (await f.call(`/jobs/${job.id}/reviews`)).json()).runs[0].id;
  await f.env.DB.prepare('DELETE FROM draft_versions WHERE job_id=?').bind(job.id).run();
  const response = await f.call(`/jobs/${job.id}/reviews/${runId}/findings/codex/0`, { method: 'PATCH', data: { status: 'resolved' } });
  assert.equal(response.status, 409);
});

test('a disposition that loses the job write race leaves no half-written record', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f, { source: 'full-text', reviews: [primaryReview([{ severity: 'high', claim: 'c', reason: 'r', suggestion: '', locator: '', quote: '', sourceVerified: false }])] });
  const runId = (await (await f.call(`/jobs/${job.id}/reviews`)).json()).runs[0].id;
  // A concurrent writer (another tab) touches the job right after the store reads it.
  let armed = true;
  const racing = { ...f.env.DB, prepare(sql) {
    const statement = f.env.DB.prepare(sql);
    if (!sql.startsWith('SELECT * FROM jobs WHERE id=?')) return statement;
    return { bind: (...args) => { const bound = statement.bind(...args); return { ...bound, async first() {
      const value = await bound.first();
      if (armed) { armed = false; await f.env.DB.prepare('UPDATE jobs SET updated_at=updated_at+1 WHERE id=?').bind(job.id).run(); }
      return value;
    } }; } };
  } };
  await assert.rejects(createStore(racing).disposition(job.id, runId, 'codex', 0, 'resolved', ''), error => error.status === 409);
  const rows = await f.env.DB.prepare('SELECT count(*) AS n FROM review_dispositions WHERE run_id=?').bind(runId).first();
  assert.equal(rows.n, 0);
});

test('resolving every remaining finding writes all of them in one step', async t => {
  const f = await fixture(); t.after(f.close);
  const finding = { severity: 'high', claim: 'c', reason: 'r', suggestion: '', locator: '', quote: '', sourceVerified: false };
  const job = await drafted(f, { source: 'full-text', reviews: [primaryReview([finding, finding, finding])] });
  const runId = (await (await f.call(`/jobs/${job.id}/reviews`)).json()).runs[0].id;
  const result = await (await f.call(`/jobs/${job.id}/reviews/${runId}/findings/codex/resolve-remaining`, { method: 'POST', data: {} })).json();
  assert.deepEqual(Object.keys(result.job.metadata.reviewDispositions).sort(), ['codex:0', 'codex:1', 'codex:2']);
  assert.equal(result.runs[0].dispositions.length, 3);
});

test('a completed re-review clears the review request flag', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  await post(f, job, 'review', { revision: job.revision });
  const { leaseToken } = await f.claim({ reviewDraft: true });
  await f.upload(job.id, leaseToken, 'reviews');
  assert.equal((await f.complete(job.id, leaseToken, ['reviews'], null, { reviews: [primaryReview()] })).status, 200);
  assert.equal((await rowOf(f, job.id)).review_requested, 0);
  assert.equal((await read(f, job.id)).phase, 'research');
});

test('worker results cannot write owner decisions or private source metadata', async t => {
  const f = await fixture(); t.after(f.close);
  const forged = { decisions: { [claimKey(fixtureDraft.claims[0])]: { status: 'locked', decidedAt: '2026-01-01T00:00:00.000Z' } } };
  const job = await drafted(f, { source: 'full-text', reviews: [primaryReview()], paper: { title: 'Paper' },
    claimReview: forged, gateAcceptance: { codes: ['NUMBER_NOT_IN_SOURCE'] }, primaryRejections: [{ claim: 'x' }], manualSource: { key: 'jobs/other/manual/x' } });
  const metadata = JSON.parse((await rowOf(f, job.id)).metadata);
  assert.equal(metadata.claimReview, undefined);
  assert.equal(metadata.gateAcceptance, undefined);
  assert.equal(metadata.primaryRejections, undefined);
  assert.equal(metadata.manualSource, undefined);
  assert.equal(metadata.paper.title, 'Paper', 'research results are still recorded');
});

test('an old cancellation does not turn a later failed run into a review', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  await post(f, job, 'cancel');
  const cancelled = await read(f, job.id);
  await post(f, cancelled, 'restart', { revision: cancelled.revision });
  const { leaseToken } = await f.claim();
  await f.call(`/jobs/${job.id}/fail`, { method: 'POST', role: 'worker', data: { leaseToken, code: 'SOURCE_FAILED', message: 'boom' } });
  const retried = (await (await post(f, cancelled, 'retry')).json()).job;
  assert.equal(retried.status, 'queued');
  assert.equal(retried.phase, 'research');
});
