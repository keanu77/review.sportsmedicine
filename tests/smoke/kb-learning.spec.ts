import { createHash } from 'node:crypto';
import { expect, test, type Page } from './fixtures';

const source = 'https://europepmc.org/article/MED/41107915';
const card = {
  id: 'doi:10.1186/s40001-025-03253-4', topic: 'prp-knee', title: 'Platelet-rich plasma for knee osteoarthritis: a systematic review',
  doi: '10.1186/s40001-025-03253-4', pmid: '41107915', year: 2025,
  sourceUrl: source, sourceCheckedAt: '2026-11-19T00:00:00Z',
  kbRefs: [{ namespace: 'rss-kb', id: 'cmkwq373x001bzr017y89zf0z' }, { namespace: 'ethanai', id: '13271' }],
  identityStatus: 'conflict', evidenceStatus: 'quarantined', sourceFingerprint: 'a'.repeat(64),
  question: '研究族群與介入為何？', fields: [], warnings: ['Ethanai 13271 的全文身分不符，該來源已隔離。'],
  evidenceDraft: {
    sourceUrl: source, sourceSha256: 'b'.repeat(64), sourceCheckedAt: '2026-11-19T00:00:00Z',
    method: 'abstract-paraphrase', reviewStatus: 'needs-clinical-review',
    sections: [
      { key: 'design', text: '系統性回顧與統合分析。', locator: 'abstract:METHODS' },
      { key: 'population', text: '納入膝骨關節炎患者。', locator: 'abstract:METHODS' },
      { key: 'intervention', text: '比較 PRP 相關介入。', locator: 'abstract:METHODS' },
      { key: 'comparison', text: '詳細對照條件需核對全文。', locator: 'abstract:METHODS' },
      { key: 'results', text: '此處為已綁定原始摘要的結果草稿。', locator: 'abstract:RESULTS' },
      { key: 'limitations', text: '未完成全文偏差風險評讀。', locator: 'abstract:CONCLUSIONS' },
    ],
  },
  access: { freeFullText: 'verified', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12535052/', oaStatus: 'unknown', checkedAt: '2026-11-19T00:00:00Z' },
};
const fixture = { schemaVersion: 1, version: 'pilot-learning-v2', generatedAt: '2026-11-19T00:00:00Z', sourceUpdated: '2026-10-01', selectionNote: '測試用固定樣本。', cards: [card] };
const packageEntry = {
  schemaVersion: 1, id: 'f62cc1b7-c3ed-5d36-96c9-28c96d642b14', pilotVersion: fixture.version, paperId: card.id,
  target: { namespace: 'review-pilot', id: card.id, field: 'reading_card' },
  expectedSha256: card.sourceFingerprint, proposedValue: '本機審核批註：請保留研究的不確定性。', reason: '測試來源綁定。',
  evidence: [{ url: source, locator: 'abstract:RESULTS' }],
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const packageHash = createHash('sha256').update(canonical(packageEntry)).digest('hex');
const review = { at: '2026-11-19T00:00:01Z', reviewer: 'fixture-reviewer', reason: '僅為測試操作者聲明。', snapshotSha256: 'c'.repeat(64) };
const imported = { action: 'import', at: '2026-11-19T00:00:00Z' };
const acceptedEvent = { action: 'accept', ...review };
const accepted = {
  schemaVersion: 1, scope: 'local-review-overlay', clinicalApproval: false, productionWrite: false,
  entries: [{ ...packageEntry, review }],
  events: [{ id: packageEntry.id, pilotVersion: fixture.version, paperId: card.id, target: packageEntry.target, packageSha256: packageHash, history: [imported, acceptedEvent] }],
};
const withdrawn = { ...accepted, entries: [], events: [{ ...accepted.events[0], history: [...accepted.events[0].history, { action: 'withdraw', at: '2026-11-19T00:00:02Z', reviewer: review.reviewer, reason: '撤回測試批註。' }] }] };
async function serve(page: Page) {
  await page.route('**/data/kb-pilot.json', route => route.fulfill({ json: fixture }));
  await page.goto('/?view=kb-pilot');
}
async function loadOverlay(page: Page, value: unknown, name = 'feedback-overlay.json') {
  await page.getByLabel('載入本機審核檔').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}

test('learning cards distinguish KB namespaces, original abstract drafts, OA and free access', async ({ page }) => {
  await serve(page);
  await expect(page.getByRole('heading', { name: '摘要閱讀草稿', exact: true })).toBeVisible();
  await expect(page.getByText('AI 依原始摘要整理，尚未完成臨床評讀。', { exact: true })).toBeVisible();
  await expect(page.getByText('此處為已綁定原始摘要的結果草稿。', { exact: true })).toBeVisible();
  await expect(page.getByText('Europe PMC OA：未知', { exact: true })).toBeVisible();
  await expect(page.getByText('再利用授權未確認', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '來源列出的免費全文 ↗', exact: true })).toHaveAttribute('href', card.access.url);
  await page.getByText('查看來源與對應紀錄', { exact: true }).click();
  await expect(page.getByText('RSS 知識庫 #cmkwq373x001bzr017y89zf0z', { exact: true })).toBeVisible();
  await expect(page.getByText('Ethanai #13271', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '下載雙向差異報告', exact: true })).toHaveAttribute('href', '/data/kb-learning.json');
  await expect(page.getByRole('link', { name: '下載待收錄文獻清單', exact: true })).toHaveAttribute('href', '/data/kb-candidates.json');
});

