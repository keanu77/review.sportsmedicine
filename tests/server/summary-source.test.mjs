import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceForSummary } from '../../scripts/build-summaries.mjs';
import { europePmcRecord } from '../../scripts/bibliography-source.ts';
import { paperKey } from '../../src/identity.ts';

test('summary generation requires a verified source abstract and exact compatible identity', () => {
  const item = { title: 'Knee pain review', year: 2025, url: 'https://doi.org/10.1234/review', pmid: '123' };
  const record = europePmcRecord({ id: '123', pmid: '123', source: 'MED', title: item.title, doi: '10.1234/review', pubYear: '2025', abstractText: 'The certainty of evidence was low.' }, '2026-10-20');
  assert.equal(sourceForSummary(item, [record]).abstract.text, 'The certainty of evidence was low.');
  assert.equal(sourceForSummary({ ...item, pmid: '999' }, [record]).reason, 'source-bibliography-unresolved');
  assert.equal(sourceForSummary(item, [{ ...record, abstract: null }]).reason, 'abstract-not-supplied-by-source');
  assert.equal(sourceForSummary(item, [record], new Map([[paperKey(item), [item]]])).reason, 'conflicting-identifiers-for-title-overlay');
  assert.equal(sourceForSummary(item, [{ ...record, abstract: { ...record.abstract, sourceUrl: 'javascript:alert(1)' } }]).reason, 'abstract-not-supplied-by-source');
  assert.equal(sourceForSummary(item, [{ ...record, abstract: { ...record.abstract, excerptOnly: true } }]).reason, 'full-source-abstract-not-cached');
});
