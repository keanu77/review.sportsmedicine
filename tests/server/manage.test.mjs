import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.mjs';

const pdf = Buffer.from(`%PDF-1.7\n${'owner supplied article '.repeat(20)}`);
const read = async (f, id) => (await (await f.call(`/jobs/${id}`)).json()).job;
async function failed(f, input = '10.1234/example') {
  const job = input === '10.1234/example' ? await f.create() : (await (await f.call('/jobs', { method: 'POST', data: { input } })).json()).job;
  const { leaseToken } = await f.claim();
  await f.call(`/jobs/${job.id}/fail`, { role: 'worker', method: 'POST', data: { leaseToken, code: 'FULLTEXT_BOT_CHECK', message: 'blocked' } });
  return read(f, job.id);
}
async function drafted(f) {
  const job = await f.create(); const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken); await f.complete(job.id, leaseToken);
  return read(f, job.id);
}
const upload = (f, job) => f.call(`/jobs/${job.id}/source?revision=${job.revision}`, { method: 'PUT', raw: pdf,
  headers: { 'Content-Type': 'application/pdf', 'X-File-Name': 'paper.pdf', 'X-Content-SHA256': createHash('sha256').update(pdf).digest('hex') } });

test('delete removes the job, its history, reviews, artifacts and every private object under its prefix', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  await f.call(`/jobs/${job.id}/review`, { method: 'POST', data: { revision: job.revision } });
  f.objects.set(`jobs/${job.id}/stray/orphan`, { bytes: Buffer.from('x') });
  f.objects.set('jobs/other-job/keep', { bytes: Buffer.from('y') });
  const current = await read(f, job.id);
  assert.equal((await f.call(`/jobs/${job.id}?revision=${current.revision - 1}`, { method: 'DELETE' })).status, 409, 'stale revision');
  const response = await f.call(`/jobs/${job.id}?revision=${current.revision}`, { method: 'DELETE' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { deleted: job.id });
  assert.equal((await f.call(`/jobs/${job.id}`)).status, 404);
  assert.deepEqual([...f.objects.keys()], ['jobs/other-job/keep']);
  for (const table of ['artifacts', 'draft_versions', 'review_runs']) assert.equal((await f.env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE job_id=?`).bind(job.id).first()).n, 0, table);
  assert.equal((await (await f.call('/jobs')).json()).jobs.length, 0);
});

test('a running job cannot be deleted, and delete requires a same-origin owner request', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  const running = await read(f, job.id);
  assert.equal((await f.call(`/jobs/${job.id}?revision=${running.revision}`, { method: 'DELETE' })).status, 409);
  assert.equal((await f.call(`/jobs/${job.id}?revision=${running.revision}`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.call(`/jobs/${job.id}/heartbeat`, { role: 'worker', method: 'POST', data: { leaseToken, stage: 'drafting' } })).status, 200, 'lease survives the refused delete');
});

test('restart requeues a drafted job for fresh research, keeps its draft history and records the request', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  assert.equal((await f.call(`/jobs/${job.id}/restart`, { method: 'POST', data: { revision: job.revision - 1 } })).status, 409);
  const response = await f.call(`/jobs/${job.id}/restart`, { method: 'POST', data: { revision: job.revision } });
  assert.equal(response.status, 200);
  const { job: queued } = await response.json();
  assert.equal(queued.status, 'queued'); assert.equal(queued.phase, 'research'); assert.equal(queued.error, null);
  assert.match(queued.metadata.restartRequest.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(queued.draft, job.draft, 'draft stays visible until the new research completes');
  const { job: claimed, leaseToken } = await f.claim();
  assert.equal(claimed.id, job.id); assert.equal(claimed.metadata.restartRequest.id, queued.metadata.restartRequest.id);
  await f.upload(claimed.id, leaseToken, 'fresh'); await f.complete(claimed.id, leaseToken, ['fresh']);
  const done = await read(f, job.id);
  assert.deepEqual(done.artifacts.map(a => a.id), ['fresh'], 'previous research files are replaced, not duplicated');
  assert.ok((await (await f.call(`/jobs/${job.id}/versions`)).json()).versions.length >= 1);
  const fresh = await f.create();
  assert.equal((await f.call(`/jobs/${fresh.id}/restart`, { method: 'POST', data: { revision: fresh.revision } })).status, 409, 'nothing to restart without a draft');
});

test('title and identifier edits apply before a draft exists and drop a PDF uploaded for the old identifier', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await failed(f);
  const { job: withPdf } = await (await upload(f, job)).json();
  const { leaseToken } = await f.claim();
  await f.call(`/jobs/${job.id}/fail`, { role: 'worker', method: 'POST', data: { leaseToken, code: 'FULLTEXT_MANUAL_MISMATCH', message: 'wrong' } });
  const again = await read(f, job.id);
  assert.equal((await f.call(`/jobs/${job.id}`, { method: 'PATCH', data: { revision: again.revision, input: 'https://evil.test/x', title: '' } })).status, 400);
  const titleOnly = await (await f.call(`/jobs/${job.id}`, { method: 'PATCH', data: { revision: again.revision, input: '10.1234/example', title: '新的標題' } })).json();
  assert.equal(titleOnly.job.title, '新的標題'); assert.ok(titleOnly.job.metadata.manualSource, 'same identifier keeps the uploaded PDF');
  const changed = await (await f.call(`/jobs/${job.id}`, { method: 'PATCH', data: { revision: titleOnly.job.revision, input: 'https://doi.org/10.5555/Fixed', title: '' } })).json();
  assert.equal(changed.job.input, '10.5555/fixed'); assert.equal(changed.job.status, 'failed');
  assert.equal(changed.job.metadata.manualSource, undefined);
  assert.equal([...f.objects.keys()].filter(key => key.includes('/manual/')).length, 0);
  assert.ok(withPdf.metadata.manualSource);
  const done = await drafted(f);
  assert.equal((await f.call(`/jobs/${done.id}`, { method: 'PATCH', data: { revision: done.revision, input: '10.5555/other', title: '' } })).status, 409, 'identity is fixed once a draft exists');
});

test('removing an uploaded PDF deletes the private object and keeps the job state', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await failed(f);
  const { job: queued } = await (await upload(f, job)).json();
  assert.equal((await f.call(`/jobs/${job.id}/source?revision=${queued.revision - 1}`, { method: 'DELETE' })).status, 409);
  const response = await f.call(`/jobs/${job.id}/source?revision=${queued.revision}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  const { job: removed } = await response.json();
  assert.equal(removed.status, 'queued'); assert.equal(removed.metadata.manualSource, undefined);
  assert.equal([...f.objects.keys()].filter(key => key.includes('/manual/')).length, 0);
  assert.equal((await f.call(`/jobs/${job.id}/source?revision=${removed.revision}`, { method: 'DELETE' })).status, 409, 'nothing left to remove');
});

test('the worker learns which local workspaces belong to deleted jobs', async (t) => {
  const f = await fixture(); t.after(f.close);
  const kept = await f.create();
  const gone = '00000000-0000-4000-8000-000000000000';
  const response = await f.call('/workspace/unknown', { role: 'worker', method: 'POST', data: { ids: [kept.id, gone] } });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { unknown: [gone] });
  assert.equal((await f.call('/workspace/unknown', { role: 'worker', method: 'POST', data: { ids: ['../etc'] } })).status, 400);
  assert.equal((await f.call('/workspace/unknown', { role: 'worker', method: 'POST', data: { ids: Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) } })).status, 400);
  assert.equal((await f.call('/workspace/unknown', { method: 'POST', data: { ids: [gone] } })).status, 404, 'owner route does not exist');
});

test('render accepts every new design option and rejects unknown ones', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  const design = { palette: 'clash', style: 'seamless', imageStyle: 'film', format: 'story' };
  const response = await f.call(`/jobs/${job.id}/render`, { method: 'POST', data: { revision: job.revision, design } });
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).job.design, design);
  const queued = await read(f, job.id);
  for (const bad of [{ ...design, style: 'neon' }, { ...design, palette: 'rainbow' }, { ...design, imageStyle: 'clay' }, { ...design, format: 'banner' }]) {
    assert.equal((await f.call(`/jobs/${job.id}/render`, { method: 'POST', data: { revision: queued.revision, design: bad } })).status, 400);
  }
});
