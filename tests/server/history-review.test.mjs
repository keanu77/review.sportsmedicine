import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fixtureDraft } from './helpers.mjs';

async function ready(f) {
  const job = await f.create(), claim = await f.claim();
  await f.upload(job.id, claim.leaseToken);
  return (await (await f.complete(job.id, claim.leaseToken)).json()).job;
}

test('draft snapshots survive edits; stale edits add no versions and restoring creates a new snapshot', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  const history = await f.call(`/jobs/${job.id}/versions`);
  assert.equal(history.status, 200);
  const original = (await history.json()).versions[0];
  assert.equal(original.revision, job.revision);
  const edited = (await (await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: { ...fixtureDraft, post: 'Changed conclusion' } } })).json()).job;
  assert.equal((await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: fixtureDraft } })).status, 409);
  assert.equal((await (await f.call(`/jobs/${job.id}/versions`)).json()).versions.length, 2);
  const restored = await f.call(`/jobs/${job.id}/restore`, { method: 'POST', data: { revision: edited.revision, version: original.revision } });
  assert.equal(restored.status, 200);
  const result = (await restored.json()).job;
  assert.equal(result.draft.post, fixtureDraft.post);
  assert.equal(result.draftRevision, result.revision);
  const versions = (await (await f.call(`/jobs/${job.id}/versions`)).json()).versions;
  assert.equal(versions.length, 3);
  assert.equal(versions[0].restoredFrom, original.revision);
  assert.equal((await (await f.call(`/jobs/${job.id}/versions/${edited.draftRevision}`)).json()).version.draft.post, 'Changed conclusion');
  assert.equal((await f.call(`/jobs/${job.id}/versions`, { role: 'anonymous' })).status, 401);
  const other = await f.create();
  assert.equal((await f.call(`/jobs/${other.id}/versions/${original.revision}`)).status, 404);
});

test('same draft autosave is idempotent and does not invalidate a completed job', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  const result = await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: job.draft } });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).job.revision, job.revision);
});

test('explicit re-review pins a draft, excludes legacy workers, preserves it and archives the run', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  const queuedResponse = await f.call(`/jobs/${job.id}/review`, { method: 'POST', data: { revision: job.revision } });
  assert.equal(queuedResponse.status, 200);
  const queued = (await queuedResponse.json()).job;
  assert.equal(queued.phase, 'review');
  assert.equal(queued.draftRevision, job.revision);
  assert.equal((await f.claim()).job, null, 'old workers never receive an unsupported operation');
  const claim = await f.claim({ reviewDraft: true });
  assert.equal(claim.job.phase, 'review');
  assert.equal((await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: queued.revision, draft: fixtureDraft } })).status, 409);
  await f.upload(job.id, claim.leaseToken, 'new-reviews');
  assert.equal((await f.complete(job.id, claim.leaseToken, ['new-reviews'])).status, 400, 'review cannot replace draft');
  const reviews = [{ provider: 'claude', status: 'ran', summary: 'Checked current text', findings: [{ severity: 'medium', claim: 'Claim', reason: 'Needs qualification', suggestion: '', locator: '', quote: '', sourceVerified: false }] }];
  const completion = await f.call(`/jobs/${job.id}/complete`, { role: 'worker', method: 'POST', data: { leaseToken: claim.leaseToken, artifacts: ['new-reviews'], metadata: { reviews, paper: { title: 'must not overwrite source' } } } });
  assert.equal(completion.status, 200);
  const done = (await completion.json()).job;
  assert.equal(done.status, 'needs_review');
  assert.deepEqual(done.draft, job.draft);
  assert.equal(done.metadata.reviewsStale, false);
  assert.equal(done.metadata.reviewsDraftRevision, job.revision);
  assert.equal(done.metadata.paper, undefined);
  const runs = (await (await f.call(`/jobs/${job.id}/reviews`)).json()).runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].draftRevision, job.revision);
  const path = `/jobs/${job.id}/reviews/${runs[0].id}/findings/claude/0`;
  assert.equal((await f.call(path, { method: 'PATCH', data: { status: 'rejected', reason: '' } })).status, 400);
  assert.equal((await f.call(path, { method: 'PATCH', data: { status: 'rejected', reason: 'The text already specifies the population.' } })).status, 200);
  assert.equal((await (await f.call(`/jobs/${job.id}/reviews`)).json()).runs[0].dispositions[0].status, 'rejected');
  const edited = (await (await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: done.revision, draft: { ...fixtureDraft, notes: 'Manual revision' } } })).json()).job;
  assert.equal(edited.metadata.reviewsStale, true);
  assert.equal((await f.call(path, { role: 'anonymous', method: 'PATCH', data: { status: 'resolved', reason: '' } })).status, 401);
});

