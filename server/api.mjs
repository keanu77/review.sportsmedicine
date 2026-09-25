import { authenticateOwner, authenticateWorker, requireOrigin, workerCredentials } from './auth.mjs';
import { ApiError } from './errors.mjs';
import { createStore, MAX_ATTEMPT_FILES } from './store.mjs';
import { downloadHeaders, readLimited, validateUpload } from './files.mjs';
import { normalizeInput, record, safeId, text, validateDesign, validateDraft, validateMetadata, validateRevision, ValidationError } from '../shared/validation.mjs';

const privateHeaders = {
  'Cache-Control': 'no-store, private, max-age=0', Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  Vary: 'Cf-Access-Jwt-Assertion, Authorization, Cookie',
};
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' } }); }
async function body(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json');
  try { return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readLimited(request, 512 * 1024))), 'request'); }
  catch (error) { if (error instanceof ApiError || error instanceof ValidationError) throw error; throw new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON'); }
}
function storage(env) {
  if (!env.ARTIFACTS) throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'Artifact storage is not configured');
  return env.ARTIFACTS;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Removes every object under a job prefix, including files from failed or replaced attempts.
async function deletePrefix(bucket, prefix) {
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    const keys = page.objects.map(object => object.key);
    if (keys.length) await bucket.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
function fileIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ATTEMPT_FILES || new Set(value).size !== value.length) throw new ValidationError(`artifacts must contain 1–${MAX_ATTEMPT_FILES} unique file IDs`);
  return value.map((id) => safeId(id, 'file id'));
}
/** Test hooks are only supplied by import callers; Pages entrypoints never supply them. */
export async function handleApi(request, env, { keyResolver, clock = Date.now } = {}) {
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/(private|worker)(\/.*)?$/);
    if (!match) throw new ApiError(404, 'NOT_FOUND', 'Unknown API route');
    const role = match[1]; const path = match[2] || '/'; const method = request.method;
    let owner, worker;
    if (role === 'private') {
      owner = await authenticateOwner(request, env, keyResolver);
      if (!['GET', 'HEAD'].includes(method)) requireOrigin(request, env);
    } else {
      // Historical Pages deployment aliases retain their environment snapshots.
      // Only the canonical app origin may use worker credentials, including old
      // deployment snapshots after their custom domain points to a newer build.
      let canonical;
      try { canonical = new URL(env.APP_ORIGIN); } catch {}
      if (!canonical || canonical.origin !== env.APP_ORIGIN || canonical.username || canonical.password
        || !(canonical.protocol === 'https:' || canonical.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(canonical.hostname))) throw new ApiError(503, 'WORKER_NOT_CONFIGURED', 'Canonical worker origin is not configured');
      if (url.origin !== canonical.origin) throw new ApiError(403, 'WORKER_ORIGIN_REJECTED', 'Worker API is available only on its canonical origin');
      worker = await authenticateWorker(request, env, clock());
    }
    if (!env.DB) throw new ApiError(503, 'DATABASE_NOT_CONFIGURED', 'Job storage is not configured');
    const store = createStore(env.DB, clock);
    if (role === 'private') {
      await store.expire();
      if (path === '/session' && method === 'GET') {
        let workerCredentialExpiresAt = null;
        try { workerCredentialExpiresAt = workerCredentials(env)[0].expiresAt; } catch { /* Owner access survives a revoked/misconfigured worker. */ }
        return json({ email: owner.email, worker: await store.presence(), workerCredentialExpiresAt });
      }
      if (path === '/jobs') {
        if (method === 'GET') return json({ jobs: await store.list() });
        if (method === 'POST') {
          const data = await body(request);
          return json({ job: await store.create({ input: normalizeInput(data.input), title: data.title === undefined ? '' : text(data.title, 'title', 1000, { empty: true }), design: validateDesign(data.design) }) }, 201);
        }
      }
      const versionsPath = path.match(/^\/jobs\/([^/]+)\/versions(?:\/(\d+))?$/);
      if (versionsPath && method === 'GET') {
        const id = safeId(versionsPath[1]);
        return versionsPath[2] ? json({ version: await store.version(id, validateRevision(Number(versionsPath[2]))) })
          : json({ versions: await store.versions(id, url.searchParams.has('before') ? validateRevision(Number(url.searchParams.get('before'))) : undefined) });
      }
      const reviewsPath = path.match(/^\/jobs\/([^/]+)\/reviews(?:\/([^/]+)\/findings\/(claude|gemini|grok)\/(\d+))?$/);
      if (reviewsPath) {
        const id = safeId(reviewsPath[1]);
        if (!reviewsPath[2] && method === 'GET') return json({ runs: await store.reviews(id) });
        if (reviewsPath[2] && method === 'PATCH') {
          const data = await body(request);
          if (!['pending','resolved','rejected'].includes(data.status)) throw new ValidationError('Invalid finding status');
          const reason = text(data.reason ?? '', 'reason', 2000, { empty: data.status !== 'rejected' });
          await store.disposition(id, safeId(reviewsPath[2]), reviewsPath[3], Number(reviewsPath[4]), data.status, reason);
          return json({ runs: await store.reviews(id) });
        }
      }
      const jobPath = path.match(/^\/jobs\/([^/]+)(?:\/(draft|render|cancel|retry|restore|review|restart|claims|revise))?$/);
      if (jobPath) {
        const id = safeId(jobPath[1]); const action = jobPath[2];
        if (!action && method === 'GET') return json({ job: await store.get(id) });
        if (!action && method === 'DELETE') {
          await store.remove(id, validateRevision(Number(url.searchParams.get('revision'))));
          // Database rows go first so a storage failure never leaves a job pointing at missing files.
          await deletePrefix(storage(env), `jobs/${id}/`);
          return json({ deleted: id });
        }
        if (!action && method === 'PATCH') {
          const data = await body(request);
          const { job, droppedKey } = await store.updateIdentity(id, validateRevision(data.revision), normalizeInput(data.input), data.title === undefined ? '' : text(data.title, 'title', 1000, { empty: true }));
          if (droppedKey) await storage(env).delete(droppedKey).catch(() => {});
          return json({ job });
        }
        if (action === 'restart' && method === 'POST') {
          const data = await body(request);
          return json({ job: await store.restart(id, validateRevision(data.revision)) });
        }
        if (action === 'draft' && method === 'PATCH') {
          const data = await body(request);
          return json({ job: await store.edit(id, validateRevision(data.revision), validateDraft(data.draft), null, data.checkpoint === true) });
        }
        if (action === 'restore' && method === 'POST') {
          const data = await body(request);
          return json({ job: await store.restore(id, validateRevision(data.revision), validateRevision(data.version)) });
        }
        if (action === 'review' && method === 'POST') {
          const data = await body(request);
          return json({ job: await store.review(id, validateRevision(data.revision)) });
        }
        if (action === 'render' && method === 'POST') {
          const data = await body(request);
          const revision = validateRevision(data.revision), design = validateDesign(data.design);
          const accepted = await store.gate(id, revision, data.acceptWarnings === true);
          return json({ job: await store.render(id, revision, design, accepted) });
        }
        if (action === 'claims' && method === 'PATCH') {
          const data = await body(request);
          if (typeof data.key !== 'string' || !/^[0-9a-f]{16}$/.test(data.key)) throw new ValidationError('Invalid claim key');
          if (!['locked', 'rejected', 'pending'].includes(data.status)) throw new ValidationError('Invalid claim status');
          const note = data.note === undefined ? '' : text(data.note, 'note', 500, { empty: true });
          return json({ job: await store.decideClaim(id, data.key, data.status, note) });
        }
        if (action === 'revise' && method === 'POST') {
          const data = await body(request);
          const revision = validateRevision(data.revision);
          if (!Array.isArray(data.findings) || data.findings.length > 20 || !data.findings.every(ref => ['claude', 'gemini', 'grok'].includes(ref?.provider) && Number.isInteger(ref.index) && ref.index >= 0 && ref.index < 100)) throw new ValidationError('findings must list up to 20 reviewer findings');
          const instructions = data.instructions === undefined ? '' : text(data.instructions, 'instructions', 1000, { empty: true });
          if (!data.findings.length && !instructions.trim()) throw new ValidationError('Choose findings or describe the change');
          return json({ job: await store.revise(id, revision, data.findings, instructions.trim()) });
        }
        if (action === 'cancel' && method === 'POST') return json({ job: await store.cancel(id) });
        if (action === 'retry' && method === 'POST') return json({ job: await store.retry(id) });
      }
      const sourcePath = path.match(/^\/jobs\/([^/]+)\/source$/);
      if (sourcePath && method === 'PUT') {
        const id = safeId(sourcePath[1]); const revision = validateRevision(Number(url.searchParams.get('revision')));
        const previousKey = await store.manualSourceTarget(id, revision);
        if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new ApiError(415, 'PDF_REQUIRED', 'Upload the article as a PDF');
        if (!/^[a-f0-9]{64}$/i.test(request.headers.get('X-Content-SHA256') || '')) throw new ApiError(400, 'CHECKSUM_REQUIRED', 'Provide the PDF SHA-256');
        const file = await validateUpload(request);
        const bucket = storage(env), key = `jobs/${id}/manual/${crypto.randomUUID()}`;
        await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.contentType }, customMetadata: { sha256: file.sha256 }, sha256: file.sha256 });
        let job;
        try { job = await store.attachManualSource(id, revision, { key, name: file.name, size: file.size, sha256: file.sha256, uploadedAt: new Date(clock()).toISOString() }); }
        catch (error) { await bucket.delete(key).catch(() => {}); throw error; }
        if (previousKey && previousKey !== key) await bucket.delete(previousKey).catch(() => {});
        return json({ job });
      }
      if (sourcePath && method === 'DELETE') {
        const { job, key } = await store.detachManualSource(safeId(sourcePath[1]), validateRevision(Number(url.searchParams.get('revision'))));
        await storage(env).delete(key).catch(() => {});
        return json({ job });
      }
      const filePath = path.match(/^\/jobs\/([^/]+)\/files\/([^/]+)$/);
      if (filePath && method === 'GET') {
        const artifact = await store.artifact(safeId(filePath[1]), safeId(filePath[2], 'file id'));
        const object = await storage(env).get(artifact.object_key);
        if (!object) throw new ApiError(404, 'ARTIFACT_MISSING', 'The stored artifact is unavailable');
        if (object.size !== artifact.size || object.customMetadata?.sha256 !== artifact.sha256) throw new ApiError(502, 'ARTIFACT_INTEGRITY', 'Stored artifact integrity could not be verified');
        return new Response(object.body, { headers: { ...privateHeaders, ...downloadHeaders(artifact, url.searchParams.get('inline') === '1') } });
      }
    } else {
      if (path === '/health' && method === 'GET') return json({ ok: true, activeJobs: await store.activeJobs(), credentialExpiresAt: worker.expiresAt });
      if (path === '/workspace/unknown' && method === 'POST') {
        const data = await body(request);
        if (!Array.isArray(data.ids) || data.ids.length > 500 || !data.ids.every(id => typeof id === 'string' && UUID.test(id))) throw new ValidationError('ids must be at most 500 job UUIDs');
        return json({ unknown: await store.unknownJobs([...new Set(data.ids)]) });
      }
      if (path === '/claim' && method === 'POST') {
        const data = await body(request);
        const capabilities = data.capabilities ?? {};
        if ((!Array.isArray(capabilities) && (typeof capabilities !== 'object' || !capabilities)) || JSON.stringify(capabilities).length > 16384) throw new ValidationError('capabilities must be a small object or array');
        return json({ ...await store.claim(safeId(data.workerId, 'workerId'), capabilities), credentialExpiresAt: worker.expiresAt });
      }
      const sourcePath = path.match(/^\/jobs\/([^/]+)\/source$/);
      if (sourcePath && method === 'GET') {
        const id = safeId(sourcePath[1]);
        const { row: active } = await store.lease(id, request.headers.get('X-Lease-Token'));
        const source = JSON.parse(active.metadata || '{}').manualSource;
        // Only this job's owner-upload prefix is readable, whatever metadata claims.
        if (!source?.key?.startsWith(`jobs/${id}/manual/`)) throw new ApiError(404, 'NOT_FOUND', 'This job has no uploaded source');
        const object = await storage(env).get(source.key);
        if (!object) throw new ApiError(404, 'ARTIFACT_MISSING', 'The uploaded source is unavailable');
        if (object.size !== source.size || object.customMetadata?.sha256 !== source.sha256) throw new ApiError(502, 'ARTIFACT_INTEGRITY', 'Uploaded source integrity could not be verified');
        return new Response(object.body, { headers: { ...privateHeaders, 'Content-Type': 'application/pdf', 'Content-Length': String(source.size), 'X-Content-SHA256': source.sha256 } });
      }
      const filePath = path.match(/^\/jobs\/([^/]+)\/files\/([^/]+)$/);
      if (filePath && method === 'PUT') {
        const id = safeId(filePath[1]); const fileId = safeId(filePath[2], 'file id');
        const leaseToken = request.headers.get('X-Lease-Token');
        const { row: active } = await store.lease(id, leaseToken);
        const bucket = storage(env);
        const file = await validateUpload(request);
        const artifact = { ...file, id: fileId };
        const existing = await store.matchingUpload(id, leaseToken, artifact);
        if (existing) return json({ artifact: existing });
        const key = `jobs/${id}/${active.attempt_id}/${crypto.randomUUID()}`;
        await bucket.put(key, file.bytes, { httpMetadata: { contentType: file.contentType }, customMetadata: { sha256: file.sha256 }, sha256: file.sha256 });
        try { return json({ artifact: await store.registerArtifact(id, leaseToken, { ...artifact, key }) }, 201); }
        catch (error) {
          await bucket.delete(key).catch(() => {});
          // A concurrent retry may have registered identical bytes first. Only
          // return that winner while this exact attempt's lease remains valid.
          if (error instanceof ApiError && error.code === 'UPLOAD_CONFLICT') {
            const winner = await store.matchingUpload(id, leaseToken, artifact);
            if (winner) return json({ artifact: winner });
          }
          throw error;
        }
      }
      const jobPath = path.match(/^\/jobs\/([^/]+)\/(heartbeat|complete|fail)$/);
      if (jobPath && method === 'POST') {
        const id = safeId(jobPath[1]); const action = jobPath[2]; const data = await body(request);
        if (action === 'heartbeat') return json(await store.heartbeat(id, data.leaseToken, text(data.stage, 'stage', 120)));
        if (action === 'fail') return json({ job: await store.fail(id, data.leaseToken, safeId(data.code, 'error code'), text(data.message, 'error message', 2000)) });
        const { row: active } = await store.lease(id, data.leaseToken);
        if ((active.phase === 'render' || active.review_requested) && data.draft !== undefined) throw new ValidationError('Rendering and review may not replace their saved draft');
        if (active.review_requested && !Array.isArray(data.metadata?.reviews)) throw new ValidationError('A review must return reviewer results');
        const draft = active.phase === 'research' && !active.review_requested ? validateDraft(data.draft) : undefined;
        return json({ job: await store.complete(id, data.leaseToken, { artifacts: fileIds(data.artifacts), draft, metadata: validateMetadata(data.metadata) }) });
      }
    }
    throw new ApiError(404, 'NOT_FOUND', 'Unknown API route or method');
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, 400);
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
    // Database and storage errors may contain private identifiers; never serialize them.
    console.error('Private API failure:', error?.name || 'Error');
    return json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed; check server logs before retrying work' } }, 500);
  }
}
