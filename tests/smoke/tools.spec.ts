import { expect, test } from "@playwright/test";

// 臨床使用者實際會按的東西。

test("複製引用會回饋成功", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("searchbox").fill("ACL");
  const first = page
    .getByRole("region", { name: "搜尋結果" })
    .getByRole("listitem")
    .first();
  await expect(first).toBeVisible();

  await first.getByRole("button", { name: "複製引用" }).click();
  await expect(first.getByRole("button", { name: "已複製" })).toBeVisible();

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toMatch(/PMID:|doi:/); // 至少要有一個可回溯的識別碼
});

test("BibTeX 會跳脫 LaTeX 特殊字元", async ({ page, context }) => {
  // 回歸：期刊名裡的 & 未跳脫，貼進 LaTeX 會編譯失敗。
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("searchbox").fill("Scandinavian");
  const first = page
    .getByRole("region", { name: "搜尋結果" })
    .getByRole("listitem")
    .first();
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: "BibTeX" }).click();

  const bibtex = await page.evaluate(() => navigator.clipboard.readText());
  expect(bibtex).toContain("@article{");
  // 未跳脫的 & 前面不會是反斜線
  expect(bibtex).not.toMatch(/(?<!\\)&/);
});

test("收藏會存進 localStorage 並出現篩選", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("ACL");
  const first = page
    .getByRole("region", { name: "搜尋結果" })
    .getByRole("listitem")
    .first();
  await expect(first).toBeVisible();

  await first.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(first.getByRole("button", { name: "已收藏" })).toBeVisible();

  const stars = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("review.stars") ?? "[]"),
  );
  expect(stars).toHaveLength(1);

  await page.getByRole("searchbox").fill("");
  await expect(page.getByText(/只看收藏（1）/)).toBeVisible();
});

test("斜線捷徑聚焦搜尋框", async ({ page }) => {
  await page.goto("/");
  await page.locator("body").press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
});
