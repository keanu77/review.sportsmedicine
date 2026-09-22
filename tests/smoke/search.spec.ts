import { expect, test, type Page } from "./fixtures";

// 檢索是這個站的核心，也是改版前壞得最徹底的地方。
// 每一條斷言都對應一個**實際發生過的**回歸，門檻刻意留寬（>50 而非 ==75），
// 資料每月更新才不會誤報。

/**
 * 取得搜尋結果筆數。
 *
 * 不要用 `expect.poll(() => locator.count()).toBeLessThan(n)`：poll 會重試到通過為止，
 * 而結果尚未 render 時 count 是 0，任何上界斷言都會在初始空狀態立刻假通過。
 * 改成等結果列的計數文字出現，再讀那個數字——它只在結果算完後才渲染。
 */
async function searchCount(page: Page, term: string): Promise<number> {
  await page.getByRole("searchbox").fill(term);
  const summary = page.getByText(/\d+ \/ \d+ 篇符合/);
  await expect(summary).toBeVisible({ timeout: 10_000 });
  const text = await summary.innerText();
  return Number(text.match(/^(\d+)/)![1]);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("縮寫搜尋涵蓋中文病名的文獻", async ({ page }) => {
  // 回歸：原本只比對 title + disease，ACL 僅命中標題含縮寫的 22 篇，
  // 病名為「前十字韌帶損傷」的另外 47 篇看不到。
  expect(await searchCount(page, "ACL")).toBeGreaterThan(50);
});

test("原本命中 0 的臨床縮寫現在找得到", async ({ page }) => {
  // 回歸：RTP / RED-S / IJSPT 在別名表與全欄位比對之前全部命中 0。
  expect(await searchCount(page, "RTP")).toBeGreaterThan(30);
  expect(await searchCount(page, "RED-S")).toBeGreaterThan(5);
  expect(await searchCount(page, "IJSPT")).toBeGreaterThan(30);
});

test("兩字母縮寫不會炸開成整個資料集", async ({ page }) => {
  // 回歸：裸 String.includes 讓 at 命中 846/911 篇（吃到 systematic、meta）、ct 445 篇。
  expect(await searchCount(page, "at")).toBeLessThan(60);
  expect(await searchCount(page, "ct")).toBeLessThan(60);
});

test("單一漢字仍可檢索且精確", async ({ page }) => {
  // 漢字資訊密度高，不該比照拉丁短詞被擋掉；「膝」應該回該部位的量級。
  const count = await searchCount(page, "膝");
  expect(count).toBeGreaterThan(100);
  expect(count).toBeLessThan(400);
});

test("檢索狀態寫進網址，可分享與加書籤", async ({ page }) => {
  await page.getByRole("searchbox").fill("ACL");
  await expect(page).toHaveURL(/\?q=ACL/);

  await page.goto("/?q=ACL");
  await expect(page.getByRole("searchbox")).toHaveValue("ACL");
  await expect(page.getByText(/\d+ \/ \d+ 篇符合/)).toBeVisible();
});

test("查無結果時給得出復原路徑", async ({ page }) => {
  await page.getByRole("searchbox").fill("zzzznotfoundquery");
  await expect(page.getByText(/找不到/)).toBeVisible();
  await expect(page.getByRole("button", { name: "清除搜尋" })).toBeVisible();
});
