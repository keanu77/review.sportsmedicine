// Trusted publisher validation; no npm dependencies.
import { validateIndex } from './validate-index.mjs';
const fail = () => { throw new Error('Monthly artifact rejected: invalid public data'); };
function shape(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail();
}
function string(v, empty = true) {
  if (typeof v !== 'string' || v.length > 20000 || (!empty && !v.trim()) || !v.isWellFormed()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(v)) fail();
}
function strings(v) { if (!Array.isArray(v)) fail(); for (const s of v) string(s); }
function optional(v, key, check, nullable = true) {
  if (Object.hasOwn(v, key) && !(nullable && v[key] === null)) check(v[key]);
}
function date(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))
    || new Date(v).toISOString().slice(0, 10) !== v) fail();
}
function timestamp(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v))
    || new Date(v).toISOString() !== v) fail();
}
function count(v) { if (!Number.isSafeInteger(v) || v < 0) fail(); }
function year(v) { if (v !== null && (!Number.isInteger(v) || v < 1800 || v > new Date().getUTCFullYear() + 1)) fail(); }
function url(v) {
  string(v, false);
  if (!/^https?:\/\//.test(v) || /\s|\\/.test(v)) fail();
  const parsed = new URL(v);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail();
}
const citationStrings = ['doi', 'pmid', 'pmcid', 'journal', 'volume', 'issue', 'pages'];
const bibliographyKeys = ['title', 'year', 'firstPublicationDate', ...citationStrings, 'authors', 'source', 'sourceUrl', 'verifiedAt', 'matchMethod'];
function bibliographyRecord(v) {
  shape(v, bibliographyKeys); string(v.title, false); year(v.year); strings(v.authors);
  if (v.title.length > 3000 || !['Europe PMC', 'Crossref'].includes(v.source) || !['identifier', 'exact-title-year'].includes(v.matchMethod)) fail();
  url(v.sourceUrl); timestamp(v.verifiedAt);
  for (const key of citationStrings) optional(v, key, string);
  optional(v, 'firstPublicationDate', date);
}
const itemKeys = ['title', 'year', 'firstPublicationDate', 'url', 'source', 'tldr', 'free', 'freeUrl', ...citationStrings,
  'authors', 'bibliography', 'identityAliases', 'impactFactor', 'origin', 'region', 'disease', 'themes', 'populations', 'diseases', 'tldrSource'];
function item(v) {
  shape(v, itemKeys); string(v.title, false); year(v.year); url(v.url);
  if (v.title.length > 3000 || typeof v.free !== 'boolean') fail();
  for (const key of ['source', 'region', 'disease']) string(v[key]);
  if (v.tldr !== null) string(v.tldr);
  strings(v.themes); strings(v.populations);
  for (const key of citationStrings) optional(v, key, string);
  for (const key of ['authors', 'identityAliases', 'diseases']) optional(v, key, strings, key === 'authors');
  optional(v, 'freeUrl', value => { if (value !== '') url(value); });
  optional(v, 'firstPublicationDate', date);
  optional(v, 'bibliography', bibliographyRecord, false);
  optional(v, 'tldrSource', string, false);
  optional(v, 'impactFactor', value => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(); });
  optional(v, 'origin', value => { if (!['kb', 'pubmed'].includes(value)) fail(); }, false);
}
function items(v) { if (!Array.isArray(v)) fail(); for (const entry of v) item(entry); }
export function validateBibliography(v) {
  shape(v, ['version', 'generatedAt', 'records', 'unresolved']);
  if (v.version !== 1 || !Array.isArray(v.records) || !Array.isArray(v.unresolved)) fail();
  timestamp(v.generatedAt);
  for (const entry of v.records) bibliographyRecord(entry);
  for (const entry of v.unresolved) {
    shape(entry, ['key', 'title', 'reason', 'checkedAt']);
    for (const key of ['key', 'title', 'reason']) string(entry[key], false);
    timestamp(entry.checkedAt);
  }
  return v;
}
export function validateNewItems(v) {
  shape(v, ['batch', 'previousBatch', 'syncedAt', 'count', 'items', 'summarizedAt', 'summaryModel']);
  if (v.batch !== null) date(v.batch);
  if (v.previousBatch !== null) date(v.previousBatch);
  date(v.syncedAt); count(v.count); items(v.items);
  if (v.count !== v.items.length || (v.batch && v.previousBatch && v.previousBatch > v.batch)) fail();
  optional(v, 'summarizedAt', value => { if (typeof value === 'string' && value.length === 10) date(value); else timestamp(value); }, false);
  optional(v, 'summaryModel', string, false);
  return v;
}
export function validateReviews(v) {
  shape(v, ['meta', 'axes', 'items']); shape(v.meta, ['updated', 'total', 'freeCount', 'ifJcrYear', 'note']);
  date(v.meta.updated); count(v.meta.total); count(v.meta.freeCount);
  optional(v.meta, 'ifJcrYear', string, false); optional(v.meta, 'note', string, false);
  shape(v.axes, ['region', 'theme', 'population']);
  for (const axis of ['region', 'theme', 'population']) {
    if (!Array.isArray(v.axes[axis])) fail();
    for (const entry of v.axes[axis]) { shape(entry, ['key', 'count']); string(entry.key); count(entry.count); }
  }
  items(v.items);
  if (v.meta.total !== v.items.length || v.meta.freeCount > v.meta.total) fail();
  validateIndex(v);
  return v;
}
