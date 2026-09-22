import { expect, test, type Page } from "./fixtures";

const DOI = "10.1007/s40520-025-03235-w";
const TITLE = "Optimal resistance training prescriptions to improve muscle strength, physical function, and muscle mass in older adults diagnosed with sarcopenia";

async function openSearch(page: Page, query: string) {
  // Use the shipped overlay, and wait for it to arrive before checking identifier/author behavior.
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/data/bibliography.json") && response.ok()),
    page.goto(`/?${new URLSearchParams({ q: query })}`),
  ]);
  await expect(page.getByRole("searchbox")).toHaveValue(query);
  return page.getByRole("region", { name: "搜尋結果", exact: true });
}

for (const [label, query] of [
  ["DOI", DOI],
  ["DOI canonical URL", `https://doi.org/${DOI}?utm_source=smoke`],
  ["PMID", "PMID:41212331"],
  ["PMCID", "PMC12602684"],
  ["PubMed canonical URL", "https://pubmed.ncbi.nlm.nih.gov/41212331/"],
  ["PMC canonical URL", "https://pmc.ncbi.nlm.nih.gov/articles/PMC12602684/"],
] as const) {
  test(`${label} 找到同一篇文獻且不重複`, async ({ page }) => {
    const results = await openSearch(page, query);
    await expect(results.getByText(/^1 \/ \d+ 篇符合/)).toBeVisible();
    await expect(results.getByRole("listitem")).toHaveCount(1);
    await expect(results.getByRole("link", { name: new RegExp(`^${TITLE}`) })).toBeVisible();
  });
}

test("作者搜尋可開啟含書目來源、查核日期與卷期頁碼的詳情", async ({ page }) => {
  const results = await openSearch(page, "Yan R");
  await expect(results).toBeVisible();
  const row = results.getByRole("listitem").filter({ hasText: TITLE });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: "文獻詳情", exact: true }).click();

  const details = page.getByRole("region", { name: "文獻詳情", exact: true });
  await expect(details.getByRole("heading", { level: 1 })).toContainText(TITLE);
  await expect(details.getByText("Yan R, Chen Y, Zhang R, He J, Lin W, Sun J, Li D", { exact: true })).toBeVisible();
  await expect(details.getByText("41212331 / PMC12602684", { exact: true })).toBeVisible();
  await expect(details.getByText("37 ／ 1 ／ 320", { exact: true })).toBeVisible();
  await expect(details.getByRole("link", { name: "Europe PMC", exact: true })).toHaveAttribute("href", "https://europepmc.org/article/MED/41212331");
  await expect(details.locator("dl")).toContainText(/Europe PMC · \d{4}-\d{2}-\d{2}/);
  await expect(details.getByText("僅核對書目欄位；不代表已查核全文內容、研究品質或授權。", { exact: true })).toBeVisible();
  await expect(details.getByText(/2025;37\(1\):320\./)).toBeVisible();
});

test("相關度與最新年份排序說明一致，重新整理後保留選擇", async ({ page }) => {
  let results = await openSearch(page, "ACL");
  const sort = page.getByRole("combobox", { name: "搜尋結果排序", exact: true });
  await expect(sort).toHaveValue("relevance");
  await expect(results).toContainText("依相關度");

  await sort.selectOption("latest");
  await expect(page).toHaveURL(/[?&]sort=latest(?:&|$)/);
  await expect(results).toContainText("依年份新到舊");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "搜尋結果排序", exact: true })).toHaveValue("latest");
  await expect(page.getByRole("searchbox")).toHaveValue("ACL");
  results = page.getByRole("region", { name: "搜尋結果", exact: true });
  await expect(results).toContainText("依年份新到舊");
  const years = await results.locator("li > div > span").allTextContents();
  const parsed = years.map(Number);
  expect(parsed.length).toBeGreaterThan(1);
  expect(parsed.every(Number.isFinite)).toBe(true);
  expect(parsed).toEqual([...parsed].sort((a, b) => b - a));
});
