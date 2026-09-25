import { expect, test, type Page } from "./fixtures";

async function sourceFixture(page: Page) {
  const item = { title: "An Umbrella Review Following PRIOR Guideline", year: 2026, url: "https://doi.org/10.1234/prior", source: "Test Journal", free: true, tldr: "原始摘要", region: "膝", disease: "膝痛", themes: [], populations: [] };
  const key = "anumbrellareviewfollowingpriorguideline";
  await page.route("**/data/reviews-index.json", route => route.fulfill({ json: { meta: { updated: "2026-09-21", total: 1, freeCount: 1 }, axes: { region: [{ key: "膝", count: 1 }], theme: [], population: [] }, items: [item] } }));
  await page.route("**/data/new-items.json", route => route.fulfill({ json: { batch: "2026-09-21", previousBatch: "2026-08-21", syncedAt: "2026-09-21", count: 1, items: [item] } }));
  await page.route("**/data/summaries.json", route => route.fulfill({ json: { summaries: { [key]: "共用中文疊加摘要" } } }));
  await page.route("**/data/tags.json", route => route.fulfill({ json: { tags: { rehab: { label: "新增復健主題", axis: "themes", keys: [key] } } } }));
}

test("removing the last favorite keeps an exit from favorite-only view", async ({ page }) => {
  await sourceFixture(page); await page.goto("/?q=PRIOR");
  const results = page.getByRole("region", { name: "搜尋結果" });
  await results.getByRole("button", { name: "收藏", exact: true }).click();
  await page.getByRole("checkbox", { name: "只看收藏（1）" }).check();
  await results.getByRole("button", { name: "已收藏", exact: true }).click();
  const filter = page.getByRole("checkbox", { name: "只看收藏（0）" });
  // Unchecking removes this now-empty filter; click must not re-query its checked state after unmount.
  await expect(filter).toBeVisible(); await filter.click();
  await expect(results.getByRole("listitem")).toHaveCount(1);
});

test("new item list receives shared summaries and favorite handlers", async ({ page }) => {
  await sourceFixture(page); await page.goto("/");
  await page.getByRole("button", { name: /(?:本月|最新)新增文獻/ }).click();
  await expect(page.getByText("共用中文疊加摘要", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "只看收藏（1）" })).toBeVisible();
  await page.getByRole("searchbox").fill("新增復健主題");
  await expect(page.getByRole("region", { name: "搜尋結果" }).getByRole("listitem")).toHaveCount(1);
});

test("public details have stable identifiers and distinguish free flags from verified PDFs", async ({ page }) => {
  await sourceFixture(page); await page.goto("/?q=PRIOR");
  const results = page.getByRole("region", { name: "搜尋結果" });
  await expect(results.getByText("傘狀回顧", { exact: true })).toBeVisible();
  await results.getByRole("link", { name: "文獻詳情", exact: true }).click();
  await expect(page).toHaveURL(/#paper=doi%3A10\.1234%2Fprior/);
  await expect(page.getByText(/尚未逐篇驗證 PDF 與再利用授權/)).toBeVisible();
  await expect(page.locator('a[href*="workbench"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("An Umbrella Review Following PRIOR Guideline");
});

test("same-title papers with different DOIs keep separate sources and favorites", async ({ page }) => {
  await sourceFixture(page);
  const base = { title: "An Umbrella Review Following PRIOR Guideline", source: "Test Journal", free: true, tldr: null, region: "膝", disease: "膝痛", themes: [], populations: [] };
  await page.route("**/data/reviews-index.json", route => route.fulfill({ json: {
    meta: { updated: "2026-09-21", total: 2, freeCount: 2 }, axes: { region: [{ key: "膝", count: 2 }], theme: [], population: [] },
    items: [{ ...base, year: 2025, url: "https://doi.org/10.1234/first", pmid: "12345671" }, { ...base, year: 2026, url: "https://doi.org/10.1234/second", pmid: "12345672" }],
  } }));
  await page.goto("/?q=PRIOR");
  const rows = page.getByRole("region", { name: "搜尋結果" }).getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByRole("link", { name: "文獻詳情" })).toHaveAttribute("href", /doi%3A10\.1234%2Fsecond/);
  await expect(rows.nth(1).getByRole("link", { name: "文獻詳情" })).toHaveAttribute("href", /doi%3A10\.1234%2Ffirst/);
  await rows.nth(0).getByRole("button", { name: "收藏", exact: true }).click();
  await expect(rows.nth(0).getByRole("button", { name: "已收藏", exact: true })).toBeVisible();
  await expect(rows.nth(1).getByRole("button", { name: "收藏", exact: true })).toBeVisible();
});

test("public pages never link to the private workbench, which stays reachable by typing its path", async ({ page }) => {
  await sourceFixture(page); await page.goto("/?q=PRIOR");
  await expect(page.getByRole("region", { name: "搜尋結果" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.locator('a[href*="workbench"]')).toHaveCount(0);
  await expect(page.getByText("私人工作台")).toHaveCount(0);
  await page.goto("/workbench/");
  await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "私人工作台" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "主要導覽" }).getByRole("link", { name: "公開文獻索引" })).toBeVisible();
});
