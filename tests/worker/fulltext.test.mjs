import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectCandidates, citationPdfUrl, classifyAttempt, acquisitionFailure } from '../../worker/sources.mjs';
import { downloadPaper, resolvePaper } from '../../worker/paper.mjs';

const doi = '10.1002/ksa.70497';
const title = 'Open access shoulder consensus statement';
const text = `${title}\ndoi:${doi}\n${'Verified body text from the published article. '.repeat(10)}`;
const pdf = Buffer.from('%PDF-1.7\nfixture');
const httpError = status => Object.assign(new Error(`來源回應 HTTP ${status}`), { status });
async function temporary(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'review-fulltext-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

const indexes = {
  unpaywall: { doi, title, year: 2026, journal_name: 'KSSTA', z_authors: [{ given: 'A', family: 'Author' }], is_oa: true,
    best_oa_location: { url_for_pdf: 'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/ksa.70497', url: 'https://onlinelibrary.wiley.com/doi/10.1002/ksa.70497', license: 'cc-by', version: 'publishedVersion' },
    oa_locations: [
      { url_for_pdf: 'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/ksa.70497', url: 'https://onlinelibrary.wiley.com/doi/10.1002/ksa.70497', license: 'cc-by', version: 'publishedVersion' },
      { url_for_pdf: null, url: 'https://europepmc.org/article/PMC/PMC1234567', license: 'cc-by-nc', version: 'acceptedVersion' },
    ] },
  openalex: { doi: `https://doi.org/${doi}`, display_name: title, publication_year: 2026, open_access: { oa_status: 'hybrid' },
    best_oa_location: null,
    locations: [
      { is_oa: false, pdf_url: 'https://paywalled.example.com/a.pdf' },
      { is_oa: true, pdf_url: null, landing_page_url: 'https://repository.example.edu/handle/1', license: 'cc-by', version: 'acceptedVersion' },
    ] },
  s2: { externalIds: { DOI: doi }, openAccessPdf: { url: 'https://arxiv.org/pdf/2609.00001' } },
};
const getJSON = (overrides = {}) => async url => {
  const value = String(url), data = { ...indexes, ...overrides };
  if (value.includes('api.unpaywall.org')) { if (data.unpaywall instanceof Error) throw data.unpaywall; return data.unpaywall; }
  if (value.includes('api.openalex.org')) { if (data.openalex instanceof Error) throw data.openalex; return data.openalex; }
  if (value.includes('api.semanticscholar.org')) { if (data.s2 instanceof Error) throw data.s2; return data.s2; }
  if (value.includes('idconv')) return { records: [{ doi }] };
  throw new Error(`unexpected ${value}`);
};

test('open-access candidates come from every index, skip closed locations, derive Europe PMC PDFs and deduplicate', async () => {
  const { candidates, metadata } = await collectCandidates(doi, { email: 'owner@example.com', getJSON: getJSON() });
  assert.deepEqual(candidates.map(c => c.pdfUrl ?? c.landingUrl), [
    'https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/ksa.70497',
    'https://europepmc.org/articles/PMC1234567?pdf=render',
    'https://repository.example.edu/handle/1',
    'https://arxiv.org/pdf/2609.00001',
  ]);
  assert.equal(candidates[1].license, 'cc-by-nc'); assert.equal(candidates[1].version, 'acceptedVersion');
  assert.ok(!candidates.some(c => c.pdfUrl?.includes('paywalled')));
  assert.equal(metadata.title, title);
});

test('without an email Unpaywall is skipped but OpenAlex and Semantic Scholar still supply sources', async () => {
  const seen = [];
  const { candidates, metadata } = await collectCandidates(doi, { getJSON: async url => { seen.push(String(url)); return getJSON()(url); } });
  assert.ok(!seen.some(url => url.includes('unpaywall')));
  assert.equal(candidates.length, 2); assert.equal(metadata.title, title);
});

test('an index that errors or reports another DOI is ignored instead of failing the lookup', async () => {
  const { candidates, indexErrors } = await collectCandidates(doi, { email: 'owner@example.com', getJSON: getJSON({ unpaywall: httpError(503), s2: { externalIds: { DOI: '10.9999/other' }, openAccessPdf: { url: 'https://wrong.example.com/x.pdf' } } }) });
  assert.deepEqual(candidates.map(c => c.pdfUrl ?? c.landingUrl), ['https://repository.example.edu/handle/1']);
  assert.deepEqual(indexErrors, ['Unpaywall', 'Semantic Scholar']);
});

test('citation_pdf_url is read from landing HTML in either attribute order and resolved relative to the page', () => {
  assert.equal(citationPdfUrl('<meta name="citation_pdf_url" content="/bitstream/1/a.pdf">', 'https://repository.example.edu/handle/1'), 'https://repository.example.edu/bitstream/1/a.pdf');
  assert.equal(citationPdfUrl("<meta content='https://cdn.example.edu/b.pdf?x=1&amp;y=2' name='citation_pdf_url'/>", 'https://repository.example.edu/'), 'https://cdn.example.edu/b.pdf?x=1&y=2');
  assert.equal(citationPdfUrl('<html>no tag</html>', 'https://repository.example.edu/'), null);
});

test('attempts are classified into permission, missing, temporary, identity and non-PDF outcomes', () => {
  assert.equal(classifyAttempt(httpError(403)), 'access_denied');
  assert.equal(classifyAttempt(httpError(429)), 'access_denied');
  assert.equal(classifyAttempt(httpError(404)), 'not_found');
  assert.equal(classifyAttempt(httpError(503)), 'temporary');
  assert.equal(classifyAttempt(Object.assign(new Error('來源連線逾時'), { code: 'ETIMEDOUT' })), 'temporary');
  assert.equal(classifyAttempt(new Error('PDF 中未核對到完整標題，請人工確認文獻身分')), 'identity');
  assert.equal(classifyAttempt(Object.assign(new Error('x'), { kind: 'paywall' })), 'access_denied');
  assert.equal(classifyAttempt(Object.assign(new Error('x'), { kind: 'not_pdf' })), 'not_pdf');
  assert.equal(classifyAttempt(Object.assign(httpError(403), { challenge: true })), 'bot_check');
  assert.equal(classifyAttempt(httpError(403), 'europepmc.org'), 'bot_check');
  assert.equal(classifyAttempt(httpError(403), 'onlinelibrary.wiley.com'), 'access_denied');
});

test('failure summary picks the most useful next step and never exposes more than host names', () => {
  const attempt = (url, kind) => ({ host: new URL(url).hostname, kind });
  assert.equal(acquisitionFailure([attempt('https://a.example/x', 'temporary'), attempt('https://b.example/x', 'temporary')]).code, 'FULLTEXT_TEMPORARY');
  const denied = acquisitionFailure([attempt('https://onlinelibrary.wiley.com/x?token=secret', 'access_denied'), attempt('https://b.example/x', 'temporary')]);
  assert.equal(denied.code, 'FULLTEXT_ACCESS_DENIED');
  assert.match(denied.message, /onlinelibrary\.wiley\.com/); assert.doesNotMatch(denied.message, /secret/);
  assert.equal(acquisitionFailure([attempt('https://a.example/x', 'identity')]).code, 'FULLTEXT_IDENTITY');
  assert.equal(acquisitionFailure([attempt('https://onlinelibrary.wiley.com/x', 'access_denied'), attempt('https://europepmc.org/x', 'bot_check')]).code, 'FULLTEXT_BOT_CHECK');
  assert.equal(acquisitionFailure([attempt('https://a.example/x', 'not_found')]).code, 'FULLTEXT_SOURCE_UNAVAILABLE');
  assert.equal(acquisitionFailure([]).code, 'FULLTEXT_NOT_OPEN');
});

test('resolve keeps every candidate for a DOI without PMC and fails with a classified code when nothing is open', async () => {
  const paper = await resolvePaper(doi, { email: 'owner@example.com', getJSON: getJSON() });
  assert.equal(paper.candidates.length, 4); assert.equal(paper.pdfUrl, paper.candidates[0].pdfUrl); assert.equal(paper.title, title);
  const closed = getJSON({ unpaywall: { ...indexes.unpaywall, is_oa: false, best_oa_location: null, oa_locations: [] }, openalex: { ...indexes.openalex, locations: [] }, s2: { externalIds: { DOI: doi }, openAccessPdf: null } });
  await assert.rejects(resolvePaper(doi, { email: 'owner@example.com', getJSON: closed }), error => error.failureCode === 'FULLTEXT_NOT_OPEN' && /不能以摘要代替全文/.test(error.message));
  const offline = getJSON({ unpaywall: httpError(503), openalex: httpError(503), s2: httpError(503) });
  await assert.rejects(resolvePaper(doi, { email: 'owner@example.com', getJSON: offline }), error => error.failureCode === 'FULLTEXT_TEMPORARY');
});

test('a 403 on the first source falls through to a later verified source and records that source licence', async t => {
  const directory = await temporary(t), paper = await resolvePaper(doi, { email: 'owner@example.com', getJSON: getJSON() }), requested = [];
  const fetchBytes = async url => {
    requested.push(String(url));
    if (String(url).includes('wiley')) throw httpError(403);
    if (String(url).includes('europepmc')) return { url: String(url), bytes: pdf };
    throw new Error('should stop after success');
  };
  const result = await downloadPaper(paper, directory, { fetchBytes, extractPDF: async () => text, pause: async () => {} });
  assert.deepEqual(requested, [paper.candidates[0].pdfUrl, paper.candidates[1].pdfUrl]);
  assert.equal(result.paper.pdfAvailable, true);
  assert.equal(result.paper.pdfUrl, 'https://europepmc.org/articles/PMC1234567?pdf=render');
  assert.equal(result.paper.license, 'cc-by-nc'); assert.equal(result.paper.version, 'acceptedVersion');
  assert.equal(result.paper.sourceUrl, 'https://europepmc.org/article/PMC/PMC1234567');
  assert.deepEqual(result.paper.acquisitionAttempts.map(a => a.kind), ['access_denied', 'ok']);
  const saved = JSON.parse(await readFile(result.metadataFile, 'utf8'));
  assert.equal(saved.license, 'cc-by-nc'); assert.ok(!('candidates' in saved));
});

test('a landing-only candidate follows citation_pdf_url and a paywall page is classified as access denied', async t => {
  const directory = await temporary(t);
  const paper = { id: `doi:${doi}`, doi, title, candidates: [
    { landingUrl: 'https://publisher.example.com/doi/1', provider: 'OpenAlex' },
    { landingUrl: 'https://repository.example.edu/handle/1', provider: 'OpenAlex', license: 'cc-by' },
  ] };
  const fetchBytes = async url => {
    const value = String(url);
    if (value.includes('publisher')) return { url: value, bytes: Buffer.from('<html><body>Access through your institution to read</body></html>'), headers: { 'content-type': 'text/html' } };
    if (value.endsWith('/handle/1')) return { url: value, bytes: Buffer.from('<meta name="citation_pdf_url" content="/bitstream/a.pdf">'), headers: { 'content-type': 'text/html' } };
    if (value.endsWith('/bitstream/a.pdf')) return { url: value, bytes: pdf };
    throw new Error(`unexpected ${value}`);
  };
  const result = await downloadPaper(paper, directory, { fetchBytes, extractPDF: async () => text, pause: async () => {} });
  assert.equal(result.paper.pdfUrl, 'https://repository.example.edu/bitstream/a.pdf');
  assert.deepEqual(result.paper.acquisitionAttempts.map(a => a.kind), ['access_denied', 'ok']);
});

test('all failing sources produce a classified error; wrong-article PDFs are rejected and never saved', async t => {
  const directory = await temporary(t);
  const paper = { id: `doi:${doi}`, doi, title, candidates: [{ pdfUrl: 'https://a.example.com/x.pdf' }, { pdfUrl: 'https://b.example.com/y.pdf' }] };
  await assert.rejects(downloadPaper(paper, directory, { fetchBytes: async url => ({ url: String(url), bytes: pdf }), extractPDF: async () => `Another article ${'body '.repeat(100)}`, pause: async () => {} }),
    error => error.failureCode === 'FULLTEXT_IDENTITY' && error.source.pdfAvailable === false);
  await assert.rejects(readFile(path.join(directory, 'paper.pdf')));
  await assert.rejects(downloadPaper(paper, directory, { fetchBytes: async () => { throw httpError(403); }, pause: async () => {} }),
    error => error.failureCode === 'FULLTEXT_ACCESS_DENIED' && /a\.example\.com/.test(error.message) && /圖書館|館際互借/.test(error.message));
});

test('open repositories behind browser verification are reported as bot checks, not subscriptions', async t => {
  const directory = await temporary(t);
  const paper = { id: `doi:${doi}`, doi, title, candidates: [
    { pdfUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC13418412/pdf/a.pdf' }, { pdfUrl: 'https://europepmc.org/articles/PMC13418412?pdf=render' }] };
  const fetchBytes = async url => String(url).includes('pmc.ncbi') ? { url: String(url), bytes: Buffer.from('<html><title>Preparing to download ...</title></html>') } : Promise.reject(Object.assign(httpError(403), { challenge: true }));
  await assert.rejects(downloadPaper(paper, directory, { fetchBytes, pause: async () => {} }),
    error => error.failureCode === 'FULLTEXT_BOT_CHECK' && /瀏覽器/.test(error.message) && !/訂閱/.test(error.message));
});

test('cancellation stops before trying another source', async t => {
  const directory = await temporary(t), controller = new AbortController(), requested = [];
  const paper = { id: `doi:${doi}`, doi, title, candidates: [{ pdfUrl: 'https://a.example.com/x.pdf' }, { pdfUrl: 'https://b.example.com/y.pdf' }] };
  const fetchBytes = async url => { requested.push(String(url)); controller.abort(new Error('owner cancelled')); throw httpError(403); };
  await assert.rejects(downloadPaper(paper, directory, { signal: controller.signal, fetchBytes, pause: async () => {} }), /owner cancelled/);
  assert.equal(requested.length, 1);
});

test('the number of attempted sources is capped', async t => {
  const directory = await temporary(t), requested = [];
  const paper = { id: `doi:${doi}`, doi, title, candidates: Array.from({ length: 12 }, (_, i) => ({ pdfUrl: `https://s${i}.example.com/x.pdf` })) };
  await assert.rejects(downloadPaper(paper, directory, { fetchBytes: async url => { requested.push(url); throw httpError(404); }, pause: async () => {} }), error => error.failureCode === 'FULLTEXT_SOURCE_UNAVAILABLE');
  assert.equal(requested.length, 6);
});
