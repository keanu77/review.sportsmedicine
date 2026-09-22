import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, stat, rm, symlink, link, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from 'node:util';
import { runCLI, replaceWorkerToken, checkPrivatePath, atomicPrivateWrite } from '../../scripts/worker-credentials.mjs';

const OLD = 'fixture_old_token_'.repeat(3);
const CF = 'fixture_cloudflare_auth_'.repeat(3);
const NOW = Date.parse('2026-09-22T02:00:00.000Z');
const ACCOUNT = 'a'.repeat(32);
const PROJECT = 'fixture-project';

async function fixture(t) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'worker-credential-test-'));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFile = join(directory, 'worker.env');
  const planFile = join(directory, 'rotation.json');
  const original = `# Keep this comment\r\nREVIEW_API_URL=https://worker.example.com\r\nexport REVIEW_WORKER_TOKEN = '${OLD}' # old\r\nOTHER="keep $HOME literal"\r\n`;
  await writeFile(envFile, original, { mode: 0o600 });
  let config = { WORKER_TOKEN: { type: 'secret_text', value: OLD }, OTHER: { type: 'secret_text' }, PUBLIC: { type: 'plain_text', value: 'stay' } };
  let live = structuredClone(config);
  let activeJobs = 0;
  let errorStatus = null;
  let failPatch = false;
  let generic503 = false;
  const patches = [];
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.redirect, 'error');
    if (url.startsWith('https://api.cloudflare.com/')) {
      assert.equal(init.headers.Authorization, `Bearer ${CF}`);
      if (init.method === 'PATCH') {
        if (failPatch) throw new Error(`${OLD} ${CF}`);
        const patch = JSON.parse(init.body);
        patches.push(patch);
        assert.deepEqual(Object.keys(patch.deployment_configs), ['production']);
        assert.equal(patch.deployment_configs.production.wrangler_config_hash, 'fixture-config-hash');
        for (const [key, value] of Object.entries(patch.deployment_configs.production.env_vars)) {
          if (value === null) delete config[key]; else config[key] = value;
        }
      }
      return Response.json({ success: true, result: { name: PROJECT, deployment_configs: {
        production: { env_vars: config, d1_databases: { DB: { id: 'unchanged' } }, wrangler_config_hash: 'fixture-config-hash' },
        preview: { env_vars: { UNRELATED: { type: 'plain_text', value: 'preview-stays' } } },
      } } });
    }
    assert.equal(url, 'https://worker.example.com/api/worker/health');
    if (generic503) return Response.json({ error: { code: 'OUTAGE', message: OLD } }, { status: 503 });
    if (errorStatus) return new Response(`${OLD} ${CF}`, { status: errorStatus });
    if (!live.WORKER_TOKEN) return Response.json({ error: { code: 'WORKER_NOT_CONFIGURED' } }, { status: 503 });
    const token = init.headers.Authorization.slice(7);
    if (token === live.WORKER_TOKEN.value) return Response.json({ ok: true, activeJobs, credentialExpiresAt: live.WORKER_TOKEN_EXPIRES_AT?.value || '2026-10-01T00:00:00.000Z' });
    if (token === live.WORKER_PREVIOUS_TOKEN?.value) return Response.json({ ok: true, activeJobs, credentialExpiresAt: live.WORKER_PREVIOUS_TOKEN_EXPIRES_AT.value });
    return new Response(OLD, { status: 401 });
  };
  const run = async (args, overrides = {}) => {
    let output = '', error = '';
    const code = await runCLI(args, { fetchImpl, env: { CLOUDFLARE_API_TOKEN: CF }, now: () => NOW,
      stdout: text => { output += text; }, stderr: text => { error += text; }, ...overrides });
    assert.ok(!`${output}${error}`.includes(OLD)); assert.ok(!`${output}${error}`.includes(CF));
    try { const plan = JSON.parse(await readFile(planFile, 'utf8')); assert.ok(!`${output}${error}`.includes(plan.newToken)); } catch (err) { if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err; }
    return { code, output: output && JSON.parse(output), error: error && JSON.parse(error) };
  };
  const stage = (...extra) => run(['stage', '--plan', planFile, '--env-file', envFile, '--account', ACCOUNT, '--project', PROJECT, '--worker-stopped', ...extra]);
  return { directory, envFile, planFile, original, run, stage, patches, requests,
    deploy: () => { live = structuredClone(config); }, config: () => config,
    busy: value => { activeJobs = value; }, failHealth: value => { errorStatus = value; }, failPatch: value => { failPatch = value; }, outage: value => { generic503 = value; },
    plan: async () => JSON.parse(await readFile(planFile, 'utf8')) };
}

