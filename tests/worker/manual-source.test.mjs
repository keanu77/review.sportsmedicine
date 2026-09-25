import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importManualPaper, resolvePaper, loadPaper } from '../../worker/paper.mjs';
import { WorkerAPI } from '../../worker/client.mjs';

const doi = '10.1002/ksa.70497';
const title = 'Age and time specific management of traumatic anterior shoulder instability';
const text = `${title}\ndoi:${doi}\n${'Verified body text from the published article. '.repeat(10)}`;
const pdf = Buffer.from(`%PDF-1.7\n${'owner supplied '.repeat(10)}`);
const hash = value => createHash('sha256').update(value).digest('hex');
const upload = { name: 'shoulder.pdf', size: pdf.length, sha256: hash(pdf), uploadedAt: '2026-09-25T00:00:00.000Z' };
const paper = { id: `doi:${doi}`, doi, title, pmid: null, citation: `${title}. doi:${doi}`, provider: 'OpenAlex', license: 'cc-by', version: 'publishedVersion',
  pdfUrl: 'https://pmc.ncbi.nlm.nih.gov/x.pdf', sourceUrl: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1/', candidates: [{ pdfUrl: 'https://pmc.ncbi.nlm.nih.gov/x.pdf' }] };
async function temporary(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'review-manual-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test('identity-only resolution succeeds when no open copy exists, so an owner PDF can be checked', async () => {
  const closed = async url => {
    const value = String(url);
    if (value.includes('idconv')) return { records: [{ doi }] };
    if (value.includes('openalex')) return { doi: `https://doi.org/${doi}`, display_name: title, publication_year: 2026, locations: [] };
    if (value.includes('semanticscholar')) return { externalIds: { DOI: doi }, openAccessPdf: null };
    throw new Error(`unexpected ${value}`);
  };
  await assert.rejects(resolvePaper(doi, { getJSON: closed }), error => error.failureCode === 'FULLTEXT_NOT_OPEN');
  const identity = await resolvePaper(doi, { getJSON: closed, requireFullText: false });
  assert.equal(identity.title, title); assert.equal(identity.doi, doi); assert.deepEqual(identity.candidates, []);
});

test('a verified owner PDF becomes the research source without inheriting open-access licence or URLs', async t => {
  const directory = await temporary(t);
  const source = await importManualPaper(paper, directory, pdf, upload, { extractPDF: async () => text });
  assert.equal(source.paper.fullTextVerified, true); assert.equal(source.paper.pdfAvailable, true); assert.equal(source.paper.fullTextFormat, 'pdf');
  assert.equal(source.paper.provider, '手動上傳'); assert.equal(source.paper.license, null); assert.equal(source.paper.version, null);
  assert.equal(source.paper.pdfUrl, null); assert.equal(source.paper.sourceUrl, `https://doi.org/${doi}`);
  assert.deepEqual(source.paper.manualUpload, upload);
  assert.ok(!('candidates' in source.paper)); assert.ok(!('acquisitionAttempts' in source.paper));
  assert.equal(source.paper.sha256, hash(pdf));
  assert.deepEqual(await readFile(source.pdfFile), pdf);
  const reloaded = await loadPaper(directory, { });
  assert.equal(reloaded.paper.sha256, hash(pdf)); assert.equal(reloaded.text, text);
});

test('an owner PDF for another article or with altered bytes is rejected and never saved', async t => {
  const directory = await temporary(t);
  await assert.rejects(importManualPaper(paper, directory, pdf, upload, { extractPDF: async () => `A different article\ndoi:10.9999/x\n${'body '.repeat(100)}` }),
    error => error.failureCode === 'FULLTEXT_MANUAL_MISMATCH' && /上傳的 PDF/.test(error.message));
  await assert.rejects(readFile(path.join(directory, 'paper.pdf')));
  await assert.rejects(importManualPaper(paper, directory, pdf, { ...upload, sha256: 'a'.repeat(64) }, { extractPDF: async () => text }), /雜湊/);
  await assert.rejects(importManualPaper(paper, directory, Buffer.from('<html>'), { ...upload, sha256: hash(Buffer.from('<html>')), size: 6 }, { extractPDF: async () => text }), /不是 PDF/);
});

test('the worker downloads the uploaded PDF with its lease and checks the recorded hash', async () => {
  let request;
  const api = new WorkerAPI({ origin: 'https://review.example', token: 'private' }, async (url, options) => { request = { url, options }; return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'X-Content-SHA256': hash(pdf) } }); });
  const bytes = await api.source({ id: 'job', metadata: { manualSource: upload } }, 'lease');
  assert.deepEqual(bytes, pdf);
  assert.equal(request.url, 'https://review.example/api/worker/jobs/job/source');
  assert.equal(request.options.headers['X-Lease-Token'], 'lease'); assert.equal(request.options.redirect, 'error');
  api.fetcher = async () => new Response(Buffer.from('%PDF-1.7 tampered'), { headers: { 'Content-Type': 'application/pdf' } });
  await assert.rejects(api.source({ id: 'job', metadata: { manualSource: upload } }, 'lease'), /雜湊/);
  api.fetcher = async () => Response.json({ error: { code: 'STALE_LEASE', message: 'stale' } }, { status: 409 });
  await assert.rejects(api.source({ id: 'job', metadata: { manualSource: upload } }, 'lease'), /stale/);
});
