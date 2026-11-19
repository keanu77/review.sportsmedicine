import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from './fixtures';
import type { PilotCard, PilotData } from '../../src/kbPilot';

const source = 'https://doi.org/10.1234/prp';
const prp: PilotCard = {
  id: 'doi:10.1234/prp', topic: 'prp-knee', title: 'Platelet-rich plasma for knee osteoarthritis: a systematic review',
  doi: '10.1234/prp', year: 2026, sourceUrl: source, sourceCheckedAt: '2026-11-19T00:00:00Z',
  reviewUrl: '/papers/doi-10-1234-prp-1234/', kbRefs: [{ namespace: 'ethanai', id: '13271' }],
  identityStatus: 'conflict', evidenceStatus: 'quarantined', sourceFingerprint: 'a'.repeat(64), question: 'PRP 用於膝骨關節炎的研究範圍為何？',
  fields: [{ key: 'population', label: '研究族群', text: '膝骨關節炎', status: 'title-context', sourceUrl: source, locator: 'title' }, { key: 'outcomes', label: '研究結果', text: '仍需回到原文評讀。', status: 'needs-review', sourceUrl: source, locator: 'not-reviewed' }],
  warnings: ['知識庫的全文與書目不符，已隔離。'],
};
const acl: PilotCard = { ...prp, id: 'doi:10.1234/acl', doi: '10.1234/acl', title: 'Return to sport after ACL reconstruction: a review', topic: 'acl-rts', identityStatus: 'matched', evidenceStatus: 'metadata', warnings: [], fields: [], sourceUrl: 'https://doi.org/10.1234/acl' };
const shoulder: PilotCard = { ...prp, id: 'doi:10.1234/shoulder', doi: '10.1234/shoulder', title: 'Hydrodilatation for adhesive capsulitis: a systematic review', topic: 'frozen-shoulder', identityStatus: 'unmatched', evidenceStatus: 'metadata', reviewUrl: undefined, kbRefs: [], warnings: [], fields: [], sourceUrl: 'https://doi.org/10.1234/shoulder' };
const fixture: PilotData = { schemaVersion: 1, version: 'pilot-fixture-v1', generatedAt: '2026-11-19T00:00:00Z', sourceUpdated: '2026-10-01', selectionNote: '這是範圍固定的試點，不代表完整文獻搜尋。', cards: [prp, acl, shoulder] };
async function serve(page: Page, data: unknown = fixture) {
  await page.route('**/data/kb-pilot.json', route => route.fulfill({ json: data }));
}

test('pilot separates topic cohorts, provenance, and quarantined sources', async ({ page }) => {
  await serve(page); await page.goto('/?view=kb-pilot');
  await expect(page.getByRole('heading', { level: 1, name: 'Review × 知識庫閱讀試點' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('來源有衝突・已隔離', { exact: true })).toBeVisible();
  await expect(page.getByText('依題名整理，待核對原文', { exact: true })).toBeVisible();
  await expect(page.getByText('尚待評讀', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '閱讀原始來源 ↗', exact: true })).toHaveAttribute('href', source);
  await page.screenshot({ path: test.info().outputPath('kb-pilot-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: /ACL・重返運動/ }).click();
  await expect(page.getByRole('heading', { name: acl.title })).toBeVisible();
  await expect(page.getByRole('heading', { name: prp.title })).toHaveCount(0);
  await page.getByRole('button', { name: /五十肩/ }).click();
  await expect(page.getByText('Review 待收錄', { exact: true })).toBeVisible();
  await expect(page.getByText('知識庫本次未對應', { exact: true })).toBeVisible();
});

test('feedback download binds the paper revision without network submission', async ({ page }) => {
  await serve(page); const writes: string[] = [];
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto('/?view=kb-pilot');
  await page.getByText('提出閱讀卡修正', { exact: true }).click();
  await page.getByLabel('修正原因').fill('全文與題名不符，請核對來源。');
  await page.getByLabel('建議修正內容').fill('在來源確認前維持隔離。');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '下載待審核修正' }).click();
  const download = await pending; const path = await download.path();
  const json = JSON.parse(await readFile(path!, 'utf8'));
  expect(json.expectedSha256).toBe(prp.sourceFingerprint);
  expect(json.pilotVersion).toBe(fixture.version);
  expect(json.target).toEqual({ namespace: 'review-pilot', id: prp.id, field: 'reading_card' });
  expect(json).not.toHaveProperty('reviewer');
  expect(json.proposedValue).toBe('在來源確認前維持隔離。');
  expect(writes).toEqual([]);
  await expect(page.getByRole('status').filter({ hasText: '修正檔已下載' })).toBeVisible();
});

test('pilot exposes invalid data and can retry, then shows an empty state', async ({ page }) => {
  let valid = false;
  await page.route('**/data/kb-pilot.json', route => route.fulfill({ json: valid ? { ...fixture, cards: [] } : { schemaVersion: 999 } }));
  await page.goto('/?view=kb-pilot');
  await expect(page.getByRole('alert')).toContainText('試點資料暫時無法載入');
  await expect(page.getByRole('link', { name: '返回文獻索引', exact: true })).toBeVisible();
  valid = true;
  await page.getByRole('button', { name: '重新載入試點' }).click();
  await expect(page.getByText('此版本尚無閱讀卡。', { exact: true })).toBeVisible();
});

test('normal index links to the pilot without fetching its data', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/data/kb-pilot.json')) requests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Review × 知識庫閱讀試點' })).toHaveAttribute('href', '/?view=kb-pilot');
  expect(requests).toEqual([]);
});

test('pilot cards and feedback remain usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serve(page); await page.goto('/?view=kb-pilot');
  await page.getByText('提出閱讀卡修正', { exact: true }).click();
  await expect(page.getByLabel('建議修正內容')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('kb-pilot-mobile.png'), fullPage: true });
});

test('real thirty-paper pilot renders every cohort and downloads a source-bound correction', async ({ page }) => {
  const data = await (await page.request.get('/data/kb-pilot.json')).json() as PilotData;
  expect(data.cards).toHaveLength(30);
  await page.goto('/?view=kb-pilot');
  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.getByText('來源有衝突・已隔離', { exact: true })).toHaveCount(1);
  const first = page.getByRole('article').first();
  await first.getByText('提出閱讀卡修正', { exact: true }).click();
  await first.getByLabel('修正原因').fill('整合驗證，非臨床評讀。');
  await first.getByLabel('建議修正內容').fill('僅驗證來源版本與撤回流程，不作醫學結論。');
  const pending=page.waitForEvent('download');
  await first.getByRole('button',{name:'下載待審核修正'}).click();
  const download=await pending;
  await download.saveAs(test.info().outputPath('real-pilot-feedback.json'));
  const result=JSON.parse(await readFile((await download.path())!,'utf8'));
  expect(result.paperId).toBe(data.cards[0].id);
  expect(result.expectedSha256).toBe(data.cards[0].sourceFingerprint);
  await page.getByRole('button', { name: /ACL・重返運動/ }).click();
  await expect(page.getByRole('article')).toHaveCount(10);
  await page.getByRole('button', { name: /五十肩/ }).click();
  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.getByText('Review 待收錄', { exact: true })).toHaveCount(data.cards.filter(card=>card.topic==='frozen-shoulder'&&!card.reviewUrl).length);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('real-pilot-mobile.png'),fullPage:false});
  for(const card of data.cards.filter(c=>c.reviewUrl)) {
    const response=await page.request.get(card.reviewUrl!);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('paper-data');
  }
});
