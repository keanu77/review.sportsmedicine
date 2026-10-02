import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('../../', import.meta.url).pathname;

test('a Europe PMC outage publishes the verified bibliography instead of blocking the month', () => {
  const root = mkdtempSync(join(tmpdir(), 'bibliography-'));
  for (const name of ['scripts', 'src', 'package.json']) cpSync(join(repo, name), join(root, name), { recursive: true });
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  mkdirSync(join(root, 'public/data'), { recursive: true });
  const kept = { title: 'Kept record', sourceUrl: 'https://europepmc.org/article/MED/1', pmid: '1', doi: '10.1000/kept', firstPublicationDate: null };
  writeFileSync(join(root, 'public/data/bibliography.json'), JSON.stringify({ version: 1, generatedAt: '2026-09-01T00:00:00Z', records: [kept], unresolved: [] }));
  const item = { title: 'Unreachable paper', year: 2026, url: 'https://doi.org/10.1000/new', source: '', free: false, tldr: null, region: '', disease: '', themes: [], populations: [] };
  writeFileSync(join(root, 'public/data/reviews-index.json'), JSON.stringify({ meta: { updated: '2026-10-01' }, items: [item] }));

  const offline = 'data:text/javascript,globalThis.fetch=async()=>{throw new TypeError("fetch failed")}';
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--import', offline, 'scripts/build-bibliography.ts'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, BIBLIOGRAPHY_CACHE_DIR: join(root, 'cache'), GITHUB_STEP_SUMMARY: join(root, 'summary.md') }, timeout: 60000,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /::warning::/);
  const saved = JSON.parse(readFileSync(join(root, 'public/data/bibliography.json'), 'utf8'));
  assert.equal(saved.records.length, 1, 'verified records are kept');
  assert.match(saved.unresolved[0].reason, /^source-unavailable/, 'the paper is retried next month');
  assert.match(readFileSync(join(root, 'summary.md'), 'utf8'), /1/);
});
