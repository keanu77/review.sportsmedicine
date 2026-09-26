import test from 'node:test';
import assert from 'node:assert/strict';
import { gateResult } from '../../src/QualityGate';
import { claimKey } from '../../shared/quality.mjs';
import type { Draft, Job } from '../../shared/contracts';

const draft: Draft = { post: '研究摘要', igCaption: '研究重點', notes: '', pages: [], claims: [{ text: 'A claim', locator: 'p:1', quote: 'An evidence excerpt' }] };
const job = { draft, revision: 9, draftRevision: 3, metadata: { reviewsDraftRevision: 3, reviewsStale: false, reviews: [{ provider: 'codex', status: 'ran', findings: [] }], claimReview: { decisions: { [claimKey(draft.claims[0])]: { status: 'locked' } } } } } as unknown as Job;

test('the browser blocks stale, mismatched and unknown review versions as hard errors', () => {
  for (const patch of [{ reviewsStale: true }, { reviewsDraftRevision: 2 }, { reviewsDraftRevision: null }, { reviewsDraftRevision: undefined }]) {
    const result = gateResult(draft, { ...job, metadata: { ...job.metadata, ...patch } });
    assert.ok(result.errors.some(issue => issue.code === 'PRIMARY_REVIEW_STALE' && !issue.overridable));
  }
  assert.ok(gateResult(draft, { ...job, draftRevision: null }).errors.some(issue => issue.code === 'PRIMARY_REVIEW_STALE'));
});

test('unsaved text cannot display a passing gate for the saved draft review', () => {
  assert.ok(gateResult({ ...draft, post: '尚未儲存的新結論' }, job).errors.some(issue => issue.code === 'PRIMARY_REVIEW_STALE'));
});

test('review validity uses the draft version, unaffected by job revisions or design changes', () => {
  assert.deepEqual(gateResult(draft, job).errors, []);
  assert.deepEqual(gateResult(draft, { ...job, design: { palette: 'emerald', style: 'clinical', imageStyle: 'none', format: 'square' } }).errors, []);
});