test('staged rotation preserves unrelated config and env; live deploy gates and final cleanup', async t => {
  const f = await fixture(t);
  assert.equal((await f.stage()).code, 0);
  const plan = await f.plan();
  assert.match(plan.newToken, /^[A-Za-z0-9_-]{64}$/);
  assert.notEqual(plan.newToken, OLD);
  assert.equal(Date.parse(plan.expiresAt) - Date.parse(plan.issuedAt), 90 * 86400000);
  assert.equal(Date.parse(plan.previousExpiresAt) - Date.parse(plan.issuedAt), 3600000);
  assert.equal((await stat(f.planFile)).mode & 0o777, 0o600);
  assert.equal(await readFile(f.envFile, 'utf8'), f.original);
  assert.equal(f.config().PUBLIC.value, 'stay');
  assert.deepEqual(f.config().OTHER, { type: 'secret_text' });
  assert.deepEqual(Object.keys(f.patches[0].deployment_configs.production), ['env_vars', 'wrangler_config_hash']);
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).error.error, 'HEALTH_REJECTED');
  assert.equal(await readFile(f.envFile, 'utf8'), f.original);
  f.deploy();
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).code, 0);
  assert.equal(await readFile(f.envFile, 'utf8'), f.original.replace(`export REVIEW_WORKER_TOKEN = '${OLD}' # old`, `REVIEW_WORKER_TOKEN=${plan.newToken}`));
  assert.equal((await stat(f.envFile)).mode & 0o777, 0o600);
  assert.equal((await f.run(['status', '--env-file', f.envFile])).output.local.accepted, true);
  assert.equal((await f.run(['retire', '--plan', f.planFile])).code, 0);
  assert.equal((await f.run(['verify', '--plan', f.planFile])).error.error, 'RETIREMENT_PENDING');
  assert.equal((await f.plan()).state, 'retired');
  f.deploy();
  assert.deepEqual((await f.run(['verify', '--plan', f.planFile])).output, { credentialExpiresAt: plan.expiresAt, currentAccepted: true, previousAccepted: false });
  await assert.rejects(readFile(f.planFile), { code: 'ENOENT' });
});

test('busy worker and missing stop acknowledgment block changes', async t => {
  const f = await fixture(t);
  f.busy(1);
  assert.equal((await f.stage()).error.error, 'WORKER_BUSY');
  assert.equal(f.patches.length, 0);
  f.busy(0); await f.stage(); f.deploy(); f.busy(1);
  assert.equal((await f.run(['activate', '--plan', f.planFile])).error.error, 'STOP_REQUIRED');
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).error.error, 'WORKER_BUSY');
  assert.equal(await readFile(f.envFile, 'utf8'), f.original);
});

test('activation replaces the actual assignment when an earlier comment contains identical text', async t => {
  const f = await fixture(t);
  const line = `export REVIEW_WORKER_TOKEN = '${OLD}' # old`;
  const comment = `# example ${line}\r\n`;
  await atomicPrivateWrite(f.envFile, comment + f.original);
  assert.equal((await f.stage()).code, 0);
  f.deploy();
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).code, 0);
  const plan = await f.plan();
  const updated = await readFile(f.envFile, 'utf8');
  assert.equal(updated, comment + f.original.replace(line, `REVIEW_WORKER_TOKEN=${plan.newToken}`));
  assert.equal(parseEnv(updated).REVIEW_WORKER_TOKEN, plan.newToken);
  assert.equal(plan.state, 'activated');
});

