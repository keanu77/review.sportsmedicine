import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBibliography } from '../../scripts/validate-public-data.mjs';

const stamp = '2026-10-20T00:00:00.000Z';
const sourceUrl = 'https://europepmc.org/article/MED/123';
const record = {
  title: 'Review article', year: 2025, pmid: '123', pmcid: 'PMC123', authors: ['Wu YC'], source: 'Europe PMC', sourceUrl, verifiedAt: stamp, matchMethod: 'identifier',
  fullText: { status: 'verified', url: 'https://europepmc.org/articles/PMC123', sourceUrl, verifiedAt: stamp, license: 'cc by' },
  abstract: { text: 'Source abstract findings.', source: 'Europe PMC', sourceUrl, verifiedAt: stamp, excerptOnly: false, license: 'cc by', sections: [{ label: 'Results', text: 'Source abstract findings.' }] },
};
const bundle = entry => ({ version: 1, generatedAt: stamp, records: [entry], unresolved: [] });

test('trusted monthly validator admits the checked abstract and full-text contract', () => {
  assert.doesNotThrow(() => validateBibliography(bundle(record)));
  assert.doesNotThrow(() => validateBibliography(bundle({ ...record, abstract: { text: 'A short source excerpt.', source: 'Europe PMC', sourceUrl, verifiedAt: stamp, excerptOnly: true } })));
  assert.doesNotThrow(() => validateBibliography(JSON.parse(readFileSync(new URL('../../public/data/bibliography.json', import.meta.url), 'utf8'))));
});

test('trusted validator rejects unsafe URLs, mismatched provenance and unlicensed copied abstracts', () => {
  for (const change of [
    { fullText: { ...record.fullText, url: 'javascript:alert(1)' } },
    { fullText: { ...record.fullText, url: 'https://127.0.0.1/private' } },
    { fullText: { ...record.fullText, url: 'https://europepmc.org/articles/PMC999' } },
    { fullText: { ...record.fullText, sourceUrl: 'https://europepmc.org/article/MED/999' } },
    { abstract: { ...record.abstract, sourceUrl: 'https://europepmc.org/article/MED/999' } },
    { abstract: { ...record.abstract, license: 'cc by-nc-nd' } },
    { abstract: { ...record.abstract, excerptOnly: true } },
    { abstract: { text: Array(26).fill('word').join(' '), source: 'Europe PMC', sourceUrl, verifiedAt: stamp, excerptOnly: true } },
    { abstract: { ...record.abstract, fabricatedClinicalReview: true } },
  ]) assert.throws(() => validateBibliography(bundle({ ...record, ...change })));
});
