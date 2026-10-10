import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleKey } from '../../scripts/lib/literature-keys.mjs';

const script = fileURLToPath(new URL('../../scripts/build-summaries.mjs', import.meta.url));
const title = 'Swimmer shoulder pain';
const key = titleKey(title);
const original = JSON.stringify({ generatedAt: '2026-10-01', summaries: { [key]: '原有肩痛摘要', old: '其他既有摘要' } }) + '\n';

function fixture(t, scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'summary-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = join(dir, 'public/data');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'reviews-index.json'), JSON.stringify({ items: [{ title, url: 'https://doi.org/10.1000/abc' }] }));
  writeFileSync(join(data, 'summaries.json'), original);
  // Exercise the real CLI, esearch/efetch parsing, validation, cache, and atomic publication.
  // Unexpected requests fail closed; this fixture never contacts PubMed or a model.
  writeFileSync(join(dir, 'network.mjs'), `
    const scenario = ${JSON.stringify(scenario)};
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/esearch.fcgi')) {
        const doi = url.searchParams.get('term').endsWith('[DOI]');
        if ((doi && scenario.doiFails) || (!doi && scenario.titleFails)) return new Response('', { status: 429 });
        return Response.json({ esearchresult: { idlist: doi || scenario.empty ? [] : ['99'] } });
      }
      if (url.pathname.endsWith('/efetch.fcgi')) {
        if (scenario.fetchFails) return new Response('', { status: 503 });
        return new Response(scenario.missing ? '<PubmedArticleSet/>' :
          '<PubmedArticleSet><PubmedArticle><PMID>99</PMID><ArticleTitle>' +
          (scenario.recordTitle ?? ${JSON.stringify(title)}) +
          '</ArticleTitle><AbstractText>Exercise was assessed.</AbstractText></PubmedArticle></PubmedArticleSet>');
      }
      if (url.pathname === '/api/generate') {
        if (scenario.modelFails) return new Response('', { status: 503 });
        return Response.json({ response: '研究評估運動介入與肩部疼痛的關聯。' });
      }
      throw new Error('Unexpected fixture request: ' + url.pathname);
    };
  `);
  return {
    read: name => readFileSync(join(data, name), 'utf8'),
    exists: name => existsSync(join(data, name)),
    run: () => spawnSync(process.execPath, ['--import', join(dir, 'network.mjs'), script, '--all'], { cwd: dir, encoding: 'utf8', timeout: 15000 }),
  };
}

for (const [name, scenario] of [
  ['DOI failure and empty title search', { doiFails: true, empty: true }],
  ['title search failure', { titleFails: true }],
  ['DOI failure and wrong title candidate', { doiFails: true, recordTitle: 'Shanghai ecosystem simulation' }],
  ['DOI failure and candidate without a title', { doiFails: true, recordTitle: '' }],
  ['DOI failure and missing candidate record', { doiFails: true, missing: true }],
  ['DOI failure and efetch failure', { doiFails: true, fetchFails: true }],
  ['verified fallback followed by model failure', { doiFails: true, modelFails: true }],
]) {
  test(`--all preserves published bytes on ${name}`, t => {
    const f = fixture(t, scenario);
    const result = f.run();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(f.read('summaries.json'), original);
    assert.deepEqual(JSON.parse(f.read('summaries.candidate.json')).summaries, {});
    assert.equal(JSON.parse(f.read('.pmid-cache.json'))[key], undefined, 'unrecovered lookups must remain retryable');
  });
}

test('--all can publish a DOI fallback only after its title is verified', t => {
  const f = fixture(t, { doiFails: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(f.read('summaries.json')).summaries[key], '研究評估運動介入與肩部疼痛的關聯。');
  assert.equal(f.exists('summaries.candidate.json'), false);
});

test('a successful no-result lookup remains a normal skip', t => {
  const f = fixture(t, { empty: true });
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(f.read('.pmid-cache.json'))[key], null);
});
