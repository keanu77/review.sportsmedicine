import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { processJob } from '../../worker/client.mjs';
import { downloadPaper } from '../../worker/paper.mjs';
import { fixtureDraft } from '../server/helpers.mjs';

const xml = await readFile(new URL('./fixtures/pmc8005924-jats-excerpt.xml', import.meta.url), 'utf8');
const paper = { pmcid: 'PMC8005924', pmid: '33782057', doi: '10.1136/bmj.n71', title: 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews', xmlUrl: 'https://pmc-oa-opendata.s3.amazonaws.com/PMC8005924.1/PMC8005924.1.xml', pdfUrl: null };

test('review worker uses the saved draft and hashed original, never replaces draft or generates images', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'review-rereview-')); t.after(() => rm(workspace, { recursive: true, force: true }));
  const source = await downloadPaper(paper, path.join(workspace, 'job-review', 'research'), { fetchBytes: async url => ({ url, bytes: Buffer.from(xml) }) });
  const draft = { ...fixtureDraft, post: '人工修改後的版本' };
  const directory = path.join(workspace, 'job-review', 'reviews', 'run-test'); await mkdir(directory, { recursive: true });
  const sourceHash = createHash('sha256').update(`jats-v1\0${source.structuredText}`).update(JSON.stringify(draft)).digest('hex');
  for (const provider of ['claude','gemini','grok']) await writeFile(path.join(directory, `review-${provider}.json`), JSON.stringify({ provider, status: 'ran', sourceHash, summary: 'Cached fixture for exact draft', findings: [] }));
  // Request markers prohibit accidental new calls if the expected cache is not used.
  for (const provider of ['claude','gemini','grok']) await writeFile(path.join(directory, `review-${provider}-request.json`), '{}');
  const calls = [], uploads = [];
  const api = { call: async (route, options) => { calls.push({ route, data: options.data }); return {}; }, upload: async (_job, _lease, file) => { uploads.push(file.name); return 'review-file'; } };
  const job = { id: 'job-review', phase: 'review', draft, metadata: { paper: source.paper, reviewRequest: { runId: 'run-test', draftRevision: 7 } } };
  await processJob(api, { job, leaseToken: 'fixture' }, { workspace }, { onStage: () => {} });
  const result = calls.find(call => call.route.endsWith('/complete')).data;
  assert.equal(result.draft, undefined);
  assert.equal(result.metadata.reviews.length, 3);
  assert.deepEqual(uploads, ['reviews.json']);
  const count = calls.filter(call => call.route.endsWith('/complete')).length;
  job.metadata.paper.xmlSha256 = 'changed-version';
  await assert.rejects(processJob(api, { job, leaseToken: 'fixture' }, { workspace }, { onStage: () => {} }), /版本|來源/);
  assert.equal(calls.filter(call => call.route.endsWith('/complete')).length, count);
});
