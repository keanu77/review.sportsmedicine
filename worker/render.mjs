import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { render } from './renderer/render-hybrid.mjs';
import { generateHero } from './images.mjs';
import { withDisclaimer, rejectionsMarkdown, SHORT_DISCLAIMER } from '../shared/quality.mjs';
import { makeReel, defaultDuration } from './reel.mjs';

// Exported captions always end with the disclaimer, whatever the draft says.
export function exportTexts(draft) {
  return { 'fb-post.md': withDisclaimer(draft.post), 'ig-caption.md': withDisclaimer(draft.igCaption) };
}

export const OUTRO_CTA = '收藏起來，需要時再回來看';

// The QR code points at the paper itself: a DOI link is always live, unlike an unpublished article page.
export function sourceLink(paper) {
  if (paper.doi) return `https://doi.org/${encodeURI(paper.doi)}`;
  return /^https:\/\//.test(paper.sourceUrl ?? '') ? paper.sourceUrl : null;
}
export function outroBlock(paper) {
  const url = sourceLink(paper);
  return { cta: OUTRO_CTA, disclaimer: SHORT_DISCLAIMER, ...(url ? { qr: { url, label: '掃描看原始論文' } } : {}) };
}

export async function renderPackage({ draft, paper, design, rejections = [] }, directory, options = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const imageDirectory = options.imageDirectory ?? directory;
  const imageDesign = options.imageDirectory ? { palette: design.palette, imageStyle: design.imageStyle } : design;
  const hero = design.imageStyle === 'none' ? null : await generateHero(paper.title, imageDirectory, imageDesign, options);
  if (hero && imageDirectory !== directory) {
    await mkdir(path.join(directory, 'assets'), { recursive: true, mode: 0o700 });
    await copyFile(path.join(imageDirectory, hero), path.join(directory, hero));
    await copyFile(path.join(imageDirectory, 'generation-prompts.json'), path.join(directory, 'generation-prompts.json'));
  }
  const story = design.format === 'story';
  const pages = draft.pages.map((page, index) => ({ ...page, ...(story ? { duration: defaultDuration(index, draft.pages.length) } : {}), ...(hero && page.layout === 'cover' ? { image: hero, imageAlt: `${paper.title} 的 AI 生成情境示意，非真實病例`, caption: 'AI 生成情境示意' } : {}) }));
  const manifest = { version: 1, title: '運動醫學研究筆記', design: { ...design, imageStyle: design.imageStyle === 'none' ? 'photo' : design.imageStyle, brand: '吳易澄醫師｜運動醫學', footer: paper.doi ? `來源 doi:${paper.doi}` : `來源 ${paper.pmcid ?? paper.pmid}` }, pages,
    outro: outroBlock(paper),
    cover: { title: pages[0].title, subtitle: pages[0].subtitle ?? '', ...(hero ? { image: hero, imageAlt: pages[0].imageAlt, caption: 'AI 生成情境示意' } : {}) } };
  const manifestFile = path.join(directory, 'manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  const output = path.join(directory, 'rendered');
  const result = await render(manifestFile, output, { textOnly: !hero, signal: options.signal });
  const textFiles = {
    ...exportTexts(draft),
    // The doctor sees every primary finding the author overruled.
    'review-rejections.md': rejectionsMarkdown(rejections),
    'references.md': `${paper.citation}\n\n${paper.sourceUrl}\n\n授權紀錄：${paper.license ?? '未取得'}\n全文版本：${paper.version ?? '未取得'}\n`,
    'alt-text.md': pages.map((p, i) => `${i + 1}. ${p.title}。${p.subtitle ?? ''} ${p.imageAlt ?? ''} ${(p.cards ?? []).map(c => `${c.title}：${c.body}`).join(' ')}`).join('\n\n'),
  };
  const zip = {}, files = [];
  for (const [name, content] of Object.entries(textFiles)) { await writeFile(path.join(directory, name), content, { mode: 0o600 }); zip[name] = strToU8(content); files.push({ path: path.join(directory, name), name, contentType: 'text/markdown' }); }
  zip['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  for (const item of result.report.results) {
    const file = path.join(output, item.file); zip[item.file] = new Uint8Array(await readFile(file));
    files.push({ path: file, name: item.file.replace('/', '-'), contentType: 'image/png' });
  }
  if (hero) {
    zip[hero] = new Uint8Array(await readFile(path.join(directory, hero)));
    zip['generation-prompts.json'] = new Uint8Array(await readFile(path.join(directory, 'generation-prompts.json')));
  }
  if (story) {
    const reel = await makeReel(result.report, output, path.join(directory, 'reel.mp4'), { signal: options.signal, run: options.runProcess });
    zip['reel.mp4'] = new Uint8Array(await readFile(reel.file));
    files.push({ path: reel.file, name: 'reel.mp4', contentType: 'video/mp4' });
  }
  const publicReport = { ...result.report, manifest: 'manifest.json' };
  zip['render-report.json'] = strToU8(JSON.stringify(publicReport, null, 2));
  const zipFile = path.join(directory, 'social-materials.zip');
  await writeFile(zipFile, zipSync(zip, { level: 6 }), { mode: 0o600 });
  files.push({ path: zipFile, name: 'social-materials.zip', contentType: 'application/zip' });
  return { files, report: publicReport, manifest };
}
