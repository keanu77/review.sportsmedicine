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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const networkError = () => new TypeError('fetch failed');
const timing = { intervalMs: 20, timeoutMs: 50, graceMs: 150, failRetryMs: 5 };

// A cached re-review job whose upload takes `uploadMs`, so heartbeats run meanwhile.
async function reviewJob(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'review-heartbeat-')); t.after(() => rm(workspace, { recursive: true, force: true }));
  const source = await downloadPaper(paper, path.join(workspace, 'job-hb', 'research'), { fetchBytes: async url => ({ url, bytes: Buffer.from(xml) }) });
  const directory = path.join(workspace, 'job-hb', 'reviews', 'run-hb'); await mkdir(directory, { recursive: true });
  const sourceHash = createHash('sha256').update(`jats-v1\0${source.structuredText}`).update(JSON.stringify(fixtureDraft)).digest('hex');
  for (const provider of ['codex', 'claude', 'gemini', 'grok']) {
    await writeFile(path.join(directory, `review-${provider}.json`), JSON.stringify({ provider, status: 'ran', sourceHash, summary: 'cached', findings: [] }));
    await writeFile(path.join(directory, `review-${provider}-request.json`), '{}');
  }
  return { workspace, job: { id: 'job-hb', phase: 'review', draft: fixtureDraft, metadata: { paper: source.paper, reviewRequest: { runId: 'run-hb', draftRevision: 1 } } } };
}
function fakeApi({ heartbeat, fail = async () => ({}), uploadMs }) {
  const calls = [];
  return { calls, api: {
    call: async (route, options) => { calls.push(route.split('/').at(-1)); if (route.endsWith('/heartbeat')) return heartbeat(calls.filter(c => c === 'heartbeat').length); if (route.endsWith('/fail')) return fail(calls.filter(c => c === 'fail').length, options.data); return {}; },
    upload: async (_job, _lease, _file, signal) => { const end = Date.now() + uploadMs; while (Date.now() < end) { signal?.throwIfAborted(); await sleep(5); } return 'file'; },
  } };
}

test('a brief network outage during heartbeats does not abandon the job', async t => {
  const { workspace, job } = await reviewJob(t);
  // Heartbeats 2–4 fail with a network error (~60 ms), well inside the 150 ms grace.
  const { api, calls } = fakeApi({ uploadMs: 200, heartbeat: async n => { if (n >= 2 && n <= 4) throw networkError(); return {}; } });
  const notes = [];
  await processJob(api, { job, leaseToken: 'fixture' }, { workspace }, { onStage: note => notes.push(note), heartbeat: timing });
  assert.ok(calls.includes('complete'), 'the job completes');
  assert.ok(!calls.includes('fail'));
  assert.ok(notes.some(note => /心跳暫時失敗/.test(note)));
});

test('a server answer such as a stale lease stops the job at once', async t => {
  const { workspace, job } = await reviewJob(t);
  const { api, calls } = fakeApi({ uploadMs: 400, heartbeat: async n => { if (n >= 2) throw Object.assign(new Error('Lease is no longer active'), { status: 409 }); return {}; } });
  await assert.rejects(processJob(api, { job, leaseToken: 'fixture' }, { workspace }, { onStage: () => {}, heartbeat: timing }), /Lease/);
  assert.ok(!calls.includes('complete'));
});

test('an outage longer than the grace stops the job and the failure report is retried', async t => {
  const { workspace, job } = await reviewJob(t);
  let reported;
  const { api, calls } = fakeApi({ uploadMs: 1000, heartbeat: async n => { if (n >= 2) throw networkError(); return {}; },
    fail: async (n, data) => { if (n < 3) throw networkError(); reported = data; return {}; } });
  await assert.rejects(processJob(api, { job, leaseToken: 'fixture' }, { workspace }, { onStage: () => {}, heartbeat: timing }), /fetch failed/);
  assert.ok(!calls.includes('complete'));
  assert.equal(calls.filter(c => c === 'fail').length, 3, 'the report is sent until it arrives');
  assert.equal(reported.code, 'WORKER_INTERRUPTED');
});
