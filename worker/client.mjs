import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolvePaper, downloadPaper, importManualPaper, loadPaper } from './paper.mjs';
import { generateDraft, reviseDraft } from './draft.mjs';
import { analysisText } from './xml.mjs';
import { sourceNumberSet, withDisclaimer } from '../shared/quality.mjs';
import { reviewDraft } from './review.mjs';
import { renderPackage } from './render.mjs';
import { retryTransfer } from './retry.mjs';
import { validateDraft, validateDesign, safeId } from '../shared/validation.mjs';

export function workerConfig(env = process.env) {
  const url = new URL(env.REVIEW_API_URL ?? 'https://review.sportsmedicine.tw');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) throw new Error('REVIEW_API_URL 必須是 HTTPS 網站 origin（本機測試可用 localhost）');
  if (!env.REVIEW_WORKER_TOKEN || env.REVIEW_WORKER_TOKEN.length < 32) throw new Error('請先設定 REVIEW_WORKER_TOKEN（至少 32 字元）');
  return { origin: url.origin, token: env.REVIEW_WORKER_TOKEN, workspace: path.resolve(env.REVIEW_WORKSPACE ?? path.join(os.homedir(), 'review-social-workspace')),
    workerId: env.REVIEW_WORKER_ID ?? os.hostname().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64), provider: env.REVIEW_MODEL_PROVIDER ?? 'codex', email: env.REVIEW_CONTACT_EMAIL };
}

export class WorkerAPI {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  async call(route, { data, body, method = 'POST', headers = {}, signal } = {}) {
    const timeout = AbortSignal.timeout(45000);
    const response = await this.fetcher(`${this.config.origin}/api/worker${route}`, {
      method, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${this.config.token}`, ...(body ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body ?? (data === undefined ? undefined : JSON.stringify(data)),
    });
    const bytes = await response.text();
    if (bytes.length > 2 * 1024 * 1024) throw new Error('任務 API 回應超過限制');
    let result; try { result = JSON.parse(bytes); } catch { throw new Error(`任務 API 未回傳 JSON（HTTP ${response.status}），請檢查部署與存取設定`); }
    if (!response.ok) throw Object.assign(new Error(result.error?.message ?? `HTTP ${response.status}`), { code: result.error?.code, status: response.status });
    return result;
  }
  // The owner-uploaded PDF is readable only with this attempt's lease.
  async source(job, leaseToken, signal) {
    const expected = job.metadata?.manualSource;
    if (!/^[a-f0-9]{64}$/.test(expected?.sha256 ?? '')) throw new Error('任務沒有有效的上傳全文紀錄');
    const timeout = AbortSignal.timeout(120000);
    const response = await this.fetcher(`${this.config.origin}/api/worker/jobs/${job.id}/source`, {
      method: 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${this.config.token}`, 'X-Lease-Token': leaseToken },
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { message = (await response.json()).error?.message ?? message; } catch {}
      throw Object.assign(new Error(message), { status: response.status });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) throw new Error('上傳檔案雜湊不符，請重新上傳 PDF');
    return bytes;
  }
  async upload(job, leaseToken, file, signal) {
    const bytes = await readFile(file.path), hash = createHash('sha256').update(bytes).digest('hex');
    const id = randomUUID();
    const { artifact } = await retryTransfer(() => this.call(`/jobs/${job.id}/files/${id}`, { method: 'PUT', body: bytes, signal, headers: {
      'Content-Type': file.contentType, 'X-Lease-Token': leaseToken, 'X-File-Name': encodeURIComponent(file.name), 'X-Content-SHA256': hash,
    } }), { signal });
    if (artifact.sha256 !== hash || artifact.size !== bytes.length) throw new Error('上傳檔案校驗不符');
    return artifact.id;
  }
}

export function sourceArtifacts(source) {
  return [
    ...(source.pdfFile ? [{ path: source.pdfFile, name: 'paper.pdf', contentType: 'application/pdf' }] : []),
    ...(source.xmlFile ? [{ path: source.xmlFile, name: 'paper.xml', contentType: 'application/xml' }] : []),
    ...(source.structuredFile ? [{ path: source.structuredFile, name: 'paper-structured.json', contentType: 'application/json' }] : []),
    { path: source.metadataFile, name: 'source.json', contentType: 'application/json' },
  ];
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Delete local folders of jobs the owner deleted. Only UUID folders the server
// explicitly reports as unknown are removed; any API failure removes nothing.
export async function pruneWorkspace(api, workspace, { signal } = {}) {
  const local = (await readdir(workspace, { withFileTypes: true })).filter(entry => entry.isDirectory() && JOB_ID.test(entry.name)).map(entry => entry.name);
  if (!local.length) return [];
  const { unknown } = await api.call('/workspace/unknown', { data: { ids: local.slice(0, 500) }, signal });
  const removable = (Array.isArray(unknown) ? unknown : []).filter(id => local.includes(id));
  for (const id of removable) await rm(path.join(workspace, id), { recursive: true, force: true });
  return removable;
}

// An owner restart discards cached source and model output once per request.
export async function prepareResearchDirectory(directory, restartRequest) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!restartRequest) return;
  const id = safeId(restartRequest.id, 'restart request');
  const marker = path.join(directory, '.restart-request');
  let handled = null; try { handled = await readFile(marker, 'utf8'); } catch {}
  if (handled === id) return;
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(marker, id, { mode: 0o600 });
}

