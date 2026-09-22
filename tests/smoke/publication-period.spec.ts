import { expect, test, type Page } from "./fixtures";

async function dateFixture(page: Page) {
  await page.clock.setFixedTime(new Date(2026, 8, 22, 12));
  const dates = ["2026-09-22", "2026-08-22", "2026-08-21", "2026-03-22", "2025-09-22", "2025-09-21", "2026-09-23", null];
  const items = dates.map((date, index) => ({ title: `Timing review ${index}`, year: date ? Number(date.slice(0, 4)) : 2026,
    url: `https://doi.org/10.1234/timing${index}`, source: "Test Journal", tldr: null, free: index % 2 === 0, region: "膝", disease: "膝痛", themes: [], populations: [] }));
  await page.route("**/data/reviews-index.json", route => route.fulfill({ json: { meta: { updated: "2026-09-22", total: items.length, freeCount: 4 }, axes: { region: [], theme: [], population: [] }, items } }));
  await page.route("**/data/bibliography.json", route => route.fulfill({ json: { version: 1, records: items.map((item, index) => ({ title: item.title, year: item.year, doi: `10.1234/timing${index}`, authors: [], firstPublicationDate: dates[index], source: "Europe PMC", sourceUrl: item.url, verifiedAt: "2026-09-22", matchMethod: "identifier" })) } }));
  await page.route("**/data/new-items.json", route => route.fulfill({ json: { items: [], count: 0 } }));
  await page.route("**/data/summaries.json", route => route.fulfill({ json: { summaries: {} } }));
  await page.route("**/data/tags.json", route => route.fulfill({ json: { tags: {} } }));
}

test("publication periods combine with search and free filter, persist on reload, and clear", async ({ page }) => {
  await dateFixture(page); await page.goto("/?q=Timing");
  const results = page.getByRole("region", { name: "搜尋結果", exact: true });
  const period = page.getByRole("combobox", { name: "發表時間", exact: true });
  await expect(results.getByRole("listitem")).toHaveCount(8);
  for (const [value, count, from] of [["1m", 2, "2026-08-22"], ["6m", 4, "2026-03-22"], ["1y", 5, "2025-09-22"]] as const) {
    await period.selectOption(value);
    await expect(results.getByRole("listitem")).toHaveCount(count);
    await expect(page.getByText(new RegExp(`${from} 至 2026-09-22`))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`period=${value}`));
  }
  await page.reload(); await expect(period).toHaveValue("1y");
  await expect(results.getByRole("listitem")).toHaveCount(5);
  await page.getByRole("checkbox", { name: "只顯示免費全文" }).check();
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "清除時間、年份與文體" }).click();
  await expect(period).toHaveValue("");
  await expect(page).not.toHaveURL(/period=/);
  await expect(results.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("searchbox")).toHaveValue("Timing");
});

test("publication time filters browsing without a keyword and remains usable at 320px", async ({ page }) => {
  await dateFixture(page); await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/?period=1m");
  await expect(page.getByRole("combobox", { name: "發表時間" })).toHaveValue("1m");
  await expect(page.getByRole("button", { name: "膝痛 2 篇", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "膝痛 2 篇", exact: true }).click();
  await expect(page.getByText("首次發表 2026-08-22", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/?q=Timing&period=invalid");
  await expect(page.getByRole("combobox", { name: "發表時間" })).toHaveValue("");
  await expect(page.getByRole("region", { name: "搜尋結果", exact: true }).getByRole("listitem")).toHaveCount(8);
});
