import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { downloadPaper } from '../../worker/paper.mjs';
import { runProcess, modelEnvironment } from '../../worker/process.mjs';

const cli = fileURLToPath(new URL('../../worker/cli.mjs', import.meta.url));
const xml = await readFile(new URL('./fixtures/pmc8005924-jats-excerpt.xml', import.meta.url), 'utf8');
const paper = { id: 'pmc:PMC8005924', pmcid: 'PMC8005924', doi: '10.1136/bmj.n71', pmid: '33782057',
  title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews',
  xmlUrl: 'https://pmc-oa-opendata.s3.amazonaws.com/PMC8005924.1/PMC8005924.1.xml', pdfUrl: null };
const hash = value => createHash('sha256').update(value).digest('hex');
const draft = { post: '研究有限制。', igCaption: '保留適用範圍。', notes: '研究筆記。',
  pages: ['cover', 'content', 'outro'].map((layout, i) => ({ id: `p${i}`, layout, title: '研究筆記' })),
  claims: [{ text: '研究報告應標示文獻類型', locator: 'xml:tbl2', quote: 'Identify the report as a systematic review.' }] };

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'review-cli-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = await downloadPaper(paper, directory, { fetchBytes: async url => ({ url, bytes: Buffer.from(xml) }) });
  // A matching cached draft lets the real CLI run without calling a model.
  // The request marker prevents an unexpected cache miss from consuming usage.
  await writeFile(path.join(directory, 'draft-request.json'), '{}');
  await writeFile(path.join(directory, 'draft.json'), JSON.stringify({ sourceHash: hash(`jats-v1\0${source.structuredText}codex`), draft }));
  return { directory, source };
}
const run = (directory, command = 'draft', extra = []) => runProcess(process.execPath, [cli, command, '--dir', directory, ...extra],
  { env: { ...modelEnvironment(), REVIEW_MODEL_PROVIDER: 'codex', REVIEW_REVIEWERS: '' } });

test('CLI resumes an XML-only draft without a PDF text file or a new model call', async t => {
  const { directory } = await workspace(t);
  const result = JSON.parse((await run(directory)).stdout);
  assert.equal(result.pages, 3);
  assert.deepEqual(result.reviews, []);
});

test('CLI reconstructs XML evidence from the hashed original, not a modified extraction cache', async t => {
  const { directory } = await workspace(t);
  await writeFile(path.join(directory, 'paper-structured.json'), JSON.stringify({ structuredText: 'invented findings', locators: {} }));
  assert.equal(JSON.parse((await run(directory)).stdout).pages, 3);
});

test('CLI rejects modified XML before it can reuse a draft', async t => {
  const { directory } = await workspace(t);
  await writeFile(path.join(directory, 'paper.xml'), xml.replace('Identify the report', 'Misidentify the report'));
  await assert.rejects(run(directory), /XML.*(?:雜湊|完整性)/);
});

test('CLI rendering does not require full-text files when the source and draft are already verified', async t => {
  const { directory } = await workspace(t);
  // Reach design validation without launching a renderer or reading paper.txt.
  await assert.rejects(run(directory, 'render', ['--format', 'invalid-format']), error => !/ENOENT|paper\.txt/.test(error.message) && /format|尺寸|格式/.test(error.message));
});

async function pdfWorkspace(t) {
  const { directory } = await workspace(t);
  const text = `${paper.title}\ndoi:${paper.doi}\n${'This verified PDF page describes study limitations. '.repeat(10)}`;
  const bytes = Buffer.from('%PDF-1.7\nFixture container; text extraction is already hashed.');
  const pdfDraft = { ...draft, claims: [{ text: '保留限制', locator: 'p:1', quote: 'This verified PDF page describes study limitations.' }] };
  await writeFile(path.join(directory, 'source.json'), JSON.stringify({ ...paper, fullTextVerified: true, pdfAvailable: true, xmlAvailable: false, sha256: hash(bytes), textSha256: hash(text), textExtractionVersion: 1 }));
  await writeFile(path.join(directory, 'paper.pdf'), bytes);
  await writeFile(path.join(directory, 'paper.txt'), text);
  await writeFile(path.join(directory, 'draft.json'), JSON.stringify({ sourceHash: hash(text + 'codex'), draft: pdfDraft }));
  return { directory, text, bytes };
}

test('CLI supports verified PDF-only sources and ignores stale XML files marked unavailable', async t => {
  const { directory } = await pdfWorkspace(t);
  assert.equal(JSON.parse((await run(directory)).stdout).pages, 3);
});

test('CLI rejects a modified PDF even when its old text and draft remain cached', async t => {
  const { directory } = await pdfWorkspace(t);
  await writeFile(path.join(directory, 'paper.pdf'), '%PDF-1.7\nDifferent article');
  await assert.rejects(run(directory), /PDF.*(?:雜湊|完整性)/);
});

test('CLI rejects modified PDF text before calling models or using a matching old draft', async t => {
  const { directory, text } = await pdfWorkspace(t);
  await writeFile(path.join(directory, 'paper.txt'), text + '\nInvented finding.');
  await assert.rejects(run(directory), /PDF.*(?:雜湊|完整性)/);
});

test('CLI refuses a source without completed full-text verification', async t => {
  const { directory, source } = await workspace(t);
  await writeFile(path.join(directory, 'source.json'), JSON.stringify({ ...source.paper, fullTextVerified: false }));
  await assert.rejects(run(directory), /全文.*(?:核對|驗證)/);
});