export async function processJob(api, claimed, config, { signal, onStage = console.log } = {}) {
  const { job, leaseToken } = claimed;
  safeId(job.id, 'job id');
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const jobDir = path.join(config.workspace, job.id);
  await mkdir(jobDir, { recursive: true, mode: 0o700 });
  let stage = 'starting', heartbeatBusy = false;
  const heartbeat = async () => {
    if (heartbeatBusy || combined.aborted) return;
    heartbeatBusy = true;
    try { await api.call(`/jobs/${job.id}/heartbeat`, { data: { leaseToken, stage }, signal: combined }); }
    catch (error) { controller.abort(error); }
    finally { heartbeatBusy = false; }
  };
  const update = async value => { combined.throwIfAborted(); stage = value; onStage(`${job.id}: ${stage}`); await heartbeat(); combined.throwIfAborted(); };
  const timer = setInterval(heartbeat, 30000);
  try {
    let files, result;
    if (job.phase === 'research' && job.metadata?.reviseRequest?.id) {
      // Owner-requested revision of the saved draft against the verified local source.
      const request = job.metadata.reviseRequest, directory = path.join(jobDir, 'research');
      await update('revising');
      let source;
      try { source = await loadPaper(directory, { signal: combined }); }
      catch (error) { if (combined.aborted) throw error; throw new Error(`Mac 上找不到這篇的已核對全文（${error.message}）；請改用「從頭重跑」`); }
      const draft = validateDraft(await reviseDraft(source, validateDraft(job.draft), request, directory, { provider: config.provider, signal: combined, allowRetry: true }));
      const notesFile = path.join(directory, `revision-${request.id}.md`);
      await writeFile(notesFile, `# 草稿修訂\n\n${request.findings.map(f => `- [${f.provider}] ${f.claim}：${f.suggestion}`).join('\n') || '- 無採納的審核意見'}\n\n醫師補充：${request.instructions || '無'}\n`, { mode: 0o600 });
      result = { draft, metadata: { paper: source.paper, sourceNumbers: sourceNumberSet(analysisText(source).text), reviseRequest: null, lastRevision: { id: request.id, completedAt: new Date().toISOString(), findings: request.findings.length } } };
      // Revised research replaces the earlier research files, so carry the earlier notes and reviews forward.
      const kept = [];
      for (const [name, contentType] of [['research-notes.md', 'text/markdown'], ['reviews.json', 'application/json']]) {
        try { await access(path.join(directory, name)); kept.push({ path: path.join(directory, name), name, contentType }); } catch {}
      }
      files = [...sourceArtifacts(source), ...kept, { path: notesFile, name: 'revision-notes.md', contentType: 'text/markdown' }];
    } else if (job.phase === 'research') {
      const directory = path.join(jobDir, 'research');
      await prepareResearchDirectory(directory, job.metadata?.restartRequest);
      await update('resolving');
      const manual = job.metadata?.manualSource;
      const paper = await resolvePaper(job.input, { email: config.email, title: job.title && job.title !== job.input ? job.title : undefined, signal: combined, requireFullText: !manual });
      await update('downloading');
      const source = manual ? await importManualPaper(paper, directory, await api.source(job, leaseToken, combined), manual, { signal: combined })
        : await downloadPaper(paper, directory, { signal: combined });
      await update('drafting');
      // A newly queued retry is an explicit owner action; never independently requeue model work.
      const generated = validateDraft(await generateDraft(source, directory, { provider: config.provider, signal: combined, allowRetry: true }));
      const draft = { ...generated, post: withDisclaimer(generated.post), igCaption: withDisclaimer(generated.igCaption) };
      await update('reviewing');
      const reviews = await reviewDraft(source, draft, directory, { signal: combined });
      const notesFile = path.join(directory, 'research-notes.md');
      await writeFile(notesFile, `${draft.notes}\n\n## 主張與出處\n\n${draft.claims.map(c => `- ${c.text}\n  - ${c.locator}：${c.quote}`).join('\n')}`, { mode: 0o600 });
      result = { draft, metadata: { paper: source.paper, reviews, draftProvider: config.provider, sourceNumbers: sourceNumberSet(analysisText(source).text) } };
      files = [...sourceArtifacts(source),
        { path: notesFile, name: 'research-notes.md', contentType: 'text/markdown' }, { path: path.join(directory, 'reviews.json'), name: 'reviews.json', contentType: 'application/json' }];
    } else if (job.phase === 'review') {
      const request = job.metadata?.reviewRequest;
      safeId(request?.runId, 'review run id');
      await update('reviewing');
      const source = await loadPaper(path.join(jobDir, 'research'), { signal: combined });
      const expected = job.metadata?.paper;
      if (!expected?.fullTextVerified || ![expected.xmlSha256, expected.sha256].some(Boolean)
        || ['doi','pmid','pmcid','xmlSha256','sha256'].some(key => expected[key] && expected[key] !== source.paper[key])) {
        throw new Error('本機全文與這次審核指定的來源版本不符，請先恢復原始全文');
      }
      const draft = validateDraft(job.draft);
      const directory = path.join(jobDir, 'reviews', request.runId);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // A new owner request has a unique run directory; retry can reuse a known result.
      const reviews = await reviewDraft(source, draft, directory, { signal: combined, allowRetry: true });
      result = { metadata: { reviews } };
      files = [{ path: path.join(directory, 'reviews.json'), name: 'reviews.json', contentType: 'application/json' }];
    } else if (job.phase === 'render') {
      const draft = validateDraft(job.draft), design = validateDesign(job.design);
      if (!job.metadata?.paper?.fullTextVerified) throw new Error('缺少已驗證的全文紀錄');
      await update(design.imageStyle === 'none' ? 'rendering' : 'generating_image');
      const fingerprint = createHash('sha256').update(JSON.stringify({ draft, design, source: { pdf: job.metadata.paper.sha256, xml: job.metadata.paper.xmlSha256 } })).digest('hex').slice(0, 24);
      const directory = path.join(jobDir, 'versions', fingerprint);
      const imageFingerprint = createHash('sha256').update(JSON.stringify({ title: job.metadata.paper.title, palette: design.palette, imageStyle: design.imageStyle })).digest('hex').slice(0, 24);
      const rendered = await renderPackage({ draft, paper: job.metadata.paper, design }, directory, { signal: combined, allowRetry: true, imageDirectory: path.join(jobDir, 'images', imageFingerprint) });
      files = rendered.files;
      result = { metadata: { render: { version: fingerprint, revision: job.revision, design, checkedAt: new Date().toISOString(), pageCount: rendered.report.results.length } } };
    } else throw new Error('不支援的工作階段');
    await update('uploading');
    const artifacts = [];
    for (const file of files) { combined.throwIfAborted(); artifacts.push(await api.upload(job, leaseToken, file, combined)); }
    await api.call(`/jobs/${job.id}/complete`, { data: { leaseToken, ...result, artifacts }, signal: combined });
    onStage(`${job.id}: completed ${job.phase}`);
  } catch (error) {
    // The server rejects this if cancellation/expiry already revoked our lease.
    try { await api.call(`/jobs/${job.id}/fail`, { data: { leaseToken, code: combined.aborted ? 'WORKER_INTERRUPTED' : error.failureCode ?? 'PROCESSING_FAILED', message: error.message.slice(0, 1800) } }); } catch {}
    throw error;
  } finally { clearInterval(timer); controller.abort(new Error('工作執行結束')); }
}

