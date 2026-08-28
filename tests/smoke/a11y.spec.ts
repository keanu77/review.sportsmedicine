import { expect, test } from "@playwright/test";

// 可及性回歸。這些 typecheck 與 build 都抓不到，卻是改版前失分最多的地方：
// 分類色盤 11 色中 6 色在淺色底達不到 4.5:1、156 個手風琴按鈕零 aria-expanded、
// 搜尋框只有 placeholder 沒有 label。

/**
 * 等資料載入並渲染完成。
 *
 * 這些檢查都是「掃描整頁、期望找不到問題」的形式，在空白頁面上必然通過。
 * 沒有這道等待，測試會在資料還沒回來時掃到幾個元素就報綠——比沒有測試更糟。
 */
async function waitForContent(page: import("@playwright/test").Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const chips = page.getByRole("navigation", { name: "分類快速導覽" }).getByRole("link");
  await expect.poll(() => chips.count(), { timeout: 15_000 }).toBeGreaterThan(20);
}

/** 在頁面內實算所有可見文字的對比度，回傳不合格的樣式清單。 */
async function contrastFailures(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const luminance = (color: string) => {
      const [r, g, b] = color.match(/[\d.]+/g)!.map(Number);
      const channel = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (fg: string, bg: string) => {
      const a = luminance(fg);
      const b = luminance(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    // 元素自身透明時往上找實際繪製的底色
    const backgroundOf = (el: Element) => {
      let node: Element | null = el;
      let bg = getComputedStyle(node).backgroundColor;
      while (bg === "rgba(0, 0, 0, 0)" && node?.parentElement) {
        node = node.parentElement;
        bg = getComputedStyle(node).backgroundColor;
      }
      return bg;
    };

    const failures: { text: string; color: string; ratio: string; required: number }[] = [];
    document.querySelectorAll("main *").forEach((el) => {
      const hasOwnText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent?.trim(),
      );
      if (!hasOwnText || el.closest(".sr-only")) return;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return;
      const size = parseFloat(style.fontSize);
      const bold = parseInt(style.fontWeight, 10) >= 700;
      // WCAG 1.4.3：大字（≥24px，或 ≥18.66px 且粗體）門檻 3:1，其餘 4.5:1
      const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const value = ratio(style.color, backgroundOf(el));
      if (value < required) {
        failures.push({
          text: el.textContent!.trim().slice(0, 24),
          color: style.color,
          ratio: value.toFixed(2),
          required,
        });
      }
    });
    return failures;
  });
}

test("瀏覽模式所有文字達 WCAG AA 對比", async ({ page }) => {
  await page.goto("/");
  await waitForContent(page);
  expect(await contrastFailures(page)).toEqual([]);
});

test("搜尋結果所有文字達 WCAG AA 對比", async ({ page }) => {
  await page.goto("/?q=ACL");
  const results = page.getByRole("region", { name: "搜尋結果" }).getByRole("listitem");
  await expect.poll(() => results.count(), { timeout: 10_000 }).toBeGreaterThan(50);
  expect(await contrastFailures(page)).toEqual([]);
});

test("語意結構與 landmark 完整", async ({ page }) => {
  await page.goto("/");
  await waitForContent(page);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "分類快速導覽" })).toBeVisible();
  await expect(page.getByRole("link", { name: "跳至主要內容" })).toHaveCount(1);
  // 搜尋框必須有程式化的 label，不能只靠 placeholder
  const labelled = await page
    .getByRole("searchbox")
    .evaluate((el: HTMLInputElement) => el.labels!.length > 0);
  expect(labelled).toBe(true);
});

test("每個手風琴按鈕都宣告展開狀態", async ({ page }) => {
  // 回歸：156~230 個疾病按鈕原本完全沒有 aria-expanded／aria-controls，
  // 螢幕閱讀器無從得知展開與否。
  await page.goto("/");
  await waitForContent(page);
  const buttons = page.locator("h3 > button");
  await expect.poll(() => buttons.count(), { timeout: 15_000 }).toBeGreaterThan(100);

  const missing = await page.evaluate(
    () =>
      [...document.querySelectorAll("h3 > button")].filter(
        (b) => !b.hasAttribute("aria-expanded") || !b.hasAttribute("aria-controls"),
      ).length,
  );
  expect(missing).toBe(0);
});

test("互動元素觸控目標不小於 24px", async ({ page }) => {
  await page.goto("/?q=ACL");
  await expect(
    page.getByRole("region", { name: "搜尋結果" }).getByRole("listitem").first(),
  ).toBeVisible();
  const tooSmall = await page.evaluate(
    () =>
      [...document.querySelectorAll("main button, main a")]
        .map((el) => ({ text: el.textContent?.trim().slice(0, 20), h: el.getBoundingClientRect().height }))
        .filter((x) => x.h > 0 && x.h < 24),
  );
  expect(tooSmall).toEqual([]);
});
