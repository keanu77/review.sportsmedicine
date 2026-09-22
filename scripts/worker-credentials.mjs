#!/usr/bin/env node
// Node 24 built-ins only. Never print tokens, response bodies, or native errors.
import { constants } from 'node:fs';
import { lstat, open, rename, link, unlink } from 'node:fs/promises';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';

const DAY = 86400000;
const KEYS = ['WORKER_TOKEN', 'WORKER_TOKEN_ISSUED_AT', 'WORKER_TOKEN_EXPIRES_AT', 'WORKER_PREVIOUS_TOKEN', 'WORKER_PREVIOUS_TOKEN_EXPIRES_AT'];
const TOKEN = /^[A-Za-z0-9_-]{32,512}$/;
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
class SafeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new SafeError(code, message); };
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

async function statMaybe(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Reject symlinks throughout the path, hard links, shared private directories,
// and any Git checkout, including ignored paths and linked worktrees.
export async function checkPrivatePath(path, { missing = false, privateParent = true } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path === REPO || path.startsWith(`${REPO}/`)) fail('PRIVATE_PATH', 'Use an absolute secret path outside the repository.');
  let cursor = dirname(path);
  let first = true;
  for (;;) {
    const info = await lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('PRIVATE_PATH', 'Secret paths must not contain symlinks.');
    if (first && privateParent && ((info.mode & 0o777) !== 0o700 || info.uid !== process.getuid())) fail('PRIVATE_DIRECTORY', 'The secret parent directory must be owned by this user with mode 0700.');
    if (await statMaybe(join(cursor, '.git'))) fail('PRIVATE_PATH', 'Secret files must be outside all Git checkouts.');
    first = false;
    if (dirname(cursor) === cursor) break;
    cursor = dirname(cursor);
  }
  const info = await statMaybe(path);
  if (!info) {
    if (missing) return;
    fail('PRIVATE_FILE_MISSING', 'A required private file is missing.');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) fail('PRIVATE_FILE', 'Secret files must be regular, unlinked, user-owned files with mode 0600.');
}

async function readPrivate(path, options) {
  await checkPrivatePath(path, options);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > 1024 * 1024) fail('PRIVATE_FILE', 'Invalid private file metadata.');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

