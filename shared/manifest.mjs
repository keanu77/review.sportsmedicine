// Renderer manifest for one paper draft, shared by the Mac worker and the
// workbench live preview so both lay out exactly the same pages. Pure: no I/O.
import { SHORT_DISCLAIMER } from './quality.mjs';

export const OUTRO_CTA = '收藏起來，需要時再回來看';
export const BRAND = '吳易澄醫師｜運動醫學';
// Reel timing: a 3 s hook, 6 s per point and 5 s for the outro with its QR code.
export const defaultDuration = (index, total) => index === 0 ? 3 : index === total - 1 ? 5 : 6;

// The QR code points at the paper itself: a DOI link is always live, unlike an unpublished article page.
export function sourceLink(paper) {
  if (paper?.doi) return `https://doi.org/${encodeURI(paper.doi)}`;
  return /^https:\/\//.test(paper?.sourceUrl ?? '') ? paper.sourceUrl : null;
}
export function outroBlock(paper) {
  const url = sourceLink(paper);
  return { cta: OUTRO_CTA, disclaimer: SHORT_DISCLAIMER, ...(url ? { qr: { url, label: '掃描看原始論文' } } : {}) };
}

export function buildManifest({ draft, paper = {}, design, hero = null }) {
  const story = design.format === 'story';
  const pages = draft.pages.map((page, index) => ({ ...page, ...(story ? { duration: defaultDuration(index, draft.pages.length) } : {}),
    ...(hero && page.layout === 'cover' ? { image: hero, imageAlt: `${paper.title} 的 AI 生成情境示意，非真實病例`, caption: 'AI 生成情境示意' } : {}) }));
  const source = paper.doi ? `doi:${paper.doi}` : paper.pmcid ?? paper.pmid;
  return { version: 1, title: '運動醫學研究筆記',
    design: { ...design, imageStyle: design.imageStyle === 'none' ? 'photo' : design.imageStyle, brand: BRAND, footer: source ? `來源 ${source}` : '' },
    pages, outro: outroBlock(paper),
    cover: { title: pages[0].title, subtitle: pages[0].subtitle ?? '', ...(hero ? { image: hero, imageAlt: pages[0].imageAlt, caption: 'AI 生成情境示意' } : {}) } };
}