test('ambiguous remote failure retains private plan and retries the same credential', async t => {
  const f = await fixture(t);
  f.failPatch(true);
  assert.equal((await f.stage()).error.error, 'NETWORK');
  const plan = await f.plan();
  assert.equal(plan.state, 'prepared');
  f.failPatch(false);
  assert.equal((await f.stage()).code, 0);
  assert.equal((await f.plan()).newToken, plan.newToken);
  assert.equal(await readFile(f.envFile, 'utf8'), f.original);
});

test('activation is recoverable if plan state persistence lagged local env update', async t => {
  const f = await fixture(t);
  await f.stage(); f.deploy();
  const plan = await f.plan();
  await atomicPrivateWrite(f.envFile, replaceWorkerToken(f.original, OLD, plan.newToken));
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).code, 0);
  assert.equal((await f.plan()).state, 'activated');
});

test('new live health recovers a prepared plan after an ambiguous successful PATCH', async t => {
  const f = await fixture(t);
  await f.stage(); f.deploy();
  const plan = await f.plan();
  await atomicPrivateWrite(f.planFile, JSON.stringify({ ...plan, state: 'prepared' }));
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).code, 0);
  assert.equal((await f.plan()).state, 'activated');
});

test('changed local env cannot be overwritten by activation', async t => {
  const f = await fixture(t);
  await f.stage(); f.deploy();
  const changed = replaceWorkerToken(f.original, OLD, 'different_private_fixture_'.repeat(3));
  await atomicPrivateWrite(f.envFile, changed);
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).error.error, 'LOCAL_CHANGED');
  assert.equal(await readFile(f.envFile, 'utf8'), changed);
});

test('bootstrap is explicit and emergency overlap must be zero', async t => {
  const f = await fixture(t);
  f.failHealth(404);
  assert.equal((await f.stage()).error.error, 'HEALTH_REJECTED');
  assert.equal((await f.stage('--overlap-minutes', '61')).error.error, 'OVERLAP');
  assert.equal((await f.stage('--emergency')).error.error, 'OVERLAP');
  assert.equal((await f.stage('--bootstrap-reviewed')).code, 0);
  assert.equal((await f.run(['activate', '--plan', f.planFile, '--worker-stopped'])).error.error, 'HEALTH_REJECTED');
});

test('emergency rotation removes old credential without overlap', async t => {
  const f = await fixture(t);
  f.failHealth(401);
  assert.equal((await f.stage('--emergency', '--overlap-minutes', '0')).code, 0);
  assert.equal((await f.plan()).previousExpiresAt, null);
  assert.equal(f.patches[0].deployment_configs.production.env_vars.WORKER_PREVIOUS_TOKEN, null);
});

test('emergency revocation clears all credential fields without touching jobs; deploy required', async t => {
  const f = await fixture(t);
  await f.stage(); f.deploy();
  assert.equal((await f.run(['revoke', '--plan', f.planFile])).code, 0);
  assert.deepEqual(Object.keys(f.config()).sort(), ['OTHER', 'PUBLIC']);
  assert.equal((await f.run(['verify', '--plan', f.planFile])).error.error, 'REVOCATION_PENDING');
  f.deploy(); f.outage(true);
  assert.equal((await f.run(['verify', '--plan', f.planFile])).error.error, 'REVOCATION_PENDING');
  f.outage(false);
  assert.deepEqual((await f.run(['verify', '--plan', f.planFile])).output, { credentialExpiresAt: null, currentAccepted: false, previousAccepted: false });
  assert.ok(f.requests.every(({ url }) => url.endsWith('/health') || url.includes('/pages/projects/')));
});

