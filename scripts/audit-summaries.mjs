#!/usr/bin/env node
// 稽核摘要是否張冠李戴。
//
// 853 篇裡有 651 篇的 PMID 不是資料自帶、而是靠 DOI 或標題反查補上的。反查有可能
// 配到完全不同的文獻——實測曾出現「游泳者肩痛系統性回顧」配到「上海生態系統服務模擬」。
// 產生腳本現在會驗證標題，這支是獨立的事後稽核，防止驗證邏輯再次失效而無人察覺。
//
// 「沒查到 PubMed 標題」不等於吻合：PubMed 暫時失敗或 PMID 已失效時要報成未完成，
// 不能讓稽核在什麼都沒驗的情況下宣稱全部吻合。
//
// 用法：node scripts/audit-summaries.mjs
// exit code：0 全部吻合｜1 有標題不吻合｜2 稽核未完成（無快取或有篇數查不到）

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { titleKey } from "./lib/literature-keys.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const titlesMatch = (a, b) => a.startsWith(b.slice(0, 40)) || b.startsWith(a.slice(0, 40));

/** 依 PubMed 取回的標題把每篇分成吻合／不吻合／未查到。 */
export function classifyAudit(risky, titles) {
  const passed = [];
  const mismatched = [];
  const unresolved = [];
  for (const record of risky) {
    const fetched = titleKey(titles.get(record.pmid) ?? "");
    if (!fetched) unresolved.push(record);
    else if (titlesMatch(fetched, titleKey(record.item.title))) passed.push(record);
    else mismatched.push(record);
  }
  return { passed, mismatched, unresolved };
}

export function auditExitCode({ mismatched, unresolved }) {
  if (mismatched.length) return 1;
  if (unresolved.length) return 2;
  return 0;
}

async function fetchTitles(pmids) {
  const url =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
    `?db=pubmed&retmode=xml&rettype=abstract&id=${pmids.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`efetch HTTP ${res.status}`);
  const xml = await res.text();
  const titles = new Map();
  for (const article of xml.split("<PubmedArticle>").slice(1)) {
    const pmid = article.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    const title = (article.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (pmid && title) titles.set(pmid, title);
  }
  return titles;
}

async function main() {
  const index = JSON.parse(readFileSync("public/data/reviews-index.json", "utf8"));
  const summaries = JSON.parse(readFileSync("public/data/summaries.json", "utf8")).summaries;
  let cache;
  try {
    cache = JSON.parse(readFileSync("public/data/.pmid-cache.json", "utf8"));
  } catch {
    console.error("⚠️ 找不到 PMID 快取，無法稽核反查結果（本機跑過 npm run summaries 才會有）——稽核未完成");
    process.exit(2);
  }

  const unique = new Map();
  for (const item of index.items) {
    const key = titleKey(item.title) || item.url;
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
    try {
      for (const [pmid, title] of await fetchTitles(batch.map((x) => x.pmid))) titles.set(pmid, title);
    } catch (e) {
      console.log(`  ⚠️ efetch 批次失敗（${e.message}），此批列為未完成`);
    }
    await sleep(400);
  }

  const result = classifyAudit(risky, titles);
  if (result.mismatched.length) {
    console.log(`❌ ${result.mismatched.length} 篇標題不吻合：`);
    for (const { item, pmid } of result.mismatched) {
      console.log(`  · 資料  ：${item.title.slice(0, 70)}`);
      console.log(`    PubMed：${titles.get(pmid).slice(0, 70)}`);
    }
    console.log("\n修法：刪掉這些 key 的摘要與 .pmid-cache.json 條目，再跑 npm run summaries");
  }
  if (result.unresolved.length) {
    console.log(`⚠️ ${result.unresolved.length} 篇查不到 PubMed 標題，未完成稽核（PMID：${result.unresolved.slice(0, 10).map((r) => r.pmid).join(", ")}${result.unresolved.length > 10 ? "…" : ""}）`);
  }
  if (!result.mismatched.length && !result.unresolved.length) {
    console.log(`✅ ${result.passed.length} 篇全部吻合，沒有張冠李戴的摘要`);
  }
  process.exit(auditExitCode(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
