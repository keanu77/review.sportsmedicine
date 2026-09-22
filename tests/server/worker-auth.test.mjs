import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateWorker } from '../../server/auth.mjs';
import { fixture } from './helpers.mjs';
import { handleApi } from '../../server/api.mjs';

const now = Date.parse('2026-09-22T00:00:00.000Z');
const token = 'a'.repeat(64), old = 'b'.repeat(64);
const config = () => ({ WORKER_TOKEN: token, WORKER_TOKEN_EXPIRES_AT: new Date(now + 90 * 86400000).toISOString(),
  WORKER_TOKEN_ISSUED_AT: new Date(now).toISOString() });
const request = value => new Request('https://review.example.com/api/worker/health', { headers: { Authorization: `Bearer ${value}` } });
test('worker credentials require bounded issuance/expiry; expiration and revocation fail closed', async () => {
  assert.equal((await authenticateWorker(request(token), config(), now)).expiresAt, config().WORKER_TOKEN_EXPIRES_AT);
  for (const patch of [{ WORKER_TOKEN_EXPIRES_AT: undefined }, { WORKER_TOKEN_EXPIRES_AT: 'bad' },
    { WORKER_TOKEN_ISSUED_AT: undefined }, { WORKER_TOKEN_EXPIRES_AT: new Date(now + 91 * 86400000).toISOString() }]) {
    await assert.rejects(authenticateWorker(request(token), { ...config(), ...patch }, now), e => e.status === 503);
  }
  await assert.rejects(authenticateWorker(request(token), config(), now + 90 * 86400000), e => e.status === 401);
  await assert.rejects(authenticateWorker(request(token), config(), now - 1), e => e.status === 401);
  await assert.rejects(authenticateWorker(request(old), config(), now), e => e.status === 401);
});
test('previous credential works only during at most one hour of rotation and can be revoked immediately', async () => {
  const env = { ...config(), WORKER_PREVIOUS_TOKEN: old, WORKER_PREVIOUS_TOKEN_EXPIRES_AT: new Date(now + 3600000).toISOString() };
  assert.equal((await authenticateWorker(request(old), env, now)).expiresAt, env.WORKER_PREVIOUS_TOKEN_EXPIRES_AT);
  await assert.rejects(authenticateWorker(request(old), env, now + 3600000), e => e.status === 401);
  assert.equal((await authenticateWorker(request(token), env, now + 3600000)).expiresAt, env.WORKER_TOKEN_EXPIRES_AT);
  await assert.rejects(authenticateWorker(request(old), config(), now), e => e.status === 401);
  await assert.rejects(authenticateWorker(request(old), { ...env, WORKER_PREVIOUS_TOKEN_EXPIRES_AT: new Date(now + 3600001).toISOString() }, now), e => e.status === 503);
});
test('credential health is authenticated, read-only and exposes no job content or token', async t => {
  const f = await fixture(); t.after(f.close);
  const job = await f.create();
  const response = await f.call('/health', { role: 'worker' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, activeJobs: 0, credentialExpiresAt: f.env.WORKER_TOKEN_EXPIRES_AT });
  assert.equal((await (await f.call(`/jobs/${job.id}`)).json()).job.status, 'queued');
  assert.equal((await f.call('/health', { role: 'worker', headers: { Authorization: 'Bearer invalid' } })).status, 401);
  await f.claim();
  assert.equal((await (await f.call('/health', { role: 'worker' })).json()).activeJobs, 1);
});
test('worker credentials cannot be used through historical Pages aliases or a missing canonical origin', async t => {
  const f = await fixture(); t.after(f.close);
  for (const url of ['https://old.review-sportsmedicine.pages.dev/api/worker/health', 'https://review.example.com.evil.test/api/worker/health']) {
    const r = await handleApi(new Request(url, { headers: { Authorization: `Bearer ${f.env.WORKER_TOKEN}`, 'X-Forwarded-Host': 'review.example.com' } }), f.env);
    assert.equal(r.status, 403);
  }
  const r = await f.call('/health', { role: 'worker', overrideEnv: { ...f.env, APP_ORIGIN: '' } });
  assert.equal(r.status, 503);
});
