import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { enrichItems, overlayConflicts } from '../../src/enrich.ts';
import { paperKey } from '../../src/identity.ts';
import type { BibliographyEntry, Item, TagsData } from '../../src/types.ts';

const base: Item = { title: 'A review of ACL', year: 2026, url: 'https://example.org/paper', source: 'journal', free: false, tldr: 'Original source summary', region: '膝', disease: 'ACL', themes: ['舊分類'], populations: [] };
const key = paperKey(base), summaries = { [key]: 'Legacy AI summary' };
const tags: TagsData['tags'] = { rehab: { label: '復健', axis: 'themes', keys: [key] } };

test('conflicting DOI, PMID or PMCID blocks legacy summaries and tag additions, including identifierless rows', () => {
  for (const ids of [{ doi: ['10.1234/one', '10.1234/two'] }, { pmid: ['111', '222'] }, { pmcid: ['PMC111', 'PMC222'] }]) {
    const [field, values] = Object.entries(ids)[0];
    const items = [{ ...base, [field]: values[0] }, { ...base, [field]: values[1], tldr: 'Second original' }, base];
    for (const catalog of [items, [...items].reverse()]) {
      const actual = enrichItems(catalog, summaries, tags);
      assert.deepEqual(actual.map(item => item.tldr), catalog.map(item => item.tldr));
      assert.ok(actual.every(item => item.tldrSource !== 'local-llm' && !item.themes.includes('復健')));
      assert.deepEqual([...overlayConflicts(catalog).keys()], [key]);
    }
  }
});

test('duplicate listings of the same DOI still receive overlays and preserve taxonomy renames', () => {
  const items = [{ ...base, url: 'https://doi.org/10.1234/one' }, { ...base, doi: '10.1234/one', disease: '另一分類' }];
  const actual = enrichItems(items, summaries, { ...tags, rename: { label: '新分類', axis: 'themes', keys: [], absorbs: ['舊分類'] } });
  assert.ok(actual.every(item => item.tldr === summaries[key] && item.tldrSource === 'local-llm'));
  assert.deepEqual(actual[0].themes, ['新分類', '復健']);
});

test('new-items subset is checked against the full catalog, not just its own rows', () => {
  const first = { ...base, doi: '10.1234/first' }, second = { ...base, doi: '10.1234/second' };
  assert.equal(enrichItems([first], summaries, tags, [], [second])[0].tldr, base.tldr);
});

test('bibliography-revealed identifier conflicts also block title overlays', () => {
  const items = [{ ...base, year: 2020 }, { ...base, year: 2026 }];
  const records: BibliographyEntry[] = items.map((item, i) => ({ title: item.title, year: item.year, doi: `10.1234/${i}`, authors: ['A Author'], source: 'Crossref', sourceUrl: 'https://api.crossref.org', verifiedAt: '2026-09-30', matchMethod: 'exact-title-year' }));
  const actual = enrichItems(items, summaries, tags, records);
  assert.equal(actual[0].doi, '10.1234/0');
  assert.equal(actual[1].doi, '10.1234/1');
  assert.ok(actual.every(item => item.tldr === base.tldr));
});
