#!/usr/bin/env node
import os from 'node:os';
import { antigravityStatus, reviewerStatus, configuredReviewers, assertSeats } from './reviewers.mjs';
import path from 'node:path';
import { readFile, mkdir, writeFile, statfs } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolvePaper, downloadPaper, loadPaper } from './paper.mjs';
import { generateDraft } from './draft.mjs';
import { reviewDraft } from './review.mjs';
import { renderPackage } from './render.mjs';
import { runProcess, modelEnvironment } from './process.mjs';
import { runWorker, workerConfig } from './client.mjs';
import { verifiedImage } from './images.mjs';
import { validateDesign } from '../shared/validation.mjs';

export async function doctor() {
  const checks = {};
  for (const [tool, args] of [['node',['--version']],['codex',['login','status']],['claude',['auth','status']],['grok',['--version']],['pdftotext',['-v']],['ffmpeg',['-version']]]) {
    try { const result = await runProcess(tool, args, { timeout: 15000, env: modelEnvironment() }); checks[tool] = { available: tool !== 'claude' || JSON.parse(result.stdout).loggedIn, detail: `${result.stdout}${result.stderr}`.trim().slice(0, 500) }; }
    catch (error) { checks[tool] = { available: false, detail: error.message }; }
  }
  try { const { chromium } = await import('@playwright/test'); const browser = await chromium.launch({ ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) }); await browser.close(); checks.renderer = { available: true }; }
  catch (error) { checks.renderer = { available: false, detail: error.message.slice(0, 300) }; }
  const workspace = path.resolve(process.env.REVIEW_WORKSPACE ?? path.join(os.homedir(), 'review-social-workspace'));
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const disk = await statfs(workspace); checks.workspace = { available: true, path: workspace, freeBytes: disk.bavail * disk.bsize };
  const providers = configuredReviewers();
  checks.reviewers = reviewerStatus(checks, await antigravityStatus(), providers);
  checks.imageGeneration = { available: false, detail: '需完成 image-probe 並設定 REVIEW_IMAGE_PROBE_DIR；CLI 存在不代表生圖已驗證' };
  if (process.env.REVIEW_IMAGE_PROBE_DIR) {
    try { const proof = await verifiedImage(path.resolve(process.env.REVIEW_IMAGE_PROBE_DIR)); checks.imageGeneration = { available: Boolean(checks.codex?.available), checkedAt: proof.generatedAt, sha256: proof.sha256, detail: '已完成生圖與檔案校驗；訂閱額度仍由服務端決定' }; }
    catch (error) { checks.imageGeneration.detail = error.message; }
  }
  return checks;
}

export async function main(args) {
  const [command, ...rest] = args;
  const option = (name, fallback) => { const index = rest.indexOf(name); if (index < 0) return fallback; if (!rest[index + 1] || rest[index + 1].startsWith('--')) throw new Error(`${name} 缺少值`); return rest[index + 1]; };
  if (command === 'doctor') { console.log(JSON.stringify(await doctor(), null, 2)); return; }
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('使用者停止工作程式'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (command === 'run') {
      const config = workerConfig();
      assertSeats(config.provider, configuredReviewers());
      const capabilities = await doctor();
      for (const required of [config.provider, 'pdftotext', 'renderer']) if (!capabilities[required]?.available) throw new Error(`${required} 尚未就緒：${capabilities[required]?.detail ?? '不支援此工具'}`);
      await runWorker(config, { once: rest.includes('--once'), signal: controller.signal, capabilities, refreshCapabilities: doctor }); return;
    }
    if (!['prepare','draft','render','image-probe'].includes(command)) throw new Error('用法：npm run worker -- doctor | run [--once] | prepare DOI --dir 路徑 | draft --dir 路徑 | render --dir 路徑 | image-probe --dir 路徑');
    const directory = path.resolve(option('--dir', process.env.REVIEW_WORKSPACE ?? path.join(os.homedir(), 'review-social-workspace', 'manual')));
    if (command === 'prepare') {
      const input = rest[0]; if (!input || input.startsWith('--')) throw new Error('prepare 需要 DOI／PMID／PMCID');
      const paper = await resolvePaper(input, { signal: controller.signal });
      const source = await downloadPaper(paper, directory, { signal: controller.signal });
      console.log(JSON.stringify({ title: source.paper.title, directory, pdf: source.pdfFile, xml: source.xmlFile, fullTextFormat: source.paper.fullTextFormat })); return;
    }
    if (command === 'draft') {
      const source = await loadPaper(directory, { signal: controller.signal });
      const draft = await generateDraft(source, directory, { signal: controller.signal, allowRetry: rest.includes('--retry') });
      const reviews = await reviewDraft(source, draft, directory, { signal: controller.signal, allowRetry: rest.includes('--retry-reviews') });
      console.log(JSON.stringify({ directory, pages: draft.pages.length, reviews: reviews.map(r => ({ provider: r.provider, status: r.status })) })); return;
    }
    const paper = JSON.parse(await readFile(path.join(directory, 'source.json'), 'utf8'));
    if (paper.fullTextVerified !== true) throw new Error('全文尚未完成來源核對，請先執行 prepare');
    if (command === 'render') {
      const saved = JSON.parse(await readFile(path.join(directory, 'draft.json'), 'utf8'));
      const design = validateDesign({ palette: option('--palette','blue'), style: option('--style','clinical'), imageStyle: option('--images','photo'), format: option('--format','portrait') });
      const output = path.resolve(option('--out', path.join(directory, `social-${Date.now()}`)));
      const result = await renderPackage({ draft: saved.draft ?? saved, paper, design }, output, { signal: controller.signal, allowRetry: rest.includes('--retry') });
      console.log(JSON.stringify({ directory: output, files: result.files.map(f => f.name) })); return;
    }
    if (command === 'image-probe') {
      const { generateHero } = await import('./images.mjs');
      const image = await generateHero(paper.title, directory, validateDesign({}), { signal: controller.signal, allowRetry: rest.includes('--retry') });
      await writeFile(path.join(directory, 'image-verified.json'), JSON.stringify({ image, at: new Date().toISOString() })); console.log(image); return;
    }
    throw new Error('用法：node worker/cli.mjs doctor | run [--once] | prepare DOI --dir 路徑 | draft --dir 路徑 | render --dir 路徑 [--images none|photo|illustration] [--format square|portrait] | image-probe --dir 路徑');
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
