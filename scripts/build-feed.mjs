#!/usr/bin/env node
// 由 new-items.json 產生 Atom feed。
//
// 刻意獨立成一支：feed 的 <summary> 要帶中文摘要，而摘要是在 build-new-items 之後
// 由 summarize-new-items 補上的。放在同一支腳本裡，feed 會在摘要進來之前就寫好。
// 正確順序：build-new-items → summarize-new-items → build-feed。
//
// 用法：node scripts/build-feed.mjs [new-items.json] [feed.xml]

import { readFileSync, writeFileSync } from "node:fs";

const [inPath = "public/data/new-items.json", outPath = "public/feed.xml"] =
  process.argv.slice(2);
const SITE = "https://review.sportsmedicine.tw";

const esc = (text) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const data = JSON.parse(readFileSync(inPath, "utf8"));
if (!Array.isArray(data.items)) {
  console.error(`${inPath} 缺少 items 陣列`);
  process.exit(1);
}

const updated = `${data.batch ?? data.syncedAt}T00:00:00Z`;

const entries = data.items
  .map((item) => {
    const taxonomy = [item.region, ...(item.diseases ?? [item.disease])]
      .filter(Boolean)
      .join(" · ");
    const summary = item.tldr ? `${item.tldr}\n\n${taxonomy}` : taxonomy;
    return `  <entry>
    <title>${esc(item.title)}</title>
    <link href="${esc(item.freeUrl || item.url)}"/>
    <id>${esc(item.pmid ? `${SITE}/#pmid-${item.pmid}` : item.url)}</id>
    <updated>${updated}</updated>
    <summary>${esc(summary)}</summary>
    <category term="${esc(item.region)}"/>
  </entry>`;
  })
  .join("\n");

writeFileSync(
  outPath,
  `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-Hant">
  <title>運動醫學 Review 索引 — 每月新增文獻</title>
  <subtitle>系統性回顧、統合分析與臨床指引，每月同步。</subtitle>
  <link href="${SITE}/feed.xml" rel="self"/>
  <link href="${SITE}/"/>
  <id>${SITE}/</id>
  <updated>${updated}</updated>
  <author><name>運動醫學科 吳易澄醫師</name><uri>https://sportsmedicine.tw/</uri></author>
  <rights>書目 metadata 著作權屬各原始出版者；本 feed 僅供教育與研究參考，不構成診療建議。</rights>
${entries}
</feed>
`,
);

const withSummary = data.items.filter((i) => i.tldr).length;
console.log(`✅ ${outPath}：${data.items.length} 筆（其中 ${withSummary} 筆帶中文摘要）`);
