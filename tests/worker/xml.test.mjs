import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { parseJATS, analysisText, evidenceAt } from '../../worker/xml.mjs';
import { downloadPaper, resolvePaper } from '../../worker/paper.mjs';
import { validateEvidence, generateDraft } from '../../worker/draft.mjs';
import { verifyReviewQuotes, reviewDraft } from '../../worker/review.mjs';

const xml = await readFile(new URL('./fixtures/pmc8005924-jats-excerpt.xml', import.meta.url), 'utf8');
const paper = { id: 'pmc:PMC8005924', pmcid: 'PMC8005924', doi: '10.1136/bmj.n71', pmid: '33782057',
  title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews',
  xmlUrl: 'https://pmc-oa-opendata.s3.amazonaws.com/PMC8005924.1/PMC8005924.1.xml', pdfUrl: 'https://pmc-oa-opendata.s3.amazonaws.com/PMC8005924.1/PMC8005924.1.pdf' };
const pdfText = `${paper.title}\ndoi:${paper.doi}\n${'This is a verified PDF page with study limitations. '.repeat(10)}`;
const pdfBytes = Buffer.from('%PDF-1.7\nFake container for isolated extractor tests');
const hash = text => createHash('sha256').update(text).digest('hex');
const source = () => ({ paper, text: pdfText, ...parseJATS(xml, paper) });
const draft = (locator = 'xml:tbl2', quote = 'Identify the report as a systematic review.') => ({ post: '研究有限制。', igCaption: '保留適用範圍。', notes: '研究筆記。',
  pages: ['cover', 'content', 'outro'].map((layout, i) => ({ id: `p${i}`, layout, title: '研究筆記' })), claims: [{ text: '研究報告應標示文獻類型', locator, quote }] });
