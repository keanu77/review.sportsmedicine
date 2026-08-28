#!/usr/bin/env node
// 稽核摘要是否張冠李戴。
//
// 853 篇裡有 651 篇的 PMID 不是資料自帶、而是靠 DOI 或標題反查補上的。反查有可能
// 配到完全不同的文獻——實測曾出現「游泳者肩痛系統性回顧」配到「上海生態系統服務模擬」。
// 產生腳本現在會驗證標題，這支是獨立的事後稽核，防止驗證邏輯再次失效而無人察覺。
//
// 用法：node scripts/audit-summaries.mjs   （有問題時 exit code 1）

import { readFileSync } from "node:fs";

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const index = JSON.parse(readFileSync("public/data/reviews-index.json", "utf8"));
const summaries = JSON.parse(readFileSync("public/data/summaries.json", "utf8")).summaries;
let cache = {};
try {
  cache = JSON.parse(readFileSync("public/data/.pmid-cache.json", "utf8"));
} catch {
  console.log("找不到 PMID 快取，無法稽核反查結果（本機跑過 npm run summaries 才會有）");
  process.exit(0);
}

const unique = new Map();
for (const item of index.items) {
  const key = norm(item.title) || item.url;
  if (!unique.has(key)) unique.set(key, item);
  else if (!unique.get(key).pmid && item.pmid) unique.set(key, item);
}

// 只查「PMID 非資料自帶」的——自帶的不可能配錯
const risky = [...unique.entries()]
  .filter(([key, item]) => !item.pmid && cache[key] && summaries[key])
  .map(([key, item]) => ({ key, item, pmid: cache[key] }));

console.log(`稽核 ${risky.length} 篇反查取得 PMID 的摘要…`);

const titles = new Map();
for (let i = 0; i < risky.length; i += 150) {
  const batch = risky.slice(i, i + 150);
  const url =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
    `?db=pubmed&retmode=xml&rettype=abstract&id=${batch.map((x) => x.pmid).join(",")}`;
  const xml = await (await fetch(url)).text();
  for (const article of xml.split("<PubmedArticle>").slice(1)) {
    const pmid = article.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    const title = (article.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (pmid && title) titles.set(pmid, title);
  }
  await sleep(400);
}

const mismatched = risky.filter(({ pmid, item }) => {
  const fetched = norm(titles.get(pmid) ?? "");
  if (!fetched) return false;
  const own = norm(item.title);
  return !fetched.startsWith(own.slice(0, 40)) && !own.startsWith(fetched.slice(0, 40));
});

if (!mismatched.length) {
  console.log("✅ 全部吻合，沒有張冠李戴的摘要");
  process.exit(0);
}

console.log(`❌ ${mismatched.length} 篇標題不吻合：`);
for (const { item, pmid } of mismatched) {
  console.log(`  · 資料  ：${item.title.slice(0, 70)}`);
  console.log(`    PubMed：${titles.get(pmid).slice(0, 70)}`);
}
console.log("\n修法：刪掉這些 key 的摘要與 .pmid-cache.json 條目，再跑 npm run summaries");
process.exit(1);
