import { ApiError, conflict, staleLease } from './errors.mjs';
import { sha256 } from './auth.mjs';

export const LEASE_MS = 120000;
export const MAX_ATTEMPT_FILES = 32;
export const MAX_ATTEMPT_BYTES = 128 * 1024 * 1024;
const parse = (value, fallback = null) => value ? JSON.parse(value) : fallback;
const iso = (value) => new Date(value).toISOString();
export function publicArtifact(row) {
  return { id: row.id, name: row.name, contentType: row.content_type, size: row.size, sha256: row.sha256 };
}
export function createStore(db, clock = Date.now) {
  const prepare = (sql, ...args) => db.prepare(sql).bind(...args);
  const first = (sql, ...args) => prepare(sql, ...args).first();
  const all = async (sql, ...args) => (await prepare(sql, ...args).all()).results;
  const run = (sql, ...args) => prepare(sql, ...args).run();
  async function expire() {
    const now = clock();
    await run("UPDATE jobs SET status='failed', stage='lease_expired', error=?, lease_hash=NULL, lease_expires_at=NULL, revision=revision+1, updated_at=? WHERE status='running' AND lease_expires_at<=?",
      JSON.stringify({ code: 'LEASE_EXPIRED', message: 'Worker heartbeat expired. Work may have consumed model usage; explicitly retry only after checking the Mac worker.', recoverable: true }), now, now);
  }
  async function row(id) {
    const value = await first('SELECT * FROM jobs WHERE id=?', id);
    if (!value) throw new ApiError(404, 'NOT_FOUND', 'Job not found');
    return value;
  }
  async function serialize(value) {
    const artifacts = await all('SELECT * FROM artifacts WHERE job_id=? AND committed=1 ORDER BY created_at,id', value.id);
    return {
      id: value.id, input: value.input, title: value.title, status: value.status, phase: value.phase,
      stage: value.stage, revision: value.revision, draft: parse(value.draft), design: parse(value.design),
      metadata: parse(value.metadata, {}), artifacts: artifacts.map(publicArtifact), error: parse(value.error),
      createdAt: iso(value.created_at), updatedAt: iso(value.updated_at),
    };
  }
  async function get(id) { return serialize(await row(id)); }
  async function changed(statement) {
    const value = await statement.first();
    if (!value) throw conflict();
    return serialize(value);
  }
  async function lease(id, leaseToken) {
    if (typeof leaseToken !== 'string' || !/^[a-f0-9]{64}$/.test(leaseToken)) throw staleLease();
    const hash = await sha256(leaseToken);
    const value = await first("SELECT * FROM jobs WHERE id=? AND status='running' AND lease_hash=? AND lease_expires_at>?", id, hash, clock());
    if (!value) throw staleLease();
    return { row: value, hash };
  }
  return {
    expire, get, row, lease,
    async list() { return Promise.all((await all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100')).map(serialize)); },
    async presence() {
      const value = await first('SELECT * FROM worker_presence WHERE id=1');
      return value ? { lastSeen: iso(value.last_seen), capabilities: parse(value.capabilities, {}) } : null;
    },
    async create({ input, title, design }) {
      const id = crypto.randomUUID(); const now = clock();
      await run("INSERT INTO jobs (id,input,title,status,phase,stage,revision,design,created_at,updated_at) VALUES (?,?,?,'queued','research','queued',1,?,?,?)", id, input, title, JSON.stringify(design), now, now);
      return get(id);
    },
    edit(id, revision, draft) {
      return changed(prepare(`UPDATE jobs SET draft=?,status='needs_review',stage='needs_review',revision=revision+1,updated_at=?,
        metadata=CASE WHEN json_type(metadata,'$.reviews') IS NOT NULL AND json_type(metadata,'$.reviews')<>'null'
          THEN json_set(metadata,'$.reviewsStale',json('true')) ELSE metadata END
        WHERE id=? AND revision=? AND status IN ('needs_review','completed') RETURNING *`, JSON.stringify(draft), clock(), id, revision));
    },
    render(id, revision, design) {
      return changed(prepare("UPDATE jobs SET status='queued',phase='render',stage='queued',design=?,revision=revision+1,error=NULL,attempt_id=NULL,lease_hash=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND revision=? AND draft IS NOT NULL AND status IN ('needs_review','completed') RETURNING *", JSON.stringify(design), clock(), id, revision));
    },
    cancel(id) {
      return changed(prepare("UPDATE jobs SET status='cancelled',stage='cancelled',revision=revision+1,lease_hash=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status IN ('queued','running','needs_review') RETURNING *", clock(), id));
    },
    retry(id) {
      return changed(prepare("UPDATE jobs SET status='queued',stage='queued',revision=revision+1,error=NULL,attempt_id=NULL,lease_hash=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status IN ('failed','cancelled') RETURNING *", clock(), id));
    },
    async claim(workerId, capabilities) {
      await expire();
      const now = clock();
      await run('INSERT INTO worker_presence (id,worker_id,last_seen,capabilities) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET worker_id=excluded.worker_id,last_seen=excluded.last_seen,capabilities=excluded.capabilities', workerId, now, JSON.stringify(capabilities));
      const leaseToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const hash = await sha256(leaseToken);
      // Research does not need an image tool. Image-based rendering does, and a
      // missing/unverified capability must never silently downgrade the design.
      const canGenerateImages = capabilities?.imageGeneration?.available === true ? 1 : 0;
      const value = await first(`UPDATE jobs SET status='running',stage=phase,attempt_id=?,lease_hash=?,lease_expires_at=?,worker_id=?,updated_at=?
        WHERE id=(SELECT id FROM jobs WHERE status='queued'
          AND (phase='research' OR (phase='render' AND (json_extract(design,'$.imageStyle')='none' OR ?=1)))
          ORDER BY created_at,id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE status='running') RETURNING *`, crypto.randomUUID(), hash, now + LEASE_MS, workerId, now, canGenerateImages);
      return value ? { job: await serialize(value), leaseToken } : { job: null };
    },
    async heartbeat(id, leaseToken, stage) {
      const { hash } = await lease(id, leaseToken); const now = clock();
      const value = await first("UPDATE jobs SET lease_expires_at=?,stage=?,updated_at=? WHERE id=? AND status='running' AND lease_hash=? AND lease_expires_at>? RETURNING *", now + LEASE_MS, stage, now, id, hash, now);
      if (!value) throw staleLease();
      await run('UPDATE worker_presence SET last_seen=? WHERE id=1 AND worker_id=?', now, value.worker_id);
      return { job: await serialize(value), leaseExpiresAt: iso(now + LEASE_MS) };
    },
    async matchingUpload(id, leaseToken, artifact) {
      const { hash, row: active } = await lease(id, leaseToken);
      const existing = await first(`SELECT a.* FROM artifacts a JOIN jobs j ON j.id=a.job_id
        WHERE a.job_id=? AND a.id=? AND j.status='running' AND j.lease_hash=? AND j.lease_expires_at>?`, id, artifact.id, hash, clock());
      if (!existing) return null;
      if (existing.attempt_id !== active.attempt_id || existing.name !== artifact.name || existing.content_type !== artifact.contentType || existing.size !== artifact.size || existing.sha256 !== artifact.sha256) {
        throw new ApiError(409, 'UPLOAD_CONFLICT', 'This file ID belongs to a different artifact or attempt');
      }
      return publicArtifact(existing);
    },
    async registerArtifact(id, leaseToken, artifact) {
      const { hash, row: active } = await lease(id, leaseToken);
      const result = await run(`INSERT INTO artifacts (job_id,id,attempt_id,phase,name,content_type,size,sha256,object_key,committed,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,0,? WHERE EXISTS (SELECT 1 FROM jobs WHERE id=? AND status='running' AND lease_hash=? AND lease_expires_at>?)
        AND (SELECT count(*) FROM artifacts WHERE job_id=? AND attempt_id=?) < ?
        AND (SELECT coalesce(sum(size),0) FROM artifacts WHERE job_id=? AND attempt_id=?) + ? <= ?
        ON CONFLICT(job_id,id) DO NOTHING`,
      id, artifact.id, active.attempt_id, active.phase, artifact.name, artifact.contentType, artifact.size, artifact.sha256, artifact.key, clock(),
      id, hash, clock(), id, active.attempt_id, MAX_ATTEMPT_FILES, id, active.attempt_id, artifact.size, MAX_ATTEMPT_BYTES);
      if (result.meta.changes !== 1) throw new ApiError(409, 'UPLOAD_CONFLICT', 'The lease changed, the file ID already exists, or this attempt reached its upload limit');
      return { id: artifact.id, name: artifact.name, contentType: artifact.contentType, size: artifact.size, sha256: artifact.sha256 };
    },
    async artifact(id, fileId) {
      const artifact = await first('SELECT * FROM artifacts WHERE job_id=? AND id=? AND committed=1', id, fileId);
      if (!artifact) throw new ApiError(404, 'NOT_FOUND', 'Artifact not found');
      return artifact;
    },
    async complete(id, leaseToken, payload) {
      const { hash, row: active } = await lease(id, leaseToken); const now = clock();
      const ids = payload.artifacts;
      const placeholders = ids.map(() => '?').join(',');
      const files = await all(`SELECT * FROM artifacts WHERE job_id=? AND attempt_id=? AND id IN (${placeholders})`, id, active.attempt_id, ...ids);
      if (files.length !== ids.length) throw new ApiError(400, 'INVALID_ARTIFACTS', 'Every artifact must be uploaded by this active attempt');
      const status = active.phase === 'research' ? 'needs_review' : 'completed';
      const draft = active.phase === 'research' ? JSON.stringify(payload.draft) : active.draft;
      const previousMetadata = parse(active.metadata, {});
      const nextMetadata = { ...previousMetadata, ...(payload.metadata || {}) };
      if (active.phase === 'research') {
        if (Array.isArray(payload.metadata?.reviews)) nextMetadata.reviewsStale = false;
        else if (previousMetadata.reviews != null) nextMetadata.reviewsStale = true;
        else delete nextMetadata.reviewsStale;
      } else {
        // Rendering cannot re-review the draft or refresh inherited review evidence.
        for (const key of ['reviews', 'reviewsStale']) {
          if (Object.hasOwn(previousMetadata, key)) nextMetadata[key] = previousMetadata[key];
          else delete nextMetadata[key];
        }
      }
      const metadata = JSON.stringify(nextMetadata);
      // Both conditional statements execute in one D1 transaction. Cancellation cannot interleave.
      const results = await db.batch([
        prepare("UPDATE artifacts SET committed=0 WHERE job_id=? AND phase='render' AND attempt_id<>? AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status='running' AND phase='render' AND lease_hash=? AND lease_expires_at>?)", id, active.attempt_id, id, hash, now),
        prepare(`UPDATE artifacts SET committed=1 WHERE job_id=? AND attempt_id=? AND id IN (${placeholders}) AND EXISTS (SELECT 1 FROM jobs WHERE id=? AND status='running' AND lease_hash=? AND lease_expires_at>?)`, id, active.attempt_id, ...ids, id, hash, now),
        prepare(`UPDATE jobs SET status=?,stage=?,draft=?,metadata=?,revision=revision+1,error=NULL,lease_hash=NULL,lease_expires_at=NULL,updated_at=?
          WHERE id=? AND status='running' AND lease_hash=? AND lease_expires_at>?
          AND (SELECT count(*) FROM artifacts WHERE job_id=? AND attempt_id=? AND committed=1 AND id IN (${placeholders}))=? RETURNING *`,
        status, status, draft, metadata, now, id, hash, now, id, active.attempt_id, ...ids, ids.length),
      ]);
      if (!results[2].results?.[0]) throw staleLease();
      return serialize(results[2].results[0]);
    },
    async fail(id, leaseToken, code, message) {
      const { hash } = await lease(id, leaseToken); const now = clock();
      const value = await first("UPDATE jobs SET status='failed',stage='failed',error=?,revision=revision+1,lease_hash=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='running' AND lease_hash=? AND lease_expires_at>? RETURNING *", JSON.stringify({ code, message, recoverable: true }), now, id, hash, now);
      if (!value) throw staleLease();
      return serialize(value);
    },
  };
}