test('failed or cancelled review retains the saved draft and an explicit retry stays a review', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  const queued = await f.call(`/jobs/${job.id}/review`, { method: 'POST', data: { revision: job.revision } });
  assert.equal(queued.status, 200);
  await f.call(`/jobs/${job.id}/cancel`, { method: 'POST' });
  const retry = (await (await f.call(`/jobs/${job.id}/retry`, { method: 'POST' })).json()).job;
  assert.equal(retry.phase, 'review');
  const originalRequest = (await queued.json()).job.metadata.reviewRequest;
  assert.deepEqual(retry.metadata.reviewRequest, originalRequest, 'an unfinished run keeps its cached review request');
  assert.deepEqual(retry.draft, job.draft);
  assert.equal((await f.claim()).job, null);
});

test('retry after a completed review creates a new run for the current saved draft', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  await f.call(`/jobs/${job.id}/review`, { method: 'POST', data: { revision: job.revision } });
  async function completeReview(fileId) {
    const claim = await f.claim({ reviewDraft: true });
    await f.upload(job.id, claim.leaseToken, fileId);
    const response = await f.call(`/jobs/${job.id}/complete`, { role: 'worker', method: 'POST', data: { leaseToken: claim.leaseToken, artifacts: [fileId], metadata: { reviews: [] } } });
    assert.equal(response.status, 200);
    return (await response.json()).job;
  }
  const first = await completeReview('first-review');
  const edited = (await (await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: first.revision, draft: { ...first.draft, notes: 'Updated after review' } } })).json()).job;
  await f.call(`/jobs/${job.id}/cancel`, { method: 'POST' });
  const retry = (await (await f.call(`/jobs/${job.id}/retry`, { method: 'POST' })).json()).job;
  assert.notEqual(retry.metadata.reviewRequest.runId, first.metadata.reviewRunId);
  assert.equal(retry.metadata.reviewRequest.draftRevision, edited.draftRevision);
  const second = await completeReview('second-review');
  assert.equal(second.metadata.reviewsDraftRevision, edited.draftRevision);
  const runs = (await (await f.call(`/jobs/${job.id}/reviews`)).json()).runs;
  assert.equal(runs.length, 2);
  assert.equal(new Set(runs.map(run => run.id)).size, 2);
});

test('migration preserves existing completed drafts/artifacts and does not invent old review versions', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../../migrations/0001_private_jobs.sql', import.meta.url), 'utf8'));
    db.prepare("INSERT INTO jobs(id,input,title,status,phase,stage,revision,draft,design,metadata,created_at,updated_at) VALUES('existing','PMID:123','Old job','completed','render','completed',9,?,'{}',?,1,2)")
      .run(JSON.stringify(fixtureDraft), JSON.stringify({ reviews: [{ provider: 'claude', status: 'ran', findings: [] }], reviewsStale: true, render: { revision: 8 } }));
    db.prepare("INSERT INTO artifacts(job_id,id,attempt_id,phase,name,content_type,size,sha256,object_key,committed,created_at) VALUES('existing','zip','attempt','render','social.zip','application/zip',3,'abc','secret-key',1,2)").run();
    db.exec(readFileSync(new URL('../../migrations/0002_draft_history_reviews.sql', import.meta.url), 'utf8'));
    const row = db.prepare("SELECT * FROM jobs WHERE id='existing'").get();
    assert.equal(row.revision, 9); assert.equal(row.status, 'completed');
    assert.deepEqual(JSON.parse(row.draft), fixtureDraft);
    assert.equal(JSON.parse(row.metadata).render.draftRevision, 9);
    assert.equal(JSON.parse(row.metadata).reviewsStale, true);
    assert.equal(db.prepare('SELECT draft_revision FROM review_runs').get().draft_revision, null);
    assert.equal(db.prepare('SELECT revision FROM draft_versions').get().revision, 9);
    assert.equal(db.prepare('SELECT committed FROM artifacts').get().committed, 1);
  } finally { db.close(); }
});

test('research retry returning identical text binds reviews to the existing draft snapshot', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  await f.call(`/jobs/${job.id}/cancel`, { method: 'POST' });
  await f.call(`/jobs/${job.id}/retry`, { method: 'POST' });
  const claim = await f.claim(); await f.upload(job.id, claim.leaseToken, 'retry-source');
  const response = await f.call(`/jobs/${job.id}/complete`, { method: 'POST', role: 'worker', data: { leaseToken: claim.leaseToken, artifacts: ['retry-source'], draft: job.draft, metadata: { reviews: [] } } });
  assert.equal(response.status, 200);
  const result = (await response.json()).job;
  assert.equal(result.metadata.reviewsDraftRevision, job.draftRevision);
  assert.equal(result.draftRevision, job.draftRevision);
});

test('uncertain same-text reconciliation revokes an older write while preserving the draft version', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await ready(f);
  const response = await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: job.draft, checkpoint: true } });
  const result = (await response.json()).job;
  assert.equal(result.revision, job.revision + 1);
  assert.equal(result.draftRevision, job.draftRevision);
  assert.equal((await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: { ...job.draft, post: 'older in-flight write' } } })).status, 409);
});
