import { expect, test, type Page } from './fixtures';

async function catalog(page: Page) {
  const items = Array.from({ length: 60 }, (_, i) => ({ title: `ACL review ${String(i).padStart(2, '0')}`, year: 2020 + i % 6, url: `https://doi.org/10.1234/paper${i}`, source: 'Test Journal', free: true, tldr: null, region: '膝', disease: 'ACL', themes: [], populations: [] }));
  await page.route('**/data/reviews-index.json', route => route.fulfill({ json: { meta: { updated: '2026-09-30', total: 60, freeCount: 60 }, axes: { region: [{ key: '膝', count: 60 }], theme: [], population: [] }, items } }));
  await page.route('**/data/bibliography.json', route => route.fulfill({ json: { version: 1, records: [] } }));
  await page.route('**/data/summaries.json', route => route.fulfill({ json: { summaries: {} } }));
  await page.route('**/data/tags.json', route => route.fulfill({ json: { tags: {} } }));
  await page.route('**/data/new-items.json', route => route.fulfill({ status: 404 }));
}

test('all sorted results remain reachable, page navigation restores focus and survives reload/back', async ({ page }) => {
  await catalog(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?q=ACL');
  const results = page.getByRole('region', { name: '搜尋結果', exact: true });
  const links = () => results.getByRole('link', { name: '文獻詳情', exact: true }).evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
  const next = results.getByRole('navigation', { name: '搜尋結果分頁（上方）' }).getByRole('button', { name: '下一頁', exact: true });
  await expect(results.getByRole('listitem')).toHaveCount(25);
  await expect(results).toContainText('60 / 60 篇符合');
  const first = await links();
  await next.click();
  await expect(page).toHaveURL(/page=2/);
  await expect(results).toBeFocused();
  await expect(results.getByRole('status')).toContainText('第 2 / 3 頁');
  const second = await links();
  await page.reload();
  await expect(results.getByRole('status')).toContainText('第 2 / 3 頁');
  expect(await links()).toEqual(second);
  await next.click();
  await expect(results.getByRole('listitem')).toHaveCount(10);
  await expect(next).toBeDisabled();
  const third = await links();
  expect(new Set([...first, ...second, ...third]).size).toBe(60);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(results.getByRole('status')).toContainText('第 2 / 3 頁');
  expect(await links()).toEqual(second);
  await page.getByRole('combobox', { name: '搜尋結果排序', exact: true }).selectOption('latest');
  await expect(results.getByRole('status')).toContainText('第 1 / 3 頁');
  await expect(page).not.toHaveURL(/page=/);
  const years = (await results.locator('li > div > span').allTextContents()).map(Number);
  expect(years).toEqual([...years].sort((a, b) => b - a));
  await next.click();
  await page.getByRole('searchbox').fill('review 59');
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(page).not.toHaveURL(/page=/);
});

test('invalid or out-of-range page URLs never leave a nonempty search blank', async ({ page }) => {
  await catalog(page);
  const results = page.getByRole('region', { name: '搜尋結果', exact: true });
  for (const value of ['-2', '1.5', 'Infinity', 'abc']) {
    await page.goto(`/?q=ACL&page=${value}`);
    await expect(results.getByRole('status')).toContainText('第 1 / 3 頁');
    await expect(results.getByRole('listitem')).toHaveCount(25);
  }
  await page.goto('/?q=ACL&page=999');
  await expect(results.getByRole('status')).toContainText('第 3 / 3 頁');
  await expect(results.getByRole('listitem')).toHaveCount(10);
});
