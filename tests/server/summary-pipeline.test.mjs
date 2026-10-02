import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unsupportedNumbers } from '../../scripts/lib/summary-checks.mjs';
import { identifiersConflict } from '../../scripts/lib/literature-keys.mjs';
import { commitSummaries, resolvePmid } from '../../scripts/build-summaries.mjs';
import { auditExitCode, classifyAudit } from '../../scripts/audit-summaries.mjs';
import { buildNewItems } from '../../scripts/build-new-items.mjs';

test('summary numbers must match a whole numeric token in the source', () => {
  assert.deepEqual(unsupportedNumbers('追蹤 15 名患者', '115 patients were followed'), ['15']);
  assert.deepEqual(unsupportedNumbers('效果量 1.5', 'effect size 11.5'), ['1.5']);
  assert.deepEqual(unsupportedNumbers('改善 15%', 'improved by 0.15'), ['15']);
  assert.deepEqual(unsupportedNumbers('改善 15%', 'improved by 150%'), ['15']);
  // 允許小數截斷：14.8 寫成 14、1.55 寫成 1.5
  assert.deepEqual(unsupportedNumbers('約 14% 與 1.5 倍', 'rate 14.8% and ratio 1.55'), []);
  assert.deepEqual(unsupportedNumbers('納入 15 篇研究', 'We included 15 trials.'), []);
  assert.deepEqual(unsupportedNumbers('2024 共識', 'Consensus statement 2024'), []);
});

test('title duplicates with conflicting DOI or PMID are different papers', () => {
  const a = { title: 'Concussion', url: 'https://doi.org/10.1000/aaa', pmid: '1' };
  assert.equal(identifiersConflict(a, { title: 'Concussion', url: 'https://doi.org/10.1000/bbb' }), true);
  assert.equal(identifiersConflict(a, { title: 'Concussion', url: 'https://x.org', pmid: '2' }), true);
  assert.equal(identifiersConflict(a, { title: 'Concussion', url: 'https://publisher.org/article' }), false);
  assert.equal(identifiersConflict(a, { title: 'Concussion', url: 'https://doi.org/10.1000/AAA' }), false);
});

test('transient PubMed failures are not cached as "no PMID"', async () => {
  const item = { title: 'Swimmer shoulder pain', url: 'https://doi.org/10.1000/abc' };
  const failing = async () => { throw new Error('HTTP 429'); };
  assert.deepEqual(await resolvePmid(item, 'k', {}, failing), { pmid: null, cacheable: false });

  const empty = async () => [];
  assert.deepEqual(await resolvePmid(item, 'k', {}, empty), { pmid: null, cacheable: true });

  let calls = 0;
  const doiFailsTitleEmpty = async (term) => { calls++; if (term.endsWith('[DOI]')) throw new Error('down'); return []; };
  assert.deepEqual(await resolvePmid(item, 'k', {}, doiFailsTitleEmpty), { pmid: null, cacheable: false });
  assert.equal(calls, 2);

  assert.deepEqual(await resolvePmid(item, 'k', { k: '42' }, failing), { pmid: '42', cacheable: false });
  assert.deepEqual(await resolvePmid({ ...item, pmid: '7' }, 'k', {}, failing), { pmid: '7', cacheable: false });
});

test('--all rebuild only replaces the published summaries after a clean run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summaries-'));
  const outPath = join(dir, 'summaries.json');
  writeFileSync(outPath, JSON.stringify({ summaries: { old: '舊摘要' } }));
  const candidate = { model: 'm', summaries: { fresh: '新摘要' } };

  const failed = commitSummaries(outPath, candidate, { redoAll: true, externalErrors: 3 });
  assert.equal(failed.replaced, false);
  assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')).summaries, { old: '舊摘要' });
  assert.ok(existsSync(failed.path), 'candidate kept for inspection');

  const clean = commitSummaries(outPath, candidate, { redoAll: true, externalErrors: 0 });
  assert.equal(clean.replaced, true);
  const published = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.deepEqual(published.summaries, { fresh: '新摘要' });
  assert.equal(published.count, 1);
  assert.equal(existsSync(failed.path), false, 'candidate consumed by the atomic rename');

  const incremental = commitSummaries(outPath, { summaries: { fresh: '新摘要', more: '再一篇' } }, { redoAll: false, externalErrors: 5 });
  assert.equal(incremental.replaced, true, 'incremental runs only add, so partial progress is still published');
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).count, 2);
});