test('revoke can start a private plan without a previous rotation', async t => {
  const f = await fixture(t);
  const result = await f.run(['revoke', '--plan', f.planFile, '--env-file', f.envFile, '--account', ACCOUNT, '--project', PROJECT]);
  assert.equal(result.code, 0);
  assert.equal((await f.plan()).state, 'revoked');
});

test('private paths reject symlinks, hardlinks, permissions, and all Git checkouts', async t => {
  const f = await fixture(t);
  const linked = join(f.directory, 'linked.env');
  await symlink(f.envFile, linked);
  await assert.rejects(checkPrivatePath(linked), /Secret files/);
  await rm(linked);
  await link(f.envFile, linked);
  await assert.rejects(checkPrivatePath(f.envFile), /Secret files/);
  await rm(linked);
  await chmod(f.envFile, 0o644);
  await assert.rejects(checkPrivatePath(f.envFile), /Secret files/);
  await chmod(f.envFile, 0o600);
  await chmod(f.directory, 0o755);
  await assert.rejects(checkPrivatePath(f.envFile), /0700/);
  await chmod(f.directory, 0o700);
  const child = join(f.directory, 'child');
  await mkdir(child, { mode: 0o700 });
  await symlink(child, join(f.directory, 'alias'));
  await assert.rejects(checkPrivatePath(join(f.directory, 'alias', 'new.json'), { missing: true }), /symlinks/);
  await writeFile(join(f.directory, '.git'), 'gitdir: somewhere');
  await assert.rejects(checkPrivatePath(f.envFile), /outside all Git/);
});

test('atomic create does not overwrite an existing private file', async t => {
  const f = await fixture(t);
  await assert.rejects(atomicPrivateWrite(f.envFile, 'replacement', { create: true }));
  assert.equal(await readFile(f.envFile, 'utf8'), f.original);
});

test('redacts malformed inputs, API bodies, and network exceptions', async t => {
  const f = await fixture(t);
  assert.equal((await f.run(['stage', '--token', OLD])).error.error, 'USAGE');
  f.failHealth(401);
  assert.equal((await f.stage()).error.error, 'HEALTH_REJECTED');
  f.failHealth(null);
  const result = await f.stage(); assert.equal(result.code, 0);
  const failingFetch = async () => Response.json({ success: false, errors: [{ message: `${OLD} ${CF}` }] }, { status: 403 });
  assert.equal((await f.run(['revoke', '--plan', f.planFile], { fetchImpl: failingFetch })).error.error, 'CF_REQUEST');
  await atomicPrivateWrite(f.planFile, `${OLD} invalid JSON`);
  assert.equal((await f.run(['status', '--plan', f.planFile])).error.error, 'PLAN_FORMAT');
});

test('reads fixture Wrangler OAuth privately without logging or child commands', async t => {
  const f = await fixture(t);
  const oauth = join(f.directory, 'wrangler.toml');
  await writeFile(oauth, `oauth_token = "${CF}"\nrefresh_token = "private_fixture"\n`, { mode: 0o600 });
  const result = await f.run(['stage', '--plan', f.planFile, '--env-file', f.envFile, '--account', ACCOUNT, '--project', PROJECT, '--worker-stopped', '--wrangler-config', oauth], { env: {} });
  assert.equal(result.code, 0);
});

test('rejects duplicate and multiline tokens without modifying other settings', () => {
  const text = `REVIEW_API_URL=https://worker.example.com\nREVIEW_WORKER_TOKEN=${OLD}\n`;
  assert.throws(() => replaceWorkerToken(`${text}REVIEW_WORKER_TOKEN=${OLD}\n`, OLD, OLD), /exactly one/);
  assert.throws(() => replaceWorkerToken(`REVIEW_API_URL=https://worker.example.com\nREVIEW_WORKER_TOKEN="${OLD}\ncontinued"\n`, OLD, OLD), /single-line/);
});
