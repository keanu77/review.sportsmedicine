/** Local integration only: actual Wrangler/workerd D1 + R2, no cloud resources. */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = fileURLToPath(new URL('../..', import.meta.url));
const wrangler = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const run = promisify(execFile);
const scratch = await mkdtemp(resolve(tmpdir(), 'review-private-bindings-'));
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
const workerToken = 'local-smoke-only-0123456789abcdef0123456789';
const reserve = createServer();
await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let processHandle; let logs = '';
async function command(args) {
  const result = await run(process.execPath, [wrangler, ...args], { cwd: root, env, timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  return result.stdout;
}
async function api(path, data, options = {}) {
  const response = await fetch(`${origin}/api/worker${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json', ...options.headers },
    body: data === undefined ? undefined : JSON.stringify(data), ...options,
  });
  return { response, data: await response.json() };
}
try {
  await command(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', scratch]);
  const now = Date.now();
  const seed = `INSERT INTO jobs (id,input,title,status,phase,stage,revision,design,created_at,updated_at) VALUES ('smoke-job','PMC12345','Local binding smoke','queued','research','queued',1,'{"palette":"blue","style":"clinical","imageStyle":"none","format":"portrait"}',${now},${now});`;
  await command(['d1', 'execute', 'DB', '--local', '--persist-to', scratch, '--command', seed]);
  // Owner JWTs cannot be minted locally and the R2 CLI cannot attach the sha256 metadata the
  // private PUT route writes, so this checks the lease gate and the integrity refusal on real R2.
  const manualPdf = Buffer.from(`%PDF-1.7\n${'owner supplied article '.repeat(20)}`);
  const manualHash = createHash('sha256').update(manualPdf).digest('hex');
  const manualKey = 'jobs/manual-job/manual/local-smoke';
  const manualFile = resolve(scratch, 'manual.pdf'); await writeFile(manualFile, manualPdf);
  await command(['r2', 'object', 'put', `review-private-artifacts/${manualKey}`, '--local', '--persist-to', scratch, '--file', manualFile, '--content-type', 'application/pdf']);
  const manualMetadata = JSON.stringify({ manualSource: { key: manualKey, name: 'manual.pdf', size: manualPdf.length, sha256: manualHash, uploadedAt: new Date(now).toISOString() } });
  await command(['d1', 'execute', 'DB', '--local', '--persist-to', scratch, '--command', `INSERT INTO jobs (id,input,title,status,phase,stage,revision,design,metadata,created_at,updated_at) VALUES ('manual-job','10.1234/manual','Manual upload smoke','queued','research','queued',1,'{"palette":"blue","style":"clinical","imageStyle":"none","format":"portrait"}','${manualMetadata}',${now + 1},${now + 1});`]);
  processHandle = spawn(process.execPath, [wrangler, 'pages', 'dev', 'public', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', scratch, '--binding', `WORKER_TOKEN=${workerToken}`, '--binding', `APP_ORIGIN=${origin}`, '--binding', `WORKER_TOKEN_ISSUED_AT=${new Date(now - 60000).toISOString()}`, '--binding', `WORKER_TOKEN_EXPIRES_AT=${new Date(now + 86400000).toISOString()}`, '--binding', 'OWNER_EMAIL=owner@example.com', '--binding', 'ACCESS_TEAM_DOMAIN=test.cloudflareaccess.com', '--binding', 'ACCESS_AUD=test-audience', '--log-level', 'warn'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  processHandle.stdout.on('data', (chunk) => { logs += chunk; });
  processHandle.stderr.on('data', (chunk) => { logs += chunk; });
  const until = Date.now() + 45000;
  while (true) {
    try { await fetch(`${origin}/api/private/session`); break; }
    catch {
      if (Date.now() > until || processHandle.exitCode !== null) throw new Error(`Wrangler did not become ready:\n${logs}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  assert.equal((await fetch(`${origin}/api/private/session`)).status, 401);
  assert.equal((await fetch(`${origin}/api/private/jobs/smoke-job/files/source`)).status, 401);
  const claims = await Promise.all(Array.from({ length: 5 }, (_, index) => api('/claim', { workerId: `smoke-${index}`, capabilities: ['local-test'] })));
  const winning = claims.filter(({ data }) => data.job);
  assert.equal(winning.length, 1, JSON.stringify(claims));
  const { leaseToken, job } = winning[0].data;
  assert.equal(job.id, 'smoke-job');
  const uploadResponse = await fetch(`${origin}/api/worker/jobs/${job.id}/files/source`, {
    method: 'PUT', headers: { Authorization: `Bearer ${workerToken}`, 'X-Lease-Token': leaseToken, 'X-File-Name': 'source.txt', 'Content-Type': 'text/plain' }, body: 'Real local R2 bytes',
  });
  assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text());
  const { artifact } = await uploadResponse.json();
  const retriedUpload = await fetch(`${origin}/api/worker/jobs/${job.id}/files/source`, {
    method: 'PUT', headers: { Authorization: `Bearer ${workerToken}`, 'X-Lease-Token': leaseToken, 'X-File-Name': 'source.txt', 'Content-Type': 'text/plain' }, body: 'Real local R2 bytes',
  });
  assert.equal(retriedUpload.status, 200, await retriedUpload.clone().text());
  assert.deepEqual((await retriedUpload.json()).artifact, artifact);
  const conflictingUpload = await fetch(`${origin}/api/worker/jobs/${job.id}/files/source`, {
    method: 'PUT', headers: { Authorization: `Bearer ${workerToken}`, 'X-Lease-Token': leaseToken, 'X-File-Name': 'source.txt', 'Content-Type': 'text/plain' }, body: 'Different contents',
  });
  assert.equal(conflictingUpload.status, 409);
  const heartbeat = await api(`/jobs/${job.id}/heartbeat`, { leaseToken, stage: 'verifying_bindings' });
  assert.equal(heartbeat.response.status, 200);
  const draft = { post: 'Smoke fixture', igCaption: 'Smoke fixture', notes: '', pages: [{ id: 'cover', layout: 'cover', title: 'Smoke fixture' }], claims: [{ text: 'Real local R2 bytes', locator: 'fixture line 1', quote: 'Real local R2 bytes' }] };
  const complete = await api(`/jobs/${job.id}/complete`, { leaseToken, draft, metadata: { fixture: true }, artifacts: ['source'] });
  assert.equal(complete.response.status, 200, JSON.stringify(complete.data));
  assert.equal(complete.data.job.status, 'needs_review');
  assert.equal(complete.data.job.artifacts[0].sha256, artifact.sha256);
  assert.equal((await api(`/jobs/${job.id}/complete`, { leaseToken, draft, artifacts: ['source'] })).response.status, 409);
  const manualClaim = await api('/claim', { workerId: 'smoke', capabilities: {} });
  assert.equal(manualClaim.data.job.id, 'manual-job');
  assert.equal(manualClaim.data.job.metadata.manualSource.key, undefined, 'storage key never leaves the server');
  const source = await fetch(`${origin}/api/worker/jobs/manual-job/source`, { headers: { Authorization: `Bearer ${workerToken}`, 'X-Lease-Token': manualClaim.data.leaseToken } });
  assert.equal(source.status, 502, 'an object without its recorded checksum is never served');
  assert.equal((await fetch(`${origin}/api/worker/jobs/manual-job/source`, { headers: { Authorization: `Bearer ${workerToken}`, 'X-Lease-Token': leaseToken } })).status, 409);
  assert.equal((await api('/jobs/manual-job/fail', { leaseToken: manualClaim.data.leaseToken, code: 'FULLTEXT_MANUAL_MISMATCH', message: 'fixture' })).response.status, 200);
  assert.equal((await api('/claim', { workerId: 'smoke', capabilities: {} })).data.job, null);
  const unknownId = '00000000-0000-4000-8000-000000000001';
  const unknown = await api('/workspace/unknown', { ids: [unknownId] });
  assert.equal(unknown.response.status, 200); assert.deepEqual(unknown.data.unknown, [unknownId]);
  console.log('PASS: real local Pages Functions + D1/R2; atomic claim, lease-bound owner-upload read with integrity refusal, workspace cleanup lookup, authenticated upload, idempotent retry, conflicting retry rejection, hash, heartbeat, completion, stale lease, anonymous owner/file denial.');
  console.log('Owner JWT success is covered by signed-JWT tests; no local authentication bypass is enabled.');
} catch (error) {
  if (logs) console.error(logs);
  throw error;
} finally {
  if (processHandle && processHandle.exitCode === null) {
    processHandle.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => processHandle.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
    if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  }
  await rm(scratch, { recursive: true, force: true });
}
