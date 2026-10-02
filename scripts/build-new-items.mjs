#!/usr/bin/env node
// 產出「本批次新增文獻」清單，供前端最上方的「本月新增文獻」區塊使用。
//
// reviews-index.json 的每筆項目沒有收錄日期欄位，且上游是固定容量的滾動視窗
// （每月有新增也有汰除），因此「新增」只能靠比對同步前後兩份快照得出。
//
// 上游偶爾會對同一批次發補正版（meta.updated 不變）。此時「前一份快照」已經包含本批新增，
// 直接比對會把清單算成近乎 0，所以同批次補正要沿用既有清單，再併入補正新增的篇目。
//
// 用法：node scripts/build-new-items.mjs <prev.json> <next.json> <out.json>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { identifiersConflict, titleKey } from "./lib/literature-keys.mjs";

const keyOf = (item) => titleKey(item.title);

/** 同一篇：網址相同，或正規化標題相同且 DOI／PMID 沒有衝突。 */
const sameRecord = (a, b) =>
  (a.url && a.url === b.url) || (keyOf(a) !== "" && keyOf(a) === keyOf(b) && !identifiersConflict(a, b));

// 判定為新增需同時滿足「URL 沒見過」與「標題沒見過」——兩者任一命中就視為舊項目。
// 上游偶爾會改寫既有項目的標題或改用另一個來源網址，單靠一種鍵會誤報成新增。
// 但標題相同而識別碼衝突的（短標題撞名），是不同的文獻。
function findAdded(prevItems, nextItems) {
  const seenUrls = new Set(prevItems.map((i) => i.url).filter(Boolean));
  const byTitle = Map.groupBy(prevItems.filter((i) => keyOf(i)), keyOf);
  return nextItems.filter(
    (item) =>
      !seenUrls.has(item.url) && !(byTitle.get(keyOf(item)) ?? []).some((old) => !identifiersConflict(old, item)),
  );
}

// 上游的 items 會讓同一篇文獻依多個 disease 重複列出（主索引刻意如此，方便分組瀏覽），
// 但新增清單是逐篇條列，必須去重；被合併掉的 disease 收進 diseases 一併顯示。
// 用標題當鍵，不用網址——同一篇文獻會同時收錄 DOI 版與出版社版兩個網址。
function dedupePapers(items) {
  const records = [];
  for (const item of items) {
    const at = records.findIndex((r) => sameRecord(r, item));
    if (at === -1) {
      records.push({ ...item, diseases: [item.disease].filter(Boolean) });
      continue;
    }
    const existing = records[at];
    if (item.disease && !existing.diseases.includes(item.disease)) {
      records[at] = { ...existing, diseases: [...existing.diseases, item.disease] };
    }
  }
  return records;
}

/** 沿用既有清單已補好的中文摘要，補正版不必重跑 LLM。 */
function carrySummary(record, previousRecords) {
  if (record.tldr) return record;
  const match = previousRecords.find((old) => old.tldr && sameRecord(old, record));
  return match ? { ...record, tldr: match.tldr, tldrSource: match.tldrSource } : record;
}

export function buildNewItems(prev, next, existing, syncedAt) {
  const batch = next.meta?.updated ?? null;
  const sameBatch = batch !== null && prev.meta?.updated === batch && existing?.batch === batch;
  const carried = sameBatch ? existing.items : [];

  const added = new Set(findAdded(prev.items, next.items));
  const fresh = next.items.filter((item) => added.has(item) || carried.some((old) => sameRecord(old, item)));
  const records = dedupePapers(fresh).map((record) => carrySummary(record, existing?.items ?? []));

  // 新到舊；同年 IF 高者優先。
  const sorted = [...records].sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.impactFactor ?? -1) - (a.impactFactor ?? -1),
  );

  return {
    batch, // 上游批次日期（YYYY-MM-DD）
    previousBatch: sameBatch ? existing.previousBatch : prev.meta?.updated ?? null,
    syncedAt,
    count: sorted.length,
    items: sorted,
  };
}

function main() {
  const [prevPath, nextPath, outPath] = process.argv.slice(2);
  if (!prevPath || !nextPath || !outPath) {
    console.error("用法：node scripts/build-new-items.mjs <prev.json> <next.json> <out.json>");
    process.exit(1);
  }
  const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
  const prev = readJson(prevPath);
  const next = readJson(nextPath);
  if (!Array.isArray(prev.items) || !Array.isArray(next.items)) {
    console.error("❌ 輸入 JSON 缺少 items 陣列");
    process.exit(1);
  }
  const existing = existsSync(outPath) ? readJson(outPath) : null;
  const syncedAt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const output = buildNewItems(prev, next, Array.isArray(existing?.items) ? existing : null, syncedAt);

  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`✅ ${outPath}：批次 ${output.batch}（前次 ${output.previousBatch}）新增 ${output.count} 篇`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