async function temporary(t) { const directory = await mkdtemp(path.join(os.tmpdir(), 'review-jats-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }
const fetchBoth = async url => ({ bytes: url.endsWith('.xml') ? Buffer.from(xml) : pdfBytes, url });

test('real PMC JATS excerpt retains table coordinates, caption, footnote and section context', () => {
  const parsed = parseJATS(xml, paper), table = parsed.locators['xml:tbl2'];
  assert.deepEqual(parsed.identity, { title: paper.title, doi: paper.doi, pmcid: paper.pmcid, pmid: paper.pmid });
  assert.deepEqual(table.section, ['Body', 'The PRISMA 2020 statement', 'How to use PRISMA 2020']);
  assert.equal(table.table.label, 'Table 2');
  assert.equal(table.table.caption, 'PRISMA 2020 for Abstracts checklist*');
  assert.equal(table.table.rows.length, 19);
  assert.deepEqual(table.table.rows[0].cells.map(cell => cell.text), ['Section and topic', 'Item #', 'Checklist item']);
  assert.equal(table.table.rows[2].cells[2].text, 'Identify the report as a systematic review.');
  assert.match(table.table.footnotes[0], /new item recommending authors specify the methods/);
  assert.match(parsed.structuredText, /\[xml:tbl2\]/);
  assert.match(parsed.structuredText, /Systematic reviews serve many critical roles/);
  assert.equal(parsed.structuredText, parseJATS(xml, paper).structuredText);
});

test('identity must come from the article front and match all expected identifiers and title', () => {
  assert.equal(parseJATS(xml.replace('<article-id pub-id-type="pmcid">PMC8005924</article-id>', '<article-id pub-id-type="pmc">8005924</article-id>'), paper).identity.pmcid, paper.pmcid);
  for (const changed of [{ doi: '10.1000/wrong' }, { pmcid: 'PMC99999' }, { pmid: '12345' }, { title: 'Unrelated paper' }]) assert.throws(() => parseJATS(xml, { ...paper, ...changed }), /不符/);
  const absent = xml.replace('<article-id pub-id-type="doi">10.1136/bmj.n71</article-id>', '');
  assert.throws(() => parseJATS(absent.replace('</article>', '<back><ref-list><ref><pub-id pub-id-type="doi">10.1136/bmj.n71</pub-id></ref></ref-list></back></article>'), paper), /DOI/);
  assert.throws(() => parseJATS(xml.replace('</article-meta>', '<article-id pub-id-type="doi">10.1000/other</article-id></article-meta>'), paper), /DOI/);
  assert.throws(() => parseJATS(xml.replace('<p>Systematic reviews', '<p id="tbl2">Systematic reviews'), paper), /重複/);
  assert.throws(() => parseJATS(xml.replace(/<body>[\s\S]*<\/body>/, '<body><p>Abstract only.</p></body>'), paper), /摘要/);
});

test('external DTD headers are inert; internal DTD, entities, XInclude and malformed XML fail closed', () => {
  assert.ok(parseJATS(xml.replace('JATS-archivearticle1-4.dtd', 'https://127.0.0.1/never-fetch.dtd'), paper).locators['xml:tbl2']);
  for (const malicious of [
    xml.replace(/<!DOCTYPE[^>]+>/, '<!DOCTYPE article [<!ENTITY steal SYSTEM "file:///etc/passwd">]>'),
    xml.replace(/<!DOCTYPE[^>]+>/, '<!DOCTYPE article [<!ELEMENT article ANY>]>'),
    xml.replace('Systematic reviews serve', '&unregistered; reviews serve'),
    xml.replace('article-type="research-article"', 'article-type="&unregistered;"'),
    xml.replace('<body>', '<body><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://example.com"/>'),
    xml.replace('</body>', ''),
  ]) assert.throws(() => parseJATS(malicious, paper), /XML/);
  assert.throws(() => parseJATS(xml.replace('<body>', `<body>${'<sec>'.repeat(101)}`).replace('</body>', `${'</sec>'.repeat(101)}</body>`), paper), /深度/);
});

test('mixed inline XML preserves text order and decodes only standard and numeric characters', () => {
  const changed = xml.replace('Systematic reviews serve many critical roles.', 'Systematic <italic>reviews</italic> serve A &amp; B; x &lt; 2; &#x3B1; &#946;. <![CDATA[Literal &custom; data]]>');
  const text = parseJATS(changed, paper).locators['xml:jats-paragraph-1'].text;
  assert.match(text, /Systematic reviews serve A & B; x < 2; α β/);
  assert.match(text, /Literal &custom; data/);
});

test('merged table cells retain coordinates and image-only tables declare unreadable cells', () => {
  const smallTable = '<table><tbody><tr><th rowspan="2">Group</th><th colspan="2">Outcome</th></tr><tr><td>Intervention 21</td><td>Control 34</td></tr></tbody></table>';
  const changed = xml.replace(/<table [\s\S]*?<\/table>/, smallTable);
  const table = parseJATS(changed, paper).locators['xml:tbl2'].table;
  assert.deepEqual(table.rows[1].cells.map(cell => cell.column), [2, 3]);
  assert.equal(table.rows[0].cells[0].rowSpan, 2);
  assert.equal(table.rows[0].cells[1].colSpan, 2);
  const imageTable = parseJATS(xml.replace(/<table [\s\S]*?<\/table>/, '<graphic href="table.jpg"/>'), paper).locators['xml:tbl2'];
  assert.equal(imageTable.table.machineReadable, false);
  assert.match(imageTable.text, /machineReadable=false/);
});

test('draft/review quotes bind to the requested XML paragraph or table and retain legacy PDF support', () => {
  const full = source();
  validateEvidence(draft(), full);
  assert.throws(() => validateEvidence(draft('xml:jats-paragraph-1'), full), /定位/);
  assert.throws(() => validateEvidence(draft('xml:missing'), full), /定位/);
  validateEvidence(draft('p:1', 'verified PDF page with study limitations'), pdfText);
  validateEvidence(draft('p:1', 'verified PDF page with study limitations'), full);
  const xmlOnly = { ...full, text: '' };
  assert.throws(() => validateEvidence(draft('p:1', 'Systematic reviews serve many critical roles'), xmlOnly), /定位/);
  assert.equal(verifyReviewQuotes({ findings: [{ locator: 'xml:tbl2', quote: 'Identify the report as a systematic review.' }] }, xmlOnly).findings[0].sourceVerified, true);
  assert.equal(verifyReviewQuotes({ findings: [{ locator: 'xml:jats-paragraph-1', quote: 'Identify the report as a systematic review.' }] }, xmlOnly).findings[0].sourceVerified, false);
  assert.equal(evidenceAt(xmlOnly, 'p:1'), undefined);
  assert.equal(analysisText(full).format, 'XML');
  assert.ok(!analysisText(xmlOnly).labelled.includes('[p:'));
});

test('XML and PDF are independently verified, saved, hashed and reused without another transfer', async t => {
  const directory = await temporary(t), transfers = [];
  const first = await downloadPaper(paper, directory, { fetchBytes: async url => { transfers.push(url); return fetchBoth(url); }, extractPDF: async () => pdfText });
  assert.deepEqual(transfers, [paper.xmlUrl, paper.pdfUrl]);
  assert.equal(first.paper.pdfAvailable, true); assert.equal(first.paper.xmlAvailable, true); assert.equal(first.paper.fullTextFormat, 'xml');
  assert.equal(await readFile(first.xmlFile, 'utf8'), xml);
  assert.deepEqual(await readFile(first.pdfFile), pdfBytes);
  assert.equal(first.paper.xmlSha256, hash(xml)); assert.equal(first.paper.sha256, hash(pdfBytes));
  assert.equal(JSON.parse(await readFile(first.structuredFile, 'utf8')).locators['xml:tbl2'].kind, 'table');
  assert.equal((await stat(first.xmlFile)).mode & 0o777, 0o600);
  const second = await downloadPaper(paper, directory, { fetchBytes: async () => { throw new Error('cache must avoid network'); }, extractPDF: async () => { throw new Error('cache must avoid extraction'); } });
  assert.equal(second.paper.pdfAvailable, true); assert.equal(second.paper.xmlAvailable, true);
  assert.equal(second.structuredText, first.structuredText);
  assert.equal(second.paper.downloadedAt, first.paper.downloadedAt); assert.equal(second.paper.xmlDownloadedAt, first.paper.xmlDownloadedAt);
});

test('PMC resolution accepts XML-only full text and refuses ambiguous XML-only versions', async t => {
  let versions = 1;
  t.mock.method(dns, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(https, 'get', (url, _options, callback) => {
    assert.equal(url.hostname, 'pmc-oa-opendata.s3.amazonaws.com');
    const body = url.pathname === '/' ? `<ListBucketResult>${Array.from({ length: versions }, (_, i) => `<Contents><Key>metadata/PMC8005924.${i + 1}.json</Key></Contents>`).join('')}</ListBucketResult>`
      : JSON.stringify({ ...paper, version: Number(url.pathname.match(/\.(\d+)\.json$/)[1]), is_manuscript: false, is_retracted: false, pdf_url: null, xml_url: paper.xmlUrl });
    const request = new EventEmitter(); request.destroy = error => { if (error) request.emit('error', error); request.emit('close'); };
    process.nextTick(() => { const response = new EventEmitter(); Object.assign(response, { statusCode: 200, headers: {} }); callback(response); response.emit('data', Buffer.from(body)); response.emit('end'); request.emit('close'); });
    return request;
  });
  const resolved = await resolvePaper(paper.pmcid, { title: paper.title });
  assert.equal(resolved.pdfUrl, null); assert.equal(resolved.xmlUrl, paper.xmlUrl); assert.equal(resolved.doi, paper.doi);
  versions = 2;
  await assert.rejects(resolvePaper(paper.pmcid), /多個可用全文版本/);
});

test('XML-only source reports readable full text and no invented PDF file, pages or checksum', async t => {
  const directory = await temporary(t);
  const result = await downloadPaper({ ...paper, pdfUrl: null, sha256: 'stale', pdfAvailable: true }, directory, { fetchBytes: fetchBoth, extractPDF: async () => { throw new Error('must not extract nonexistent PDF'); } });
  assert.equal(result.paper.fullTextAvailable, true); assert.equal(result.paper.fullTextVerified, true);
  assert.equal(result.paper.pdfAvailable, false); assert.equal(result.paper.pdfStatus, 'unavailable');
  assert.match(result.paper.pdfError, /沒有提供可下載的 PDF/);
  assert.equal(result.paper.sha256, undefined); assert.equal(result.pdfFile, null); assert.equal(result.textFile, null); assert.equal(result.text, '');
  assert.equal(analysisText(result).format, 'XML');
});

test('a failed or mismatched PDF remains explicitly unavailable while valid XML can be read', async t => {
  const directory = await temporary(t);
  const result = await downloadPaper(paper, directory, { fetchBytes: fetchBoth, extractPDF: async () => `Wrong article ${'padding '.repeat(60)}` });
  assert.equal(result.paper.pdfStatus, 'rejected'); assert.match(result.paper.pdfError, /標題/);
  assert.equal(result.paper.xmlAvailable, true); assert.equal(result.pdfFile, null); assert.equal(result.text, '');
});

test('rejected XML identity falls back to verified PDF and is not exposed as usable structured text', async t => {
  const directory = await temporary(t);
  const result = await downloadPaper(paper, directory, { fetchBytes: async url => ({ url, bytes: url.endsWith('.xml') ? Buffer.from(xml.replace('10.1136/bmj.n71</article-id>', '10.9999/wrong</article-id>')) : pdfBytes }), extractPDF: async () => pdfText });
  assert.equal(result.paper.xmlStatus, 'rejected'); assert.match(result.paper.xmlError, /DOI/);
  assert.equal(result.paper.pdfAvailable, true); assert.equal(result.xmlFile, null); assert.equal(result.structuredText, null);
  assert.equal(analysisText(result).format, 'PDF');
});

test('no verified format fails with explicit acquisition metadata; unofficial XML is never accepted', async t => {
  const directory = await temporary(t); let calls = 0;
  await assert.rejects(downloadPaper({ ...paper, xmlUrl: 'https://example.com/article.xml', pdfUrl: null }, directory, { fetchBytes: async () => { calls++; return { bytes: Buffer.from(xml) }; } }), error => error.source.xmlStatus === 'rejected' && error.source.fullTextAvailable === false);
  assert.equal(calls, 0);
  await assert.rejects(downloadPaper({ ...paper, pdfUrl: null }, directory, { fetchBytes: async () => ({ url: 'https://example.com/article.xml', bytes: Buffer.from(xml) }) }), /非官方/);
  const metadata = JSON.parse(await readFile(path.join(directory, 'source.json'), 'utf8'));
  assert.equal(metadata.xmlAvailable, false); assert.equal(metadata.pdfAvailable, false);
});

test('legacy PDF-only draft cache works; adding or changing structured text invalidates it without model calls', async t => {
  const directory = await temporary(t), pdfDraft = draft('p:1', 'verified PDF page with study limitations');
  await writeFile(path.join(directory, 'draft-request.json'), '{}');
  await writeFile(path.join(directory, 'draft.json'), JSON.stringify({ sourceHash: hash(pdfText + 'codex'), draft: pdfDraft }));
  assert.equal((await generateDraft({ paper, text: pdfText }, directory, { provider: 'codex' })).claims[0].locator, 'p:1');
  const full = source();
  await assert.rejects(generateDraft(full, directory, { provider: 'codex' }), /先前模型請求/);
  await writeFile(path.join(directory, 'draft.json'), JSON.stringify({ sourceHash: hash(`jats-v1\0${full.structuredText}codex`), draft: draft() }));
  assert.equal((await generateDraft(full, directory, { provider: 'codex' })).claims[0].locator, 'xml:tbl2');
  await assert.rejects(generateDraft({ ...full, structuredText: `${full.structuredText}\nchanged` }, directory, { provider: 'codex' }), /先前模型請求/);
});

test('review cache follows the preferred XML source while preserving PDF-only hashes without model calls', async t => {
  const directory = await temporary(t), currentDraft = draft(), full = source();
  const cached = sourceHash => ({ provider: 'grok', status: 'ran', summary: 'cached', sourceHash, findings: [] });
  await writeFile(path.join(directory, 'review-grok-request.json'), '{}');
  await writeFile(path.join(directory, 'review-grok.json'), JSON.stringify(cached(hash(pdfText + JSON.stringify(currentDraft)))));
  assert.equal((await reviewDraft({ text: pdfText }, currentDraft, directory, { providers: ['grok'] }))[0].status, 'ran');
  assert.equal((await reviewDraft(full, currentDraft, directory, { providers: ['grok'] }))[0].status, 'failed');
  await writeFile(path.join(directory, 'review-grok.json'), JSON.stringify(cached(hash(`jats-v1\0${full.structuredText}${JSON.stringify(currentDraft)}`))));
  assert.equal((await reviewDraft(full, currentDraft, directory, { providers: ['grok'] }))[0].status, 'ran');
  assert.equal((await reviewDraft({ ...full, structuredText: `${full.structuredText}\nchanged` }, currentDraft, directory, { providers: ['grok'] }))[0].status, 'failed');
});
