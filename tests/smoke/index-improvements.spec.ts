import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("facets combine with search, survive reload, and preserve return context", async ({ page }) => {
  await page.goto("/?q=ACL");
  const results = page.getByRole("region", { name: "搜尋結果", exact: true });
  await expect(results.getByRole("listitem").first()).toBeVisible();
  await page.getByRole("combobox", { name: "篩選部位", exact: true }).selectOption("膝");
  await expect(page).toHaveURL(/region=/);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "篩選部位", exact: true })).toHaveValue("膝");
  await expect(results.getByRole("listitem").first()).toBeVisible();
  await results.getByRole("link", { name: "文獻詳情", exact: true }).first().click();
  await expect(page).toHaveURL(/\/papers\/.+\/?\?from=/);
  await page.getByRole("link", { name: "← 返回文獻索引", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("ACL");
  await expect(page.getByRole("combobox", { name: "篩選部位", exact: true })).toHaveValue("膝");
});

test("library backup round trip and archived snapshot remain readable", async ({ page }) => {
  await page.goto("/?q=ACL");
  const row = page.getByRole("region", { name: "搜尋結果", exact: true }).getByRole("listitem").first();
  await row.getByRole("button", { name: "收藏", exact: true }).click();
  await page.locator("summary").filter({ hasText: "閱讀狀態與備份" }).click();
  const library = page.getByRole("region", { name: /我的文獻庫/ });
  await library.getByRole("combobox", { name: /^閱讀狀態：/ }).selectOption("read");
  const download = page.waitForEvent("download");
  await library.getByRole("button", { name: "匯出 JSON 備份", exact: true }).click();
  const file = await (await download).path();
  const backup = await readFile(file!, "utf8");
  await page.evaluate(() => localStorage.clear());
  await page.route("**/data/reviews-index.json", route => route.fulfill({ json: { meta: { updated: "2026-10-20", total: 0, freeCount: 0 }, axes: { region: [], theme: [], population: [] }, items: [] } }));
  await page.reload();
  await page.locator("summary").filter({ hasText: "閱讀狀態與備份" }).click();
  await library.getByLabel("匯入文獻庫 JSON 備份").setInputFiles({ name: "library.json", mimeType: "application/json", buffer: Buffer.from(backup) });
  await expect(library.getByRole("combobox", { name: /^閱讀狀態：/ })).toHaveValue("read");
  await library.getByRole("button", { name: "開啟文獻詳情" }).click();
  await expect(page).toHaveURL(/#paper=/);
  await expect(page.getByRole("region", { name: "文獻詳情" }).getByRole("heading", { level: 1 })).toBeVisible();
});

test("paper HTML contains metadata and content without JavaScript", async ({ request, browser }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  const paths = [...xml.matchAll(/<loc>https:\/\/review.sportsmedicine.tw([^<]+)<\/loc>/g)].map(x => x[1]);
  expect(paths.filter(path => path.startsWith("/papers/")).length).toBeGreaterThan(800);
  expect(paths.some(path => path.includes("workbench"))).toBe(false);
  const path = paths.find(path => path.startsWith("/papers/"))!;
  const html = await (await request.get(path)).text();
  expect(html).toContain(`<link rel="canonical" href="https://review.sportsmedicine.tw${path}"`);
  expect(html).toContain(`property="og:url" content="https://review.sportsmedicine.tw${path}"`);
  expect(html).toContain('id="paper-data"');
  expect(html).not.toContain('href="/workbench/"');
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`http://localhost:4180${path}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "中文閱讀摘要" })).toBeVisible();
  await context.close();
});

test("mobile reduced-motion keeps search and detail content visible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?q=冰凍肩");
  const results = page.getByRole("region", { name: "搜尋結果" });
  await expect(results.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: /篩選與排序/ }).click();
  const widths = await page.getByRole("combobox").evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().width));
  expect(widths.every(width => width >= 100)).toBe(true);
  await page.getByRole("combobox", { name: "篩選部位", exact: true }).selectOption("肩");
  await expect(page.locator(".motion-feedback").first()).toBeVisible();
  expect(await page.locator(".motion-feedback").first().evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await results.getByRole("link", { name: "文獻詳情", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("development fallback accepts full bibliography when the search projection is an HTML fallback", async ({ page }) => {
  await page.route("**/data/bibliography-index.json", route => route.fulfill({ contentType: "text/html", body: "<html>Vite fallback</html>" }));
  await Promise.all([page.waitForResponse("**/data/bibliography.json"), page.goto("/?q=Yan%20R")]);
  const rows = page.getByRole("region", { name: "搜尋結果", exact: true }).getByRole("listitem");
  await expect(rows.filter({ hasText: "Optimal resistance training prescriptions" })).toHaveCount(1);
});

test("topic route also renders when no generated bootstrap exists", async ({ page }) => {
  await page.route("**/topics/acl/", async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace(/<script type="application\/json" id="topic-data">[\s\S]*?<\/script>/, "");
    await route.fulfill({ response, body: html });
  });
  await Promise.all([page.waitForResponse("**/data/reviews-index.json"), page.goto("/topics/acl/")]);
  await expect(page.getByRole("heading", { name: "前十字韌帶與運動回歸", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "搜尋全部結果與調整篩選" })).toHaveAttribute("href", "/?q=ACL");
});
