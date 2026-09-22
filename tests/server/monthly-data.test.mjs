import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateIndex } from '../../scripts/validate-index.mjs';
const data = JSON.parse(readFileSync(new URL('../../public/data/reviews-index.json', import.meta.url), 'utf8'));
test('monthly refresh rejects invalid records, older snapshots and implausible losses before replacement', () => {
  assert.doesNotThrow(() => validateIndex(data, data));
  for (const next of [ {}, { ...data, items: [] }, { ...data, meta: { ...data.meta, updated: '2020-01-01' } }, { ...data, items: data.items.slice(0, 20) }, { ...data, items: [{ ...data.items[0], title: '' }, ...data.items.slice(1)] }, { ...data, items: [{ ...data.items[0], url: 'javascript:alert(1)' }, ...data.items.slice(1)] } ]) {
    assert.throws(() => validateIndex(next, data));
  }
});