export async function atomicPrivateWrite(path, content, { create = false } = {}) {
  await checkPrivatePath(path, { missing: create });
  const temporary = join(dirname(path), `.credential-${randomBytes(12).toString('hex')}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await checkPrivatePath(path, { missing: create });
    if (create) await link(temporary, path); // Atomic create without overwriting an existing plan.
    else await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await unlink(temporary).catch(() => {}); }
}

function workerEnv(text) {
  const matches = [...text.matchAll(/^[\t ]*(?:export[\t ]+)?REVIEW_WORKER_TOKEN[\t ]*=[^\r\n]*/gm)];
  let env;
  try { env = parseEnv(text); } catch { fail('ENV_FORMAT', 'Cannot parse the private worker env file.'); }
  if (matches.length !== 1 || !TOKEN.test(env.REVIEW_WORKER_TOKEN || '') || !TOKEN.test(parseEnv(matches[0][0]).REVIEW_WORKER_TOKEN || '')) fail('ENV_TOKEN', 'The worker env must contain exactly one single-line base64url token of 32–512 characters.');
  let origin;
  try {
    const url = new URL(env.REVIEW_API_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error();
    origin = url.origin;
  } catch { fail('ENV_ORIGIN', 'REVIEW_API_URL must be a plain HTTPS origin.'); }
  return { token: env.REVIEW_WORKER_TOKEN, origin, tokenLineStart: matches[0].index, tokenLineEnd: matches[0].index + matches[0][0].length };
}

export function replaceWorkerToken(text, expected, replacement) {
  const env = workerEnv(text);
  if (!TOKEN.test(replacement) || env.token !== expected) fail('LOCAL_CHANGED', 'The local credential changed; preserve the plan and reconcile the worker env before retrying.');
  return `${text.slice(0, env.tokenLineStart)}REVIEW_WORKER_TOKEN=${replacement}${text.slice(env.tokenLineEnd)}`;
}

function validatePlan(plan) {
  if (!plan || plan.version !== 1 || !['prepared', 'staged', 'activated', 'retired', 'revoked'].includes(plan.state)
    || !TOKEN.test(plan.oldToken || '') || !TOKEN.test(plan.newToken || '')
    || !iso(plan.issuedAt) || !iso(plan.expiresAt) || Date.parse(plan.expiresAt) - Date.parse(plan.issuedAt) !== 90 * DAY
    || (plan.previousExpiresAt !== null && (!iso(plan.previousExpiresAt) || Date.parse(plan.previousExpiresAt) <= Date.parse(plan.issuedAt) || Date.parse(plan.previousExpiresAt) - Date.parse(plan.issuedAt) > 3600000))
    || !/^[a-f0-9]{32}$/i.test(plan.account || '') || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(plan.project || '')) fail('PLAN_FORMAT', 'The private credential plan is invalid.');
  const parsed = workerEnv(`REVIEW_WORKER_TOKEN=${plan.newToken}\nREVIEW_API_URL=${plan.origin}\n`);
  if (parsed.origin !== plan.origin || !isAbsolute(plan.envFile || '')) fail('PLAN_FORMAT', 'The private credential plan is invalid.');
  return plan;
}

async function readPlan(path) {
  let value;
  try { value = JSON.parse(await readPrivate(path)); }
  catch (error) { if (error instanceof SafeError) throw error; fail('PLAN_FORMAT', 'Cannot read the private credential plan.'); }
  return validatePlan(value);
}
const savePlan = (path, plan, create = false) => atomicPrivateWrite(path, `${JSON.stringify(plan)}\n`, { create });

async function cloudflareToken(options, env) {
  if (env.CLOUDFLARE_API_TOKEN) {
    if (!/^[\x21-\x7e]{20,4096}$/.test(env.CLOUDFLARE_API_TOKEN)) fail('CF_AUTH', 'Invalid Cloudflare API credential format.');
    return env.CLOUDFLARE_API_TOKEN;
  }
  if (!options['wrangler-config']) fail('CF_AUTH', 'Provide CLOUDFLARE_API_TOKEN through a private environment or --wrangler-config with an existing OAuth config path.');
  const text = await readPrivate(options['wrangler-config'], { privateParent: false });
  const tokens = [...text.matchAll(/^oauth_token\s*=\s*"([^"\r\n]+)"\s*$/gm)];
  if (tokens.length !== 1 || !/^[\x21-\x7e]{20,4096}$/.test(tokens[0][1])) fail('CF_AUTH', 'The Wrangler config does not contain one valid OAuth token.');
  return tokens[0][1];
}

async function request(fetchImpl, url, init) {
  try { return await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { fail('NETWORK', 'Request failed. No response details are printed; preserve the private plan and retry after checking connectivity.'); }
}

async function health(fetchImpl, origin, token) {
  const response = await request(fetchImpl, `${origin}/api/worker/health`, { headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' } });
  if (response.status !== 200) {
    // A generic outage must never be mistaken for deliberate revocation.
    if (response.status === 503) {
      let data; try { data = await response.json(); } catch {}
      return { status: 503, accepted: false, notConfigured: data?.error?.code === 'WORKER_NOT_CONFIGURED' };
    }
    await response.body?.cancel().catch(() => {});
    return { status: response.status, accepted: false };
  }
  let data;
  try { data = await response.json(); } catch { fail('HEALTH_FORMAT', 'Health response was not valid JSON.'); }
  if (data?.ok !== true || !Number.isSafeInteger(data.activeJobs) || data.activeJobs < 0 || !iso(data.credentialExpiresAt)) fail('HEALTH_FORMAT', 'Health response did not match the credential API contract.');
  return { status: 200, accepted: true, activeJobs: data.activeJobs, credentialExpiresAt: data.credentialExpiresAt };
}

function requireHealth(result, expiresAt, idle = false) {
  if (!result.accepted) fail('HEALTH_REJECTED', 'The live deployment did not accept the credential. Deploy the expected production configuration, then retry; the local env was preserved.');
  if (expiresAt && result.credentialExpiresAt !== expiresAt) fail('HEALTH_VERSION', 'The live credential expiry does not match this plan.');
  if (idle && result.activeJobs !== 0) fail('WORKER_BUSY', 'A worker job is active. Wait for completion and stop the LaunchAgent before retrying.');
}

// PATCH individual env entries: omitted entries/bindings and preview are preserved.
// Follow Wrangler pages secret's wrangler_config_hash and null-delete semantics.
async function patchProduction(plan, changes, options, deps) {
  const token = await cloudflareToken(options, deps.env);
  const url = `https://api.cloudflare.com/client/v4/accounts/${plan.account}/pages/projects/${plan.project}`;
  const call = async (method, body) => {
    const response = await request(deps.fetchImpl, url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    let data;
    try { data = await response.json(); } catch { fail('CF_RESPONSE', 'Cloudflare returned an unreadable response. Preserve the plan; configuration state may need verification.'); }
    if (!response.ok || data?.success !== true || !data.result) fail('CF_REQUEST', 'Cloudflare rejected the request. No API response details are printed. Preserve the plan and check authentication/account permissions.');
    return data.result;
  };
  const project = await call('GET');
  const production = project?.deployment_configs?.production;
  if (project.name !== plan.project || !production || typeof production !== 'object') fail('CF_PROJECT', 'Cloudflare did not return the expected production project.');
  const config = { env_vars: changes };
  if (production.wrangler_config_hash) config.wrangler_config_hash = production.wrangler_config_hash;
  await call('PATCH', { deployment_configs: { production: config } });
}

// Dates use secret_text as well, so a subsequent Wrangler deploy cannot replace
// dashboard-only plain vars with just those declared in wrangler.jsonc.
const binding = value => ({ type: 'secret_text', value });
function stagedBindings(plan) {
  return {
    WORKER_TOKEN: binding(plan.newToken), WORKER_TOKEN_ISSUED_AT: binding(plan.issuedAt), WORKER_TOKEN_EXPIRES_AT: binding(plan.expiresAt),
    WORKER_PREVIOUS_TOKEN: plan.previousExpiresAt ? binding(plan.oldToken) : null,
    WORKER_PREVIOUS_TOKEN_EXPIRES_AT: plan.previousExpiresAt ? binding(plan.previousExpiresAt) : null,
  };
}

const HELP = 'worker-credentials.mjs status --env-file ABS | status --plan ABS\n'
  + 'stage --plan ABS --env-file ABS --account ID --project NAME --worker-stopped [--overlap-minutes 0..60] [--bootstrap-reviewed | --emergency]\n'
  + 'activate --plan ABS --worker-stopped\nretire --plan ABS\nverify --plan ABS\n'
  + 'revoke --plan ABS [--env-file ABS --account ID --project NAME]\n'
  + 'Cloudflare commands: CLOUDFLARE_API_TOKEN from a private environment, or --wrangler-config ABS.\n'
  + 'stage/retire/revoke save production configuration only. Deploy separately, then verify live acceptance. Never put a token in an argument.';

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command === '--help' || command === 'help') return { command: 'help', options: {} };
  const allowed = {
    status: ['plan', 'env-file'], stage: ['plan', 'env-file', 'account', 'project', 'worker-stopped', 'overlap-minutes', 'bootstrap-reviewed', 'emergency', 'wrangler-config'],
    activate: ['plan', 'worker-stopped'], retire: ['plan', 'wrangler-config'], verify: ['plan'], revoke: ['plan', 'env-file', 'account', 'project', 'wrangler-config'],
  };
  if (!allowed[command]) fail('USAGE', 'Unknown command. Run help for supported commands.');
  const options = {};
  const flags = new Set(['worker-stopped', 'bootstrap-reviewed', 'emergency']);
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].slice(2);
    if (!rest[i].startsWith('--') || !allowed[command].includes(key) || key in options) fail('USAGE', 'Unknown or repeated argument. Never pass a credential in command-line arguments.');
    if (flags.has(key)) options[key] = true;
    else {
      const value = rest[++i];
      if (!value || value.startsWith('--')) fail('USAGE', 'A required argument value is missing.');
      options[key] = value;
    }
  }
  if (command !== 'status' && !options.plan) fail('USAGE', '--plan is required.');
  if (command === 'status' && Boolean(options.plan) === Boolean(options['env-file'])) fail('USAGE', 'status requires exactly one of --plan and --env-file.');
  return { command, options };
}

