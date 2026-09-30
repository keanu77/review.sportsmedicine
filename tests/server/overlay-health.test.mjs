import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOverlayHealth, readOverlay, readOverlayBaseline } from '../../scripts/overlay-health.ts';

const base = { title: 'A paper', year: 2026, url: 'https://doi.org/10.1234/one', source: 'journal', free: false, tldr: null, region: '膝', disease: 'ACL', themes: [], populations: [] };
const ready = data => ({ status: 'ready', data });
const summaries = ready({ generatedAt: '2026-08-28', summaries: { apaper: 'Ambiguous', safepaper: 'Safe' } });
const tags = ready({ generatedAt: '2026-08-28', tags: { pediatric: { label: '兒童', axis: 'populations', keys: ['apaper', 'safepaper'] } } });

test('monthly overlay coverage deduplicates listings and excludes conflicting summary and tag keys', () => {
  const safe = { ...base, title: 'Safe paper', url: 'https://doi.org/10.1234/safe' };
  const health = buildOverlayHealth([base, { ...base, url: 'https://doi.org/10.1234/two' }, safe, { ...safe, disease: '另一分類' }], [], summaries, tags, '2026-09-28', { summaryCoverage: 50, tagCoverage: 0 });
  assert.equal(health.uniqueCount, 3);
  assert.equal(health.summaryCount, 1);
  assert.equal(health.tagCount, 1);
  assert.equal(health.withheld, 2);
  assert.equal(health.conflicts.size, 1);
  assert.match(health.markdown, /-16\.7 pp/);
  assert.match(health.markdown, /\+33\.3 pp/);
  assert.match(health.markdown, /早於本期上游資料/);
  assert.deepEqual(readOverlayBaseline(health.markdown), health.snapshot);
});

test('missing, invalid and empty optional files are distinguishable; no fabricated zero baseline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'review-overlay-health-'));
  try {
    const file = join(dir, 'overlay.json');
    assert.equal((await readOverlay('summaries', file)).status, 'missing');
    for (const raw of ['{', '{"summaries":[]}', '{"summaries":{"x":3}}', '{"tags":{"x":{"axis":"unknown","label":"X","keys":[]}}}']) {
      await writeFile(file, raw);
      assert.equal((await readOverlay(raw.includes('tags') ? 'tags' : 'summaries', file)).status, 'invalid');
    }
    await writeFile(file, '{"summaries":{}}');
    assert.equal((await readOverlay('summaries', file)).status, 'ready');
    const health = buildOverlayHealth([base], [], { status: 'missing', data: null }, { status: 'invalid', data: null }, '2026-09-28');
    assert.equal(health.snapshot.summaryCoverage, null);
    assert.equal(health.snapshot.tagCoverage, null);
    assert.match(health.markdown, /未取得可比基準/);
    assert.doesNotMatch(health.markdown, /NaN|Infinity|0\.0%/);
    assert.equal(readOverlayBaseline('Old report without coverage'), null);
    assert.equal(readOverlayBaseline('<!-- overlay-health:v1 {"summaryCoverage":1000,"tagCoverage":0} -->'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('multiple tag memberships count each paper once and an empty index has no percentage', () => {
  const safeSummary = ready({ generatedAt: null, summaries: { apaper: 'Summary' } });
  const labels = ready({ generatedAt: null, tags: { a: { label: 'A', axis: 'themes', keys: ['apaper'] }, b: { label: 'B', axis: 'populations', keys: ['apaper'] } } });
  assert.equal(buildOverlayHealth([base], [], safeSummary, labels, '2026-09-28').tagCount, 1);
  const empty = buildOverlayHealth([], [], safeSummary, labels, '2026-09-28');
  assert.equal(empty.snapshot.summaryCoverage, null);
  assert.match(empty.markdown, /無文獻/);
});
