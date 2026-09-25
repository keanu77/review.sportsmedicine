import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolvePaper, downloadPaper, importManualPaper, loadPaper } from './paper.mjs';
import { generateDraft } from './draft.mjs';
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
    if (job.phase === 'research') {
      const directory = path.join(jobDir, 'research');
      await update('resolving');
      const manual = job.metadata?.manualSource;
      const paper = await resolvePaper(job.input, { email: config.email, title: job.title && job.title !== job.input ? job.title : undefined, signal: combined, requireFullText: !manual });
      await update('downloading');
      const source = manual ? await importManualPaper(paper, directory, await api.source(job, leaseToken, combined), manual, { signal: combined })
        : await downloadPaper(paper, directory, { signal: combined });
      await update('drafting');
      // A newly queued retry is an explicit owner action; never independently requeue model work.
      const draft = validateDraft(await generateDraft(source, directory, { provider: config.provider, signal: combined, allowRetry: true }));
      await update('reviewing');
      const reviews = await reviewDraft(source, draft, directory, { signal: combined });
      const notesFile = path.join(directory, 'research-notes.md');
      await writeFile(notesFile, `${draft.notes}\n\n## 主張與出處\n\n${draft.claims.map(c => `- ${c.text}\n  - ${c.locator}：${c.quote}`).join('\n')}`, { mode: 0o600 });
      result = { draft, metadata: { paper: source.paper, reviews, draftProvider: config.provider } };
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

export async function runWorker(config, { once = false, signal, onStage = console.log, capabilities = {} } = {}) {
  await mkdir(config.workspace, { recursive: true, mode: 0o700 });
  const api = new WorkerAPI(config);
  let lastExpiryWarning = 0;
  while (!signal?.aborted) {
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