test('summary audit separates passed, mismatched and unverified records', () => {
  const risky = [
    { key: 'a', item: { title: 'Swimmer shoulder pain review' }, pmid: '1' },
    { key: 'b', item: { title: 'ACL return to sport' }, pmid: '2' },
    { key: 'c', item: { title: 'Plantar fasciitis ESWT' }, pmid: '3' },
  ];
  const titles = new Map([['1', 'Swimmer shoulder pain review.'], ['2', 'Shanghai ecosystem simulation']]);
  const result = classifyAudit(risky, titles);
  assert.deepEqual(result.passed.map((r) => r.key), ['a']);
  assert.deepEqual(result.mismatched.map((r) => r.key), ['b']);
  assert.deepEqual(result.unresolved.map((r) => r.key), ['c']);
  assert.equal(auditExitCode(result), 1);
  assert.equal(auditExitCode({ passed: [1], mismatched: [], unresolved: [1] }), 2);
  assert.equal(auditExitCode({ passed: [1], mismatched: [], unresolved: [] }), 0);
});

const paper = (title, url, extra = {}) => ({ title, url, year: 2026, disease: 'knee', ...extra });

test('same-batch correction keeps the published new-items list', () => {
  const A = paper('Old paper', 'https://doi.org/10.1000/old');
  const B = paper('New paper B', 'https://doi.org/10.1000/b');
  const C = paper('New paper C', 'https://doi.org/10.1000/c');
  const prevBatch = { meta: { updated: '2026-09-01' }, items: [A] };
  const firstSync = { meta: { updated: '2026-10-01' }, items: [A, B] };
  const published = buildNewItems(prevBatch, firstSync, null, '2026-10-01');
  assert.deepEqual(published.items.map((i) => i.title), ['New paper B']);

  const tldrB = { ...published, items: [{ ...published.items[0], tldr: '中文摘要' }] };
  const corrected = { meta: { updated: '2026-10-01' }, items: [A, B, C] };
  const result = buildNewItems(firstSync, corrected, tldrB, '2026-10-02');
  assert.deepEqual(result.items.map((i) => i.title).sort(), ['New paper B', 'New paper C']);
  assert.equal(result.items.find((i) => i.title === 'New paper B').tldr, '中文摘要');
  assert.equal(result.previousBatch, '2026-09-01');
  assert.equal(result.count, 2);

  const withdrawn = { meta: { updated: '2026-10-01' }, items: [A, C] };
  assert.deepEqual(buildNewItems(corrected, withdrawn, result, '2026-10-03').items.map((i) => i.title), ['New paper C']);
});

test('new-items title matching respects identifier conflicts', () => {
  const prev = { meta: { updated: '2026-09-01' }, items: [paper('Concussion', 'https://doi.org/10.1000/x', { pmid: '1' })] };
  const sameTitleNewPaper = paper('Concussion', 'https://doi.org/10.1000/y', { pmid: '2' });
  const republished = paper('Concussion', 'https://publisher.org/concussion');
  const next = { meta: { updated: '2026-10-01' }, items: [sameTitleNewPaper, republished] };
  const result = buildNewItems(prev, next, null, '2026-10-01');
  assert.deepEqual(result.items.map((i) => i.url), ['https://doi.org/10.1000/y']);

  const twoPapers = { meta: { updated: '2026-10-01' }, items: [
    paper('Editorial', 'https://doi.org/10.1000/e1', { disease: 'knee' }),
    paper('Editorial', 'https://doi.org/10.1000/e2', { disease: 'hip' }),
    paper('Editorial', 'https://publisher.org/e1', { disease: 'ankle' }),
  ] };
  const deduped = buildNewItems({ meta: { updated: '2026-09-01' }, items: [] }, twoPapers, null, '2026-10-01');
  assert.equal(deduped.items.length, 2);
  assert.deepEqual(deduped.items.find((i) => i.url.endsWith('e1')).diseases, ['knee', 'ankle']);
});