test('accepted local notes can be replaced by withdrawal or cleared without storage or network writes', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await serve(page);
  const storageBefore = await page.evaluate(() => JSON.stringify(localStorage));
  await loadOverlay(page, accepted);
  await expect(page.getByRole('heading', { name: '本機審核批註', exact: true })).toBeVisible();
  await expect(page.getByText(packageEntry.proposedValue, { exact: true })).toBeVisible();
  await loadOverlay(page, withdrawn);
  await expect(page.getByRole('heading', { name: '本機審核批註', exact: true })).toHaveCount(0);
  await loadOverlay(page, accepted);
  await page.getByRole('button', { name: '清除本機批註', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本機審核批註', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(storageBefore);
  expect(writes).toEqual([]);
});

test('non-OA and unconfirmed free access keep the paper and explain an absent abstract', async ({ page }) => {
  await page.route('**/data/kb-pilot.json', route => route.fulfill({ json: {
    ...fixture, cards: [{ ...card, evidenceDraft: undefined, evidenceMissingReason: '原始來源未提供摘要。', access: { freeFullText: 'unknown', oaStatus: 'no', checkedAt: '2026-11-19T00:00:00Z' } }],
  } }));
  await page.goto('/?view=kb-pilot');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('免費全文未確認', { exact: true })).toBeVisible();
  await expect(page.getByText('Europe PMC OA：未標記', { exact: true })).toBeVisible();
  await expect(page.getByText('摘要草稿尚未產生：原始來源未提供摘要。', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '來源列出的免費全文 ↗', exact: true })).toHaveCount(0);
});

test('stale, malformed and oversized overlays retain the accepted local notes', async ({ page }) => {
  await serve(page); await loadOverlay(page, accepted);
  const stale = { ...accepted, entries: [{ ...accepted.entries[0], expectedSha256: 'd'.repeat(64) }] };
  await loadOverlay(page, stale, 'stale.json');
  await expect(page.getByRole('alert').filter({ hasText: '無法套用本機審核檔' })).toBeVisible();
  await expect(page.getByText(packageEntry.proposedValue, { exact: true })).toBeVisible();
  await loadOverlay(page, { ...accepted, unrecognized: true }, 'unknown.json');
  await expect(page.getByRole('alert').filter({ hasText: '無法套用本機審核檔' })).toBeVisible();
  await expect(page.getByText(packageEntry.proposedValue, { exact: true })).toBeVisible();
  await page.getByLabel('載入本機審核檔').setInputFiles({ name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(1_048_577, ' ') });
  await expect(page.getByRole('alert').filter({ hasText: '檔案超過 1 MiB' })).toBeVisible();
  await expect(page.getByText(packageEntry.proposedValue, { exact: true })).toBeVisible();
});

test('learning controls and source drafts remain readable on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(page); await loadOverlay(page, accepted);
  await expect(page.getByRole('heading', { name: '摘要閱讀草稿', exact: true })).toBeVisible();
  await page.getByText('查看來源與對應紀錄', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('heading', { name: '摘要閱讀草稿', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('kb-learning-draft-mobile.png') });
});
