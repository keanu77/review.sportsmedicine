import { expect, test } from "@playwright/test";

// 資料呈現的正確性。這些是醫療參考站的信任基礎——數字不對比版面難看嚴重得多。

test("首頁篇數不會隨分類軸改變", async ({ page }) => {
  // 回歸：統計把多值軸的重複歸屬也算進去，同一份資料在三個分頁顯示
  // 911 / 1,291 / 918，沒有一個是真實的唯一文獻數。
  await page.goto("/");
  const total = page.locator("header dd .font-display").first();
  await expect(total).toBeVisible();
  // 資料回來前統計顯示 0，要等真實數字才有比較意義
  await expect.poll(async () => Number((await total.textContent())!.replace(/,/g, "")), {
    timeout: 15_000,
  }).toBeGreaterThan(100);
  const initial = await total.textContent();

  for (const label of ["依臨床主題", "依族群", "依部位"]) {
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await expect(total).toHaveText(initial!);
  }
});

test("切到主題與族群軸時 PubMed 文獻不會消失", async ({ page }) => {
  // 回歸：237 篇 PubMed 文獻的 themes/populations 是空陣列，
  // 在這兩個軸會整批不進分組，首頁文案卻宣稱收錄 PubMed。
  await page.goto("/");

  await page.getByRole("button", { name: /依臨床主題/ }).click();
  await expect(page.getByRole("heading", { name: "未分類主題", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: /依族群/ }).click();
  await expect(page.getByRole("heading", { name: "未標族群", level: 2 })).toBeVisible();
});

test("中文摘要疊加層有載入並標示來源", async ({ page }) => {
  // 疊加層是獨立檔案，路徑或鍵值對不上時前端會靜默沿用舊 tldr——
  // 沒有這條斷言，摘要整批失效不會有人發現。
  await page.goto("/");
  await page.getByRole("searchbox").fill("ACL");
  const results = page.getByRole("region", { name: "搜尋結果" }).getByRole("listitem");
  await expect.poll(() => results.count(), { timeout: 10_000 }).toBeGreaterThan(50);

  const aiTags = page.getByText("AI 摘要", { exact: true });
  await expect.poll(() => aiTags.count()).toBeGreaterThan(10);
});

test("證據類型有標示出來", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("systematic review");
  const first = page
    .getByRole("region", { name: "搜尋結果" })
    .getByRole("listitem")
    .first();
  await expect(first).toContainText(/系統性回顧|統合分析|指引|共識|範疇回顧/);
});

test("靜態站台檔案都在", async ({ request }) => {
  // 這些檔案缺了不會讓建置失敗，只會讓分享預覽、搜尋引擎與訂閱靜默失效。
  for (const path of [
    "/favicon.svg",
    "/og-image.png",
    "/robots.txt",
    "/sitemap.xml",
    "/feed.xml",
    "/data/reviews-index.json",
    "/data/summaries.json",
    "/data/new-items.json",
  ]) {
    const res = await request.get(path);
    expect(res.status(), `${path} 應回 200`).toBe(200);
  }
});
