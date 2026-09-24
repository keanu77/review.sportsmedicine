import { remoteJSON } from './http.mjs';
import { transient } from './retry.mjs';

// Open-access source ladder adapted from the paper-fetch-ntu skill (tier 1 only):
// every OA location from Unpaywall, OpenAlex and Semantic Scholar, tried in order.
// Publisher-side automation (VPN, real browser) stays manual by design.
export const MAX_CANDIDATES = 6;
const MAX_LANDING_BYTES = 3 * 1024 * 1024;
const PAYWALL_MARKERS = ['access options', 'get access', 'purchase access', 'buy article', 'purchase this article',
  'rent this article', 'institutional login', 'sign in to access', 'access through your institution'];
// Bot-verification pages on open articles: a person must download in their own browser.
const CHALLENGE_MARKERS = ['just a moment', '_cf_chl', 'enable javascript and cookies', 'preparing to download', '<title>client challenge', '_fs-ch-'];
// Free repositories never paywall, so a 403 there is a bot wall rather than missing entitlement.
const FREE_HOSTS = ['pmc.ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov', 'europepmc.org', 'www.ebi.ac.uk'];
const array = value => value ? Array.isArray(value) ? value : [value] : [];
const sameDOI = (value, doi) => String(value ?? '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase() === doi.toLowerCase();

export function europePMCRender(value) {
  const pmcid = String(value ?? '').match(/PMC\d+/i)?.[0];
  return pmcid ? `https://europepmc.org/articles/${pmcid.toUpperCase()}?pdf=render` : null;
}

function locationCandidates(pdfUrl, landingUrl, provider, license, version) {
  const shared = { provider, license: license ?? null, version: version ?? null, landingUrl: landingUrl ?? null };
  const renders = [europePMCRender(pdfUrl), europePMCRender(landingUrl)].filter(Boolean);
  return [
    ...(pdfUrl ? [{ ...shared, pdfUrl }] : []),
    ...renders.map(render => ({ ...shared, pdfUrl: render })),
    ...(!pdfUrl && !renders.length && landingUrl ? [{ ...shared, pdfUrl: null }] : []),
  ];
}

async function unpaywall(doi, email, getJSON, signal) {
  const data = await getJSON(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, { signal });
  if (!sameDOI(data.doi, doi)) throw new Error('Unpaywall DOI 不符');
  const locations = data.is_oa ? [data.best_oa_location, ...array(data.oa_locations)] : [];
  return { metadata: { title: data.title, year: data.year, journal: data.journal_name,
    authors: array(data.z_authors).map(x => `${x.given ?? ''} ${x.family ?? ''}`.trim()) },
  candidates: locations.filter(Boolean).flatMap(x => locationCandidates(x.url_for_pdf, x.url_for_landing_page ?? x.url, 'Unpaywall', x.license, x.version)) };
}

async function openAlex(doi, email, getJSON, signal) {
  const url = new URL(`https://api.openalex.org/works/doi:${doi}`);
  if (email) url.searchParams.set('mailto', email);
  const data = await getJSON(url, { signal });
  if (!sameDOI(data.doi, doi)) throw new Error('OpenAlex DOI 不符');
  // Only locations flagged open access; publisher paywall pages are never candidates.
  const locations = [data.best_oa_location, ...array(data.locations)].filter(x => x?.is_oa);
  return { metadata: { title: data.display_name ?? data.title, year: data.publication_year, journal: data.primary_location?.source?.display_name,
    authors: array(data.authorships).map(x => x.author?.display_name).filter(Boolean) },
  candidates: locations.flatMap(x => locationCandidates(x.pdf_url, x.landing_page_url, 'OpenAlex', x.license, x.version)) };
}

async function semanticScholar(doi, getJSON, signal) {
  const data = await getJSON(`https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=externalIds,openAccessPdf`, { signal });
  if (!sameDOI(data.externalIds?.DOI, doi)) throw new Error('Semantic Scholar DOI 不符');
  return { metadata: {}, candidates: locationCandidates(data.openAccessPdf?.url || null, null, 'Semantic Scholar') };
}

export async function collectCandidates(doi, { email, signal, getJSON = remoteJSON } = {}) {
  const lookups = [
    ...(email ? [['Unpaywall', () => unpaywall(doi, email, getJSON, signal)]] : []),
    ['OpenAlex', () => openAlex(doi, email, getJSON, signal)],
    ['Semantic Scholar', () => semanticScholar(doi, getJSON, signal)],
  ];
  const results = [], indexErrors = [];
  for (const [name, lookup] of lookups) {
    signal?.throwIfAborted();
    try { results.push(await lookup()); } catch (error) { if (signal?.aborted) throw error; indexErrors.push(name); }
  }
  const seen = new Set();
  const candidates = results.flatMap(x => x.candidates).filter(candidate => {
    const key = candidate.pdfUrl ?? candidate.landingUrl;
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
  const metadata = results.map(x => x.metadata).find(x => x.title) ?? {};
  return { candidates, metadata, indexErrors };
}

export function citationPdfUrl(html, baseUrl) {
  for (const pattern of [/<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i]) {
    const match = html.match(pattern);
    if (match) return new URL(match[1].replace(/&amp;/g, '&'), baseUrl).href;
  }
  return null;
}

const notPDF = bytes => {
  const head = bytes.subarray(0, 400000).toString('latin1').toLowerCase();
  if (CHALLENGE_MARKERS.some(m => head.includes(m))) return Object.assign(new Error('來源要求瀏覽器驗證，拒絕程式下載'), { kind: 'bot_check' });
  return Object.assign(new Error(PAYWALL_MARKERS.some(m => head.includes(m)) ? '來源回傳需登入或付費的頁面' : '來源回傳網頁而非 PDF'),
    { kind: PAYWALL_MARKERS.some(m => head.includes(m)) ? 'paywall' : 'not_pdf' });
};
const isPDF = bytes => bytes.subarray(0, 5).toString() === '%PDF-';

// Fetch one candidate. Landing pages are only followed through their
// citation_pdf_url tag, still through the SSRF-guarded downloader.
export async function fetchCandidatePDF(candidate, { fetchBytes, signal }) {
  if (candidate.pdfUrl) {
    const result = await fetchBytes(candidate.pdfUrl, { signal });
    if (!isPDF(result.bytes)) throw notPDF(result.bytes);
    return { bytes: result.bytes, url: result.url ?? candidate.pdfUrl };
  }
  const landing = await fetchBytes(candidate.landingUrl, { signal, maxBytes: MAX_LANDING_BYTES });
  if (isPDF(landing.bytes)) return { bytes: landing.bytes, url: landing.url ?? candidate.landingUrl };
  const link = citationPdfUrl(landing.bytes.toString('utf8'), landing.url ?? candidate.landingUrl);
  if (!link) throw notPDF(landing.bytes);
  signal?.throwIfAborted();
  const result = await fetchBytes(link, { signal });
  if (!isPDF(result.bytes)) throw notPDF(result.bytes);
  return { bytes: result.bytes, url: result.url ?? link };
}

export function classifyAttempt(error, host = '') {
  if (error?.kind === 'paywall') return 'access_denied';
  if (error?.challenge || (error?.status === 403 && FREE_HOSTS.includes(host))) return 'bot_check';
  if (error?.kind) return error.kind;
  if ([401, 403, 429, 451].includes(error?.status)) return 'access_denied';
  if ([404, 410].includes(error?.status)) return 'not_found';
  if (transient(error)) return 'temporary';
  if (/標題|DOI|身分/.test(error?.message ?? '')) return 'identity';
  return 'failed';
}

const NEXT_STEPS = {
  FULLTEXT_NOT_OPEN: '未找到已公開的全文；不能以摘要代替全文。可用圖書館連結或館際互借取得後再處理。',
  FULLTEXT_BOT_CHECK: '這篇有公開全文，但來源網站要求瀏覽器驗證、拒絕程式下載（本系統不規避驗證）。請在自己的瀏覽器開啟來源頁下載；重試通常不會改變結果。',
  FULLTEXT_ACCESS_DENIED: '來源拒絕自動下載（多半需要機構訂閱）。請改用圖書館連結或館際互借取得；重試通常不會改變結果。',
  FULLTEXT_IDENTITY: '取得的檔案不是這篇文獻（標題或 DOI 不符），已拒絕使用。請確認 DOI／PMID 是否正確。',
  FULLTEXT_TEMPORARY: '全文來源暫時無法連線，可稍後重試任務。',
  FULLTEXT_SOURCE_UNAVAILABLE: '已列出的公開全文來源失效或不是 PDF。可稍後重試，或改用圖書館連結取得。',
};

// Summarise attempts with host names only: tokens in query strings never reach the database.
export function acquisitionFailure(attempts, { indexUnavailable = false } = {}) {
  const kinds = new Set(attempts.map(a => a.kind));
  const code = !attempts.length ? indexUnavailable ? 'FULLTEXT_TEMPORARY' : 'FULLTEXT_NOT_OPEN'
    : [...kinds].every(kind => kind === 'temporary') ? 'FULLTEXT_TEMPORARY'
      : kinds.has('bot_check') ? 'FULLTEXT_BOT_CHECK' : kinds.has('access_denied') ? 'FULLTEXT_ACCESS_DENIED'
        : kinds.has('identity') ? 'FULLTEXT_IDENTITY' : 'FULLTEXT_SOURCE_UNAVAILABLE';
  const tried = attempts.length ? `已嘗試 ${attempts.length} 個來源：${attempts.map(a => `${a.host}（${a.detail ?? a.kind}）`).join('、')}。` : '';
  return { code, message: `${NEXT_STEPS[code]}${tried ? ` ${tried}` : ''}` };
}
