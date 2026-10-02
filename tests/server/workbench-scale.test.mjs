import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

const read = async (f, id) => (await (await f.call(`/jobs/${id}`)).json()).job;
const list = async (f, query = '') => (await f.call(`/jobs${query}`)).json();
async function drafted(f) {
  const job = await f.create(); const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken); await f.complete(job.id, leaseToken);
  return read(f, job.id);
}

test('job list returns a light summary per job and pages with a cursor', async (t) => {
  const f = await fixture(); t.after(f.close);
  const first = await drafted(f);
  f.advance(1000); await f.create();
  f.advance(1000); const newest = await f.create();
  const page = await list(f, '?limit=2');
  assert.deepEqual(page.jobs.map(job => job.id).at(0), newest.id);
  assert.equal(page.jobs.length, 2);
  assert.ok(page.nextCursor, 'more jobs exist');
  for (const job of page.jobs) for (const key of ['draft', 'metadata', 'design', 'error']) assert.equal(key in job, false, key);
  const rest = await list(f, `?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`);
  assert.deepEqual(rest.jobs.map(job => job.id), [first.id]);
  assert.equal(rest.nextCursor, null);
  assert.equal((await f.call('/jobs?cursor=bogus')).status, 400);
  assert.equal((await f.call('/jobs?limit=1000')).status, 400);
});

test('job list carries only the thumbnail artifact', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create(); const { leaseToken } = await f.claim();
  for (const id of ['source', 'cover']) {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    await f.call(`/jobs/${job.id}/files/${id}`, { method: 'PUT', role: 'worker', raw: id === 'cover' ? png : 'x',
      headers: { 'Content-Type': id === 'cover' ? 'image/png' : 'text/plain', 'X-Lease-Token': leaseToken, 'X-File-Name': id === 'cover' ? 'cover-1200x630.png' : 'source.txt' } });
  }
  await f.complete(job.id, leaseToken, ['source', 'cover']);
  const [summary] = (await list(f)).jobs;
  assert.deepEqual(summary.artifacts.map(file => file.name), ['cover-1200x630.png']);
});

test('owner reads do not write unless a lease actually expired', async (t) => {
  const f = await fixture(); t.after(f.close);
  const writes = [];
  const prepare = f.env.DB.prepare;
  f.env.DB.prepare = (sql) => { if (/^\s*UPDATE jobs SET status='failed'/.test(sql)) writes.push(sql); return prepare(sql); };
  const job = await f.create(); await f.claim();
  await f.call('/session'); await f.call('/jobs'); await f.call(`/jobs/${job.id}`);
  assert.equal(writes.length, 0);
  f.advance(121000);
  assert.equal((await read(f, job.id)).stage, 'lease_expired');
  assert.equal(writes.length, 1);
});

test('a storage failure during delete leaves a retryable tombstone that no action can revive', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  const realDelete = f.env.ARTIFACTS.delete;
  f.env.ARTIFACTS.delete = async () => { throw new Error('R2 unavailable'); };
  assert.equal((await f.call(`/jobs/${job.id}?revision=${job.revision}`, { method: 'DELETE' })).status, 500);
  const tombstone = await read(f, job.id);
  assert.equal(tombstone.stage, 'deleting');
  assert.equal((await f.call(`/jobs/${job.id}/retry`, { method: 'POST' })).status, 409);
  assert.equal((await f.call(`/jobs/${job.id}/restart`, { method: 'POST', data: { revision: tombstone.revision } })).status, 409);
  assert.equal((await f.claim()).job, null, 'the worker never picks a job being deleted');

  f.env.ARTIFACTS.delete = realDelete;
  const retry = await f.call(`/jobs/${job.id}?revision=${job.revision}`, { method: 'DELETE' });
  assert.equal(retry.status, 200, 'retry works with the revision the owner saw');
  assert.equal((await f.call(`/jobs/${job.id}`)).status, 404);
  assert.deepEqual([...f.objects.keys()].filter(key => key.startsWith(`jobs/${job.id}/`)), []);
});

test('files of replaced attempts are removed from storage once the new attempt completes', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await drafted(f);
  const firstKeys = [...f.objects.keys()].filter(key => key.startsWith(`jobs/${job.id}/`));
  assert.equal(firstKeys.length, 1);
  await f.call(`/jobs/${job.id}/restart`, { method: 'POST', data: { revision: job.revision } });
  const { leaseToken } = await f.claim();
  await f.upload(job.id, leaseToken, 'source-2'); await f.complete(job.id, leaseToken, ['source-2']);
  const keys = [...f.objects.keys()].filter(key => key.startsWith(`jobs/${job.id}/`));
  assert.equal(keys.length, 1);
  assert.notEqual(keys[0], firstKeys[0]);
  assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM artifacts WHERE job_id=?').bind(job.id).first()).n, 1);
  assert.equal((await read(f, job.id)).artifacts.length, 1);
});

test('unexpected failures log the route shape and Cloudflare ray, never private identifiers', async (t) => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create();
  const logged = t.mock.method(console, 'error', () => {});
  const broken = { ...f.env, DB: { ...f.env.DB, prepare: (sql) => { if (sql.startsWith('SELECT * FROM jobs WHERE id=?')) throw new Error(`secret ${job.id}`); return f.env.DB.prepare(sql); } } };
  const response = await f.call(`/jobs/${job.id}`, { overrideEnv: broken, headers: { 'Cf-Ray': '8abc123-HKG' } });
  assert.equal(response.status, 500);
  const line = logged.mock.calls.map(call => call.arguments.join(' ')).join('\n');
  assert.match(line, /GET \/api\/private\/jobs\/:id/);
  assert.match(line, /8abc123-HKG/);
  assert.doesNotMatch(line, new RegExp(job.id));
});

test('every response asks browsers to stay on HTTPS for this host only', async (t) => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.call('/session')).headers.get('Strict-Transport-Security'), 'max-age=31536000');
  const { readFile } = await import('node:fs/promises');
  const headers = await readFile(new URL('../../public/_headers', import.meta.url), 'utf8');
  assert.match(headers, /^\/\*\n(?:  .*\n)*  Strict-Transport-Security: max-age=31536000\n/m);
  assert.doesNotMatch(headers.split('\n').filter(line => !line.startsWith('#')).join('\n'), /includeSubDomains|preload/, 'sibling sportsmedicine.tw hosts are not opted in');
});
