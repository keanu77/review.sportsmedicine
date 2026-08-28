#!/usr/bin/env node
// 產出「本批次新增文獻」清單，供前端最上方的「本月新增文獻」區塊使用。
//
// reviews-index.json 的每筆項目沒有收錄日期欄位，且上游是固定容量的滾動視窗
// （每月有新增也有汰除），因此「新增」只能靠比對同步前後兩份快照得出。
//
// 用法：node scripts/build-new-items.mjs <prev.json> <next.json> <out.json>

import { readFileSync, writeFileSync } from "node:fs";

const [prevPath, nextPath, outPath] = process.argv.slice(2);
if (!prevPath || !nextPath || !outPath) {
  console.error("用法：node scripts/build-new-items.mjs <prev.json> <next.json> <out.json>");
  process.exit(1);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// 標題正規化：去除大小寫與所有非文字/數字字元，吸收標點與空白的細微差異。
const titleKey = (item) =>
  String(item.title ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// 判定為新增需同時滿足「URL 沒見過」與「標題沒見過」——兩者任一命中就視為舊項目。
// 上游偶爾會改寫既有項目的標題或改用另一個來源網址，單靠一種鍵會誤報成新增。
function findAdded(prevItems, nextItems) {
  const seenUrls = new Set(prevItems.map((i) => i.url).filter(Boolean));
  const seenTitles = new Set(prevItems.map(titleKey).filter(Boolean));
  return nextItems.filter(
    (item) => !seenUrls.has(item.url) && !seenTitles.has(titleKey(item)),
  );
}

const prev = readJson(prevPath);
const next = readJson(nextPath);

if (!Array.isArray(prev.items) || !Array.isArray(next.items)) {
  console.error("❌ 輸入 JSON 缺少 items 陣列");
  process.exit(1);
}

// 上游的 items 會讓同一篇文獻依多個 disease 重複列出（主索引刻意如此，方便分組瀏覽），
// 但新增清單是逐篇條列，必須去重；被合併掉的 disease 收進 diseases 一併顯示。
function dedupeByUrl(items) {
  const byUrl = new Map();
  for (const item of items) {
    const key = item.url || titleKey(item);
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...item, diseases: [item.disease].filter(Boolean) });
      continue;
    }
    if (item.disease && !existing.diseases.includes(item.disease)) {
      byUrl.set(key, { ...existing, diseases: [...existing.diseases, item.disease] });
    }
  }
  return [...byUrl.values()];
}

const added = dedupeByUrl(findAdded(prev.items, next.items));

// 新到舊；同年 IF 高者優先。
const sorted = [...added].sort(
  (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.impactFactor ?? -1) - (a.impactFactor ?? -1),
);

const output = {
  batch: next.meta?.updated ?? null, // 上游批次日期（YYYY-MM-DD）
  previousBatch: prev.meta?.updated ?? null,
  syncedAt: new Date().toISOString().slice(0, 10),
  count: sorted.length,
  items: sorted,
};

writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(`✅ ${outPath}：批次 ${output.batch}（前次 ${output.previousBatch}）新增 ${output.count} 篇`);