const PRUNE_INTERVAL_MS = 6 * 3600000;
const CAPABILITY_REFRESH_MS = 30 * 60000;
export async function runWorker(config, { once = false, signal, onStage = console.log, capabilities: initialCapabilities = {}, refreshCapabilities } = {}) {
  // Re-check periodically so a reviewer login on the Mac shows up without restarting the worker.
  let capabilities = initialCapabilities, lastCapabilityCheck = Date.now();
  await mkdir(config.workspace, { recursive: true, mode: 0o700 });
  const api = new WorkerAPI(config);
  let lastExpiryWarning = 0, lastPrune = 0;
  while (!signal?.aborted) {
    if (Date.now() - lastPrune > PRUNE_INTERVAL_MS) {
      lastPrune = Date.now();
      try { const removed = await pruneWorkspace(api, config.workspace, { signal }); if (removed.length) onStage(`已清除 ${removed.length} 個已刪除任務的本機資料`); }
      catch (error) { if (signal?.aborted) break; onStage(`本機資料清理略過：${error.message}`); }
    }
    if (refreshCapabilities && Date.now() - lastCapabilityCheck > CAPABILITY_REFRESH_MS) {
      lastCapabilityCheck = Date.now();
      try { capabilities = await refreshCapabilities(); } catch (error) { onStage(`能力檢查略過：${error.message}`); }
    }
    try {
      const claimed = await api.call('/claim', { data: { workerId: config.workerId, capabilities: { ...capabilities, draftProvider: config.provider, reviewDraft: true } }, signal });
      if (Date.parse(claimed.credentialExpiresAt) - Date.now() <= 14 * 86400000 && Date.now() - lastExpiryWarning > 86400000) {
        onStage(`連線憑證將於 ${claimed.credentialExpiresAt} 到期；請依 docs/worker-credentials.md 輪替。`);
        lastExpiryWarning = Date.now();
      }
      if (claimed.job) await processJob(api, claimed, config, { signal, onStage });
      else onStage('等待網站任務');
    } catch (error) { if (signal?.aborted) break; onStage(`工作未完成：${error.message}`); if (once) throw error; }
    if (once) break;
    try { await delay(30000, undefined, { signal }); } catch { break; }
  }
}
