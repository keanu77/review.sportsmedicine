import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, fixtureDraft } from './helpers.mjs';

const BUCKET_MS = 120000;
const read = async (f, id) => (await (await f.call(`/jobs/${id}`)).json()).job;
const revisions = async (f, id) => (await f.env.DB.prepare('SELECT revision FROM draft_versions WHERE job_id=? ORDER BY revision').bind(id).all()).results.map(row => row.revision);
async function drafted(f) {
  const job = await f.create(); const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken); await f.complete(job.id, leaseToken);
  return read(f, job.id);
}
// Moves the fixture clock to just after the start of the next two-minute bucket.
async function nextBucket(f, job) {
  const now = Date.parse(job.updatedAt);
  f.advance(BUCKET_MS - (now % BUCKET_MS) + 10);
}
const save = async (f, job, post) => {
  const response = await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: { ...fixtureDraft, post } } });
  assert.equal(response.status, 200);
  return (await response.json()).job;
};

test('autosaves inside one two-minute window keep only the newest snapshot; the model draft stays', async (t) => {
  const f = await fixture(); t.after(f.close);
  let job = await drafted(f);
  const model = job.draftRevision;
  await nextBucket(f, job);
  job = await save(f, job, '第一次'); f.advance(1500);
  job = await save(f, job, '第二次'); f.advance(1500);
  job = await save(f, job, '第三次');
  assert.deepEqual(await revisions(f, job.id), [model, job.draftRevision]);
  assert.equal((await f.call(`/jobs/${job.id}/versions/${job.draftRevision}`)).status, 200);
});

test('a new window keeps the last snapshot of the previous one, so long sessions keep a trail', async (t) => {
  const f = await fixture(); t.after(f.close);
  let job = await drafted(f);
  await nextBucket(f, job);
  job = await save(f, job, '上一格');
  const kept = job.draftRevision;
  await nextBucket(f, job);
  job = await save(f, job, '下一格');
  assert.ok((await revisions(f, job.id)).includes(kept));
});

test('a snapshot that a review run, restore or request refers to is never merged away', async (t) => {
  const f = await fixture(); t.after(f.close);
  let job = await drafted(f);
  await nextBucket(f, job);
  job = await save(f, job, '被審核的版本');
  const reviewed = job.draftRevision;
  await f.env.DB.prepare('INSERT INTO review_runs(id,job_id,draft_revision,reviews,created_at) VALUES (?,?,?,?,?)').bind('run-x', job.id, reviewed, '[]', Date.now()).run();
  job = await save(f, job, '之後的修改');
  assert.ok((await revisions(f, job.id)).includes(reviewed));

  const before = job.draftRevision;
  await f.env.DB.prepare(`UPDATE jobs SET metadata=json_set(metadata,'$.reviseRequest',json_object('draftRevision',?)) WHERE id=?`).bind(before, job.id).run();
  job = await save(f, job, '再改一次');
  assert.ok((await revisions(f, job.id)).includes(before));
});

test('restored versions are kept and a stale save deletes nothing', async (t) => {
  const f = await fixture(); t.after(f.close);
  let job = await drafted(f);
  const model = job.draftRevision;
  await nextBucket(f, job);
  job = await save(f, job, '修改');
  const restored = (await (await f.call(`/jobs/${job.id}/restore`, { method: 'POST', data: { revision: job.revision, version: model } })).json()).job;
  const afterRestore = await revisions(f, job.id);
  assert.ok(afterRestore.includes(restored.draftRevision));
  const stale = await f.call(`/jobs/${job.id}/draft`, { method: 'PATCH', data: { revision: job.revision, draft: { ...fixtureDraft, post: '過期的存檔' } } });
  assert.equal(stale.status, 409);
  assert.deepEqual(await revisions(f, job.id), afterRestore);
  job = await save(f, restored, '還原後再改');
  assert.ok((await revisions(f, job.id)).includes(restored.draftRevision), 'a restore snapshot is not mergeable');
});
