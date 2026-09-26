#!/usr/bin/env node
import { readFile, realpath, stat, mkdir, mkdtemp, rename, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { PALETTES, STYLES, IMAGE_STYLES, FORMATS, FIT_RANGE, buildHTML, geometryCheck, autoFit } from './layout.mjs';
export { PALETTES, STYLES, IMAGE_STYLES, FORMATS, FIT_RANGE, buildHTML, geometryCheck, autoFit, statParts } from './layout.mjs';
const OWNER = 'fb-renew-hybrid-v1';
const exists = async target => access(target).then(() => true, () => false);
const text = (value, field, required = false) => {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${field} must be a nonempty string`);
};

export function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1) throw new Error('manifest.version must be 1');
  const d = manifest.design;
  if (!d || !Object.hasOwn(PALETTES, d.palette)) throw new Error('Invalid design.palette');
  for (const [key, values] of Object.entries({ style: STYLES, imageStyle: IMAGE_STYLES, format: Object.keys(FORMATS) })) {
    if (!values.includes(d[key])) throw new Error(`Invalid design.${key}`);
  }
  text(d.brand, 'design.brand', true); text(d.footer, 'design.footer'); text(manifest.title, 'title');
  if (!Array.isArray(manifest.pages) || !manifest.pages.length || manifest.pages.length > 30) throw new Error('pages must contain 1–30 pages');
  const ids = new Set();
  for (const [i, p] of manifest.pages.entries()) {
    if (!p || typeof p !== 'object') throw new Error(`pages[${i}] must be an object`);
    if (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(p.id) || ids.has(p.id)) throw new Error(`Invalid or duplicate page id at ${i}`);
    ids.add(p.id);
    if (!['cover', 'content', 'outro'].includes(p.layout)) throw new Error(`Invalid layout for ${p.id}`);
    validatePageText(p, p.id);
    if (p.cards !== undefined && (!Array.isArray(p.cards) || p.cards.length > 6)) throw new Error(`Invalid cards for ${p.id}`);
    for (const card of p.cards ?? []) { text(card.title, `${p.id}.card.title`, true); text(card.body, `${p.id}.card.body`, true); }
    if (p.duration !== undefined && (!Number.isFinite(p.duration) || p.duration <= 0 || p.duration > 120)) throw new Error(`Invalid duration for ${p.id}`);
  }
  if (manifest.cover !== undefined) validatePageText(manifest.cover, 'cover');
  if (manifest.outro !== undefined) {
    const o = manifest.outro;
    if (!o || typeof o !== 'object') throw new Error('outro must be an object');
    text(o.cta, 'outro.cta'); text(o.disclaimer, 'outro.disclaimer');
    if (o.qr !== undefined) {
      text(o.qr?.label, 'outro.qr.label', true);
      if (typeof o.qr.url !== 'string' || o.qr.url.length > 500 || !/^https:\/\/[^\s]+$/.test(o.qr.url)) throw new Error('outro.qr.url must be an https URL');
    }
  }
  return manifest;
}

function validatePageText(p, key) {
  text(p.title, `${key}.title`, true);
  for (const name of ['subtitle', 'image', 'imageAlt', 'caption']) text(p[name], `${key}.${name}`);
  if (p.image && !p.imageAlt?.trim()) throw new Error(`${key}.imageAlt is required when image is provided`);
  if (p.imageFit !== undefined && !['cover', 'contain'].includes(p.imageFit)) throw new Error(`${key}.imageFit must be cover or contain`);
  if (p.imagePosition !== undefined && (!p.imagePosition || ['x','y'].some(axis => !Number.isFinite(p.imagePosition[axis]) || p.imagePosition[axis] < 0 || p.imagePosition[axis] > 100))) throw new Error(`${key}.imagePosition requires x/y percentages from 0 to 100`);
}

export async function loadImage(filename, manifestDir) {
  if (!filename || path.isAbsolute(filename) || /^[a-z][a-z\d+.-]*:/i.test(filename)) throw new Error('Image must be a relative local path');
  const base = await realpath(manifestDir);
  const candidate = path.resolve(base, filename);
  const within = p => p.startsWith(`${base}${path.sep}`);
  if (!within(candidate)) throw new Error('Image path escapes manifest directory');
  const resolved = await realpath(candidate);
  if (!within(resolved)) throw new Error('Image symlink escapes manifest directory');
  const extension = path.extname(resolved).toLowerCase();
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extension];
  if (!mime || !(await stat(resolved)).isFile()) throw new Error('Image must be a PNG, JPEG, or WebP file');
  const bytes = await readFile(resolved);
  const signatureOK = mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!signatureOK) throw new Error('Image file signature does not match extension');
  return { data: `data:${mime};base64,${bytes.toString('base64')}`, source: filename };
}

function qrcode() {
  const local = createRequire(import.meta.url);
  try { return local('qrcode'); } catch (e) { if (e.code === 'MODULE_NOT_FOUND') throw new Error('QR code needs the qrcode package (npm install in the renderer repo)'); throw e; }
}
export async function qrSVG(url) {
  return qrcode().toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
}

function playwright() {
  if (process.env.FB_RENEW_PW_FROM) return createRequire(path.resolve(process.env.FB_RENEW_PW_FROM,'package.json'))('playwright');
  const local = createRequire(import.meta.url);
  try { return local('playwright'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  return createRequire(path.join(os.homedir(), '.claude/skills/fb-post/package.json'))('playwright');
}

export async function render(manifestPath, outputDir, { textOnly = false, signal } = {}) {
  signal?.throwIfAborted();
  const source = path.resolve(manifestPath);
  const manifest = validateManifest(JSON.parse(await readFile(source, 'utf8')));
  const base = path.dirname(source), out = path.resolve(outputDir);
  const pages = manifest.pages.map((page, index) => ({ page, index, wide: false, file: `series/page-${String(index+1).padStart(2,'0')}.png` }));
  if (manifest.cover) pages.push({ page: {...manifest.cover, layout:'cover'}, index:0, wide:true, file:'cover-1200x630.png' });
  // Resolve all assets before creating or replacing output.
  for (const item of pages) item.image = item.page.image && !textOnly ? await loadImage(item.page.image, base) : null;
  const qr = manifest.outro?.qr ? await qrSVG(manifest.outro.qr.url) : null;
  for (const item of pages) item.qr = qr;
  await mkdir(out, { recursive:true });
  const staging = await mkdtemp(path.join(out, '.hybrid-staging-'));
  await mkdir(path.join(staging,'series'));
  let browser;
  const abort = () => { if (browser) void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const launch = { headless:true };
    if (process.env.PW_CHANNEL) launch.channel = process.env.PW_CHANNEL;
    browser = await playwright().chromium.launch(launch);
    signal?.throwIfAborted();
    const context = await browser.newContext({ deviceScaleFactor:1 });
    await context.route('**/*', route => /^(data:|about:)/.test(route.request().url()) ? route.continue() : route.abort());
    const tab = await context.newPage();
    const results = [];
    for (const item of pages) {
      signal?.throwIfAborted();
      const width=item.wide?1200:1080, height=item.wide?630:FORMATS[manifest.design.format];
      await tab.setViewportSize({width,height});
      await tab.setContent(buildHTML(manifest,item.page,item), { waitUntil:'load' });
      await tab.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i=>i.decode())); });
      await tab.evaluate(source => { window.__geometryCheck = new Function(`return (${source})`)(); }, geometryCheck.toString());
      const headline = item.wide || item.page.layout === 'cover';
      const fit = await tab.evaluate(autoFit, { min: FIT_RANGE.min, max: item.wide ? 1 : headline ? FIT_RANGE.headline : FIT_RANGE.content });
      const checks = await tab.evaluate(geometryCheck);
      if (!checks.passed) throw new Error(`Page ${item.page.id ?? 'cover-1200x630'} fails layout: ${checks.issues.join('; ')}. Split or rewrite the page; no text was truncated.`);
      const png = await tab.screenshot({ path:path.join(staging,item.file), type:'png', animations:'disabled' });
      if (png.readUInt32BE(16)!==width || png.readUInt32BE(20)!==height) throw new Error('Unexpected screenshot pixel dimensions');
      results.push({id:item.page.id??'cover-1200x630',file:item.file,width,height,imageUsed:Boolean(item.image),imageSource:item.image?.source??null,duration:item.page.duration??null,fit,checks});
    }
    await browser.close(); browser=null;
    const report = { renderer:OWNER,createdAt:new Date().toISOString(),manifest:source,design:manifest.design,textOnly,results };
    await writeFile(path.join(staging,'render-report.json'),JSON.stringify(report,null,2)+'\n');
    await writeFile(path.join(staging,'series','.fb-renew-owned.json'),JSON.stringify({renderer:OWNER})+'\n');
    const names=['series','cover-1200x630.png','render-report.json'];
    const previous = await exists(path.join(out,'render-report.json')) ? JSON.parse(await readFile(path.join(out,'render-report.json'),'utf8')) : null;
    for (const name of names) if (await exists(path.join(out,name)) && previous?.renderer!==OWNER) throw new Error(`Refusing to replace unowned output: ${name}`);
    if (await exists(path.join(out,'series'))) {
      const marker = JSON.parse(await readFile(path.join(out,'series','.fb-renew-owned.json'),'utf8'));
      if (marker.renderer!==OWNER) throw new Error('Refusing to replace series without matching ownership marker');
    }
    const oldNames=[]; for(const name of names) if(await exists(path.join(out,name))) oldNames.push(name);
    let backup=null;
    const promoted=[],movedOldNames=[];
    signal?.throwIfAborted();
    try {
      if (oldNames.length) {
        backup=await mkdtemp(path.join(out,`.backup-${Date.now()}-`));
        for(const name of oldNames) {await rename(path.join(out,name),path.join(backup,name));movedOldNames.push(name);}
      }
      for(const name of names) if(await exists(path.join(staging,name))) {await rename(path.join(staging,name),path.join(out,name));promoted.push(name);}
    }
    catch (error) { for(const name of promoted) await rename(path.join(out,name),path.join(staging,name));if(backup)for(const name of movedOldNames)await rename(path.join(backup,name),path.join(out,name));throw error; }
    return { outputDir:out,backup,report };
  } finally { signal?.removeEventListener('abort', abort);if(browser)await browser.close();await rm(staging,{recursive:true,force:true}); }
}

// Compare real paths: skills run this file through a symlink (e.g. fb-renew/scripts/render-hybrid.mjs).
const invokedDirectly = () => { try { return Boolean(process.argv[1]) && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (invokedDirectly()) {
  const args=process.argv.slice(2),flags=args.filter(a=>a.startsWith('--')),positional=args.filter(a=>!a.startsWith('--'));
  if (positional.length!==2 || flags.some(f=>f!=='--text-only')) { console.error('Usage: node render-hybrid.mjs <manifest.json> <output-dir> [--text-only]');process.exitCode=1; }
  else render(...positional,{textOnly:flags.includes('--text-only')}).then(r=>console.log(JSON.stringify({outputDir:r.outputDir,backup:r.backup,pages:r.report.results.length,passed:true},null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
