import { authenticateOwner, authenticateWorker, requireOrigin } from './auth.mjs';
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
    let owner;
    if (role === 'private') {
      owner = await authenticateOwner(request, env, keyResolver);
      if (!['GET', 'HEAD'].includes(method)) requireOrigin(request, env);
    } else await authenticateWorker(request, env);
    if (!env.DB) throw new ApiError(503, 'DATABASE_NOT_CONFIGURED', 'Job storage is not configured');
    const store = createStore(env.DB, clock);
    if (role === 'private') {
      await store.expire();
      if (path === '/session' && method === 'GET') return json({ email: owner.email, worker: await store.presence() });
      if (path === '/jobs') {
        if (method === 'GET') return json({ jobs: await store.list() });
        if (method === 'POST') {
          const data = await body(request);
          return json({ job: await store.create({ input: normalizeInput(data.input), title: data.title === undefined ? '' : text(data.title, 'title', 1000, { empty: true }), design: validateDesign(data.design) }) }, 201);
        }
      }
      const jobPath = path.match(/^\/jobs\/([^/]+)(?:\/(draft|render|cancel|retry))?$/);
      if (jobPath) {
        const id = safeId(jobPath[1]); const action = jobPath[2];
        if (!action && method === 'GET') return json({ job: await store.get(id) });
        if (action === 'draft' && method === 'PATCH') {
          const data = await body(request);
          return json({ job: await store.edit(id, validateRevision(data.revision), validateDraft(data.draft)) });
        }
        if (action === 'render' && method === 'POST') {
          const data = await body(request);
          return json({ job: await store.render(id, validateRevision(data.revision), validateDesign(data.design)) });
        }
        if (action === 'cancel' && method === 'POST') return json({ job: await store.cancel(id) });
        if (action === 'retry' && method === 'POST') return json({ job: await store.retry(id) });
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
      if (path === '/claim' && method === 'POST') {
        const data = await body(request);
        const capabilities = data.capabilities ?? {};
        if ((!Array.isArray(capabilities) && (typeof capabilities !== 'object' || !capabilities)) || JSON.stringify(capabilities).length > 16384) throw new ValidationError('capabilities must be a small object or array');
        return json(await store.claim(safeId(data.workerId, 'workerId'), capabilities));
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
        if (active.phase === 'render' && data.draft !== undefined) throw new ValidationError('A render may not replace its approved draft');
        const draft = active.phase === 'research' ? validateDraft(data.draft) : undefined;
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
