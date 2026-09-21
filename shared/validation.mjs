export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

export const DEFAULT_DESIGN = Object.freeze({ palette: 'blue', style: 'clinical', imageStyle: 'photo', format: 'portrait' });
const options = {
  palette: ['blue', 'cyan', 'emerald', 'orange-light', 'gold', 'orange', 'sky'],
  style: ['clinical', 'editorial'], imageStyle: ['photo', 'illustration', 'none'], format: ['square', 'portrait'],
};
export function record(value, name = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${name} must be an object`);
  return value;
}
export function text(value, name, max, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0')) {
    throw new ValidationError(`${name} must be ${empty ? 'a' : 'a nonempty'} string of at most ${max} characters`);
  }
  return value;
}
export function normalizeInput(value) {
  let input = text(value, 'input', 512).trim();
  if (/^https?:\/\//i.test(input)) {
    let url;
    try { url = new URL(input); } catch { throw new ValidationError('Invalid identifier URL'); }
    if (url.username || url.password || url.port || url.search || url.hash || url.protocol !== 'https:') throw new ValidationError('Use a canonical HTTPS identifier URL');
    const host = url.hostname.toLowerCase();
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { throw new ValidationError('Invalid URL encoding'); }
    if (host === 'doi.org' || host === 'dx.doi.org') input = path.slice(1);
    else if (host === 'pubmed.ncbi.nlm.nih.gov' && /^\/\d+\/?$/.test(path)) input = `PMID:${path.replaceAll('/', '')}`;
    else if (['pmc.ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov'].includes(host) && /^\/(?:pmc\/)?articles\/PMC\d+\/?$/i.test(path)) input = path.match(/PMC\d+/i)[0];
    else throw new ValidationError('Only canonical DOI, PubMed and PMC identifier URLs are supported');
  }
  if (/^(?:PMID\s*:\s*)?[1-9]\d{0,8}$/i.test(input)) return `PMID:${input.replace(/^PMID\s*:\s*/i, '')}`;
  if (/^(?:PMCID\s*:\s*)?PMC[1-9]\d{0,8}$/i.test(input)) return input.replace(/^PMCID\s*:\s*/i, '').toUpperCase();
  input = input.replace(/^doi\s*:\s*/i, '');
  if (/^10\.\d{4,9}\/[^\s<>"\\?#]+$/i.test(input)) return input.toLowerCase();
  throw new ValidationError('Provide a DOI, PMID or PMCID, or its canonical identifier URL');
}
export function validateDesign(value = {}) {
  record(value, 'design');
  const design = { ...DEFAULT_DESIGN };
  for (const key of Object.keys(value)) {
    if (!options[key]?.includes(value[key])) throw new ValidationError(`Invalid design ${key}`);
    design[key] = value[key];
  }
  return design;
}
export function validateRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new ValidationError('revision must be a positive integer');
  return value;
}
export function validateDraft(value) {
  record(value, 'draft');
  const draft = {
    post: text(value.post, 'post', 20000), igCaption: text(value.igCaption, 'igCaption', 5000),
    notes: text(value.notes, 'notes', 20000, { empty: true }),
  };
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 12) throw new ValidationError('pages must contain 1–12 pages');
  const ids = new Set();
  draft.pages = value.pages.map((entry) => {
    record(entry, 'page');
    const id = text(entry.id, 'page id', 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new ValidationError('Page IDs must be unique safe identifiers');
    ids.add(id);
    if (!['cover', 'content', 'outro'].includes(entry.layout)) throw new ValidationError('Invalid page layout');
    const page = { id, layout: entry.layout, title: text(entry.title, 'page title', 300) };
    if (entry.subtitle !== undefined) page.subtitle = text(entry.subtitle, 'subtitle', 1000, { empty: true });
    if (entry.cards !== undefined) {
      if (!Array.isArray(entry.cards) || entry.cards.length > 6) throw new ValidationError('A page may have at most 6 cards');
      page.cards = entry.cards.map((card) => {
        record(card, 'card');
        return { title: text(card.title, 'card title', 300), body: text(card.body, 'card body', 2000) };
      });
    }
    return page;
  });
  if (!Array.isArray(value.claims) || value.claims.length < 1 || value.claims.length > 100) throw new ValidationError('claims must contain 1–100 evidence entries');
  draft.claims = value.claims.map((claim) => {
    record(claim, 'claim');
    return { text: text(claim.text, 'claim text', 2000), locator: text(claim.locator, 'claim locator', 1000), quote: text(claim.quote, 'claim quote', 5000) };
  });
  return draft;
}
export function validateMetadata(value = {}) {
  record(value, 'metadata');
  if (JSON.stringify(value).length > 100000) throw new ValidationError('metadata is too large');
  return value;
}
export function safeId(value, name = 'id') {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new ValidationError(`Invalid ${name}`);
  return value;
}