async function createPlan(options, deps) {
  if (!options['env-file'] || !/^[a-f0-9]{32}$/i.test(options.account || '') || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(options.project || '')) fail('USAGE', 'A new plan requires --env-file, a 32-character account ID, and --project.');
  const local = workerEnv(await readPrivate(options['env-file']));
  const minutes = options['overlap-minutes'] === undefined ? 60 : Number(options['overlap-minutes']);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) fail('OVERLAP', 'Overlap must be an integer from 0 to 60 minutes.');
  if (options.emergency && minutes !== 0) fail('OVERLAP', 'Emergency rotation requires --overlap-minutes 0.');
  const now = deps.now();
  return { version: 1, state: 'prepared', envFile: options['env-file'], origin: local.origin, account: options.account, project: options.project,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 90 * DAY).toISOString(),
    previousExpiresAt: minutes ? new Date(now + minutes * 60000).toISOString() : null, oldToken: local.token, newToken: randomBytes(48).toString('base64url') };
}

async function execute(command, options, deps) {
  if (command === 'help') return { help: HELP };
  if (command === 'status' && options['env-file']) {
    const env = workerEnv(await readPrivate(options['env-file']));
    return { local: await health(deps.fetchImpl, env.origin, env.token) };
  }
  await checkPrivatePath(options.plan, { missing: ['stage', 'revoke'].includes(command) });
  const exists = Boolean(await statMaybe(options.plan));
  if (['stage', 'activate'].includes(command) && !options['worker-stopped']) fail('STOP_REQUIRED', 'Stop the idle LaunchAgent and pass --worker-stopped before changing its credential.');
  const plan = exists ? await readPlan(options.plan) : await createPlan(options, deps);
  await checkPrivatePath(plan.envFile);
  if (options['env-file'] && options['env-file'] !== plan.envFile || options.account && options.account !== plan.account || options.project && options.project !== plan.project) fail('PLAN_TARGET', 'The supplied target does not match the existing private plan.');
  if (command === 'status') return { state: plan.state, credentialExpiresAt: plan.expiresAt, previousExpiresAt: plan.previousExpiresAt,
    current: await health(deps.fetchImpl, plan.origin, plan.newToken), previous: await health(deps.fetchImpl, plan.origin, plan.oldToken) };
  if (command === 'stage') {
    if (!['prepared', 'staged'].includes(plan.state)) fail('PLAN_STATE', 'This plan has already advanced past staging.');
    if (options['bootstrap-reviewed'] && options.emergency) fail('USAGE', 'Choose bootstrap review or emergency rotation, not both.');
    if (deps.now() >= Date.parse(plan.expiresAt) || plan.previousExpiresAt && deps.now() >= Date.parse(plan.previousExpiresAt)) fail('PLAN_EXPIRED', 'The staging window has expired. Preserve the plan and reconcile configuration before starting a new rotation.');
    const local = workerEnv(await readPrivate(plan.envFile));
    if (local.origin !== plan.origin || local.token !== plan.oldToken) fail('LOCAL_CHANGED', 'The worker env no longer matches the staged plan.');
    if (options.emergency && plan.previousExpiresAt) fail('OVERLAP', 'Emergency rotation requires a plan with zero overlap.');
    if (!options['bootstrap-reviewed'] && !options.emergency) requireHealth(await health(deps.fetchImpl, plan.origin, plan.oldToken), null, true);
    if (!exists) await savePlan(options.plan, plan, true); // Persist before any remote mutation, including ambiguous failures.
    await patchProduction(plan, stagedBindings(plan), options, deps);
    plan.state = 'staged'; await savePlan(options.plan, plan);
    return { state: plan.state, configurationSaved: true, liveAcceptanceVerified: false, credentialExpiresAt: plan.expiresAt, previousExpiresAt: plan.previousExpiresAt,
      next: 'Deploy this production configuration and the credential-health server code; then activate while the worker remains stopped.' };
  }
  if (command === 'activate') {
    // A PATCH may succeed while its response or the state write is lost. Exact
    // new-token health and expiry are authoritative even for a prepared plan.
    if (!['prepared', 'staged', 'activated'].includes(plan.state)) fail('PLAN_STATE', 'This plan cannot be activated after retirement or revocation.');
    requireHealth(await health(deps.fetchImpl, plan.origin, plan.newToken), plan.expiresAt, true);
    const text = await readPrivate(plan.envFile);
    const local = workerEnv(text);
    if (local.origin !== plan.origin) fail('LOCAL_CHANGED', 'The worker API origin changed since staging.');
    if (local.token !== plan.newToken) await atomicPrivateWrite(plan.envFile, replaceWorkerToken(text, plan.oldToken, plan.newToken));
    plan.state = 'activated'; await savePlan(options.plan, plan);
    return { state: plan.state, currentAccepted: true, credentialExpiresAt: plan.expiresAt,
      next: 'Restart the named LaunchAgent, check status --env-file, then retire the previous credential.' };
  }
  if (command === 'retire') {
    if (!['activated', 'retired'].includes(plan.state)) fail('PLAN_STATE', 'Activate the local credential before retirement.');
    const local = workerEnv(await readPrivate(plan.envFile));
    if (local.token !== plan.newToken || local.origin !== plan.origin) fail('LOCAL_CHANGED', 'The local worker does not match the active plan.');
    requireHealth(await health(deps.fetchImpl, plan.origin, plan.newToken), plan.expiresAt);
    await patchProduction(plan, { WORKER_PREVIOUS_TOKEN: null, WORKER_PREVIOUS_TOKEN_EXPIRES_AT: null }, options, deps);
    plan.state = 'retired'; await savePlan(options.plan, plan);
    return { state: plan.state, configurationSaved: true, liveRetirementVerified: false, next: 'Deploy production again; then verify new health 200 and previous health 401. Keep the private plan until verification succeeds.' };
  }
  if (command === 'revoke') {
    if (!exists) await savePlan(options.plan, plan, true);
    await patchProduction(plan, Object.fromEntries(KEYS.map(key => [key, null])), options, deps);
    plan.state = 'revoked'; await savePlan(options.plan, plan);
    return { state: plan.state, configurationSaved: true, liveRevocationVerified: false, next: 'Deploy production immediately, keep the worker stopped, then verify both credentials fail with 503 WORKER_NOT_CONFIGURED. Private jobs/artifacts are untouched.' };
  }
  if (command === 'verify') {
    if (!['retired', 'revoked'].includes(plan.state)) fail('PLAN_STATE', 'Retire or revoke the plan before final verification.');
    const current = await health(deps.fetchImpl, plan.origin, plan.newToken);
    const previous = await health(deps.fetchImpl, plan.origin, plan.oldToken);
    if (plan.state === 'revoked') {
      if (!current.notConfigured || !previous.notConfigured) fail('REVOCATION_PENDING', 'Live revocation is not confirmed. Deploy the revoked production configuration and retry; the plan is preserved.');
    } else {
      requireHealth(current, plan.expiresAt);
      if (previous.status !== 401) fail('RETIREMENT_PENDING', 'The previous credential is not confirmed rejected with 401. Deploy the retired configuration and retry; the plan is preserved.');
    }
    await checkPrivatePath(options.plan);
    await unlink(options.plan);
    return { credentialExpiresAt: plan.state === 'revoked' ? null : plan.expiresAt, currentAccepted: current.accepted, previousAccepted: previous.accepted };
  }
}

export async function runCLI(argv, { fetchImpl = fetch, env = process.env, now = Date.now, stdout = text => process.stdout.write(text), stderr = text => process.stderr.write(text) } = {}) {
  try {
    const { command, options } = parseArguments(argv);
    const result = await execute(command, options, { fetchImpl, env, now });
    stdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const safe = error instanceof SafeError ? { error: error.code, message: error.message } : { error: 'OPERATION_FAILED', message: 'Operation failed. Private files and API responses are not printed. Preserve any credential plan and inspect permissions/state before retrying.' };
    stderr(`${JSON.stringify(safe)}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCLI(process.argv.slice(2));
