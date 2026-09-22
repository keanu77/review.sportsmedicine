import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { generateKeyPair, SignJWT } from 'jose';
import { handleApi } from '../../server/api.mjs';

// Uses SQLite's real SQL semantics, including constraints and transactions.
// The separate Wrangler smoke test exercises Cloudflare's actual D1/R2 bindings.
export function sqliteD1() {
  const db = new DatabaseSync(':memory:');
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  function statement(sql, params = []) {
    return {
      bind(...values) { return statement(sql, values); },
      async first() { return db.prepare(sql).get(...params) || null; },
      async all() { return { results: db.prepare(sql).all(...params), meta: { changes: 0 } }; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...params).changes) }, results: [] }; },
      execute() {
        const stmt = db.prepare(sql);
        if (stmt.columns().length) return { results: stmt.all(...params), meta: { changes: Number(db.prepare('SELECT changes() AS n').get().n) } };
        return { results: [], meta: { changes: Number(stmt.run(...params).changes) } };
      },
    };
  }
  return {
    prepare: statement,
    async batch(statements) {
      db.exec('BEGIN');
      try { const result = statements.map((stmt) => stmt.execute()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); },
  };
}
export const fixtureDraft = {
  post: '運動介入的研究摘要', igCaption: '研究重點', notes: '請核對原始文獻',
  pages: [{ id: 'cover', layout: 'cover', title: '研究摘要' }],
  claims: [{ text: 'Exercise was assessed.', locator: 'Results, page 2', quote: 'Exercise was assessed.' }],
};
export async function fixture() {
  const keys = await generateKeyPair('RS256');
  let time = Date.now();
  const objects = new Map();
  const env = {
    APP_ORIGIN: 'https://review.example.com',
    WORKER_TOKEN_ISSUED_AT: new Date(time - 60000).toISOString(), WORKER_TOKEN_EXPIRES_AT: new Date(time + 89 * 86400000).toISOString(),
    DB: sqliteD1(), OWNER_EMAIL: 'owner@example.com', ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'test-audience', WORKER_TOKEN: '0123456789abcdef0123456789abcdef',
    ARTIFACTS: {
      async put(key, bytes, options) { objects.set(key, { bytes, ...options }); return {}; },
      async delete(key) { objects.delete(key); },
      async get(key) { const object = objects.get(key); return object ? { body: object.bytes, size: object.bytes.length, customMetadata: object.customMetadata } : null; },
    },
  };
  const token = async (overrides = {}, key = keys.privateKey) => new SignJWT({ email: env.OWNER_EMAIL, ...overrides })
    .setProtectedHeader({ alg: 'RS256' }).setIssuedAt().setIssuer('https://test.cloudflareaccess.com').setAudience('test-audience').setExpirationTime('1h').sign(key);
  const ownerToken = await token();
  async function call(path, { method = 'GET', data, role = 'owner', headers = {}, raw, overrideEnv } = {}) {
    const defaults = role === 'owner' ? { 'Cf-Access-Jwt-Assertion': ownerToken, Origin: 'https://review.example.com' } : role === 'worker' ? { Authorization: `Bearer ${env.WORKER_TOKEN}` } : {};
    const request = new Request(`https://review.example.com/api/${role === 'worker' ? 'worker' : 'private'}${path}`, { method, headers: { ...defaults, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: raw ?? (data === undefined ? undefined : JSON.stringify(data)) });
    return handleApi(request, overrideEnv || env, { keyResolver: keys.publicKey, clock: () => time });
  }
  const create = async () => (await (await call('/jobs', { method: 'POST', data: { input: '10.1234/example' } })).json()).job;
  const claim = async (capabilities = { imageGeneration: { available: true } }) => (await (await call('/claim', { method: 'POST', role: 'worker', data: { workerId: 'test-mac', capabilities } })).json());
  async function upload(jobId, leaseToken, fileId = 'source') {
    return call(`/jobs/${jobId}/files/${fileId}`, { method: 'PUT', role: 'worker', headers: { 'Content-Type': 'text/plain', 'X-Lease-Token': leaseToken, 'X-File-Name': `${fileId}.txt` }, raw: 'Exercise was assessed.' });
  }
  async function complete(jobId, leaseToken, artifacts = ['source'], draft = fixtureDraft) {
    return call(`/jobs/${jobId}/complete`, { method: 'POST', role: 'worker', data: { leaseToken, artifacts, ...(draft ? { draft } : {}), metadata: { source: 'full-text' } } });
  }
  return { env, keys, objects, call, create, claim, upload, complete, token, advance: (ms) => { time += ms; }, close: () => env.DB.close() };
}
