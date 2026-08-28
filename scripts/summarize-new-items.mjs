#!/usr/bin/env node
// 為「本月新增文獻」補上一句繁體中文說明。
//
// 上游的 PubMed 文獻沒有 tldr，卡片上只剩一行中位 127 字元的英文長標題，
// 醫師掃視成本高。這支腳本從 PubMed 取回**摘要原文**，再交給本機 LLM（ollama）
// 濃縮成一句話——只用標題生成等於改寫標題，沒有增加資訊量，所以取不到摘要就不寫。
//
// 醫療內容防線（產出前機械檢查，不合格就丟棄該篇而不是硬寫）：
//  - 禁止療效絕對化語句（保證／治癒／完全預防／百分之百…）
//  - 禁止出現摘要裡沒有的數字，避免模型自行編造效果量
//  - 產出標記 tldrSource: "local-llm"，UI 會標示為機器摘要
//
// 用法：node scripts/summarize-new-items.mjs public/data/new-items.json [--model qwen3.8:27b-mlx]

import { readFileSync, writeFileSync } from "node:fs";

const [filePath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modelArg = process.argv.indexOf("--model");
const MODEL = modelArg > -1 ? process.argv[modelArg + 1] : "qwen3.8:27b-mlx";
const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";

if (!filePath) {
  console.error("用法：node scripts/summarize-new-items.mjs <new-items.json> [--model <name>]");
  process.exit(1);
}

const BANNED = /(保證|治癒|完全預防|百分之百|100%\s*有效|絕對有效|根治)/;
// 上限只用來擋失控輸出；實際長度由 prompt 塑形。
const MAX_LEN = 80;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一次抓多筆摘要，避開 NCBI 每秒 3 次的限制。 */
async function fetchAbstracts(pmids) {
  const url =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
    `?db=pubmed&retmode=xml&rettype=abstract&id=${pmids.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`efetch HTTP ${res.status}`);
  const xml = await res.text();

  const byPmid = new Map();
  for (const article of xml.split("<PubmedArticle>").slice(1)) {
    const pmid = article.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1];
    if (!pmid) continue;
    const parts = [...article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map(
      (m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    );
    const text = parts.join(" ").trim();
    if (text) byPmid.set(pmid, text);
  }
  return byPmid;
}

const PROMPT = (title, abstract) => `你是運動醫學臨床文獻編輯。請把下面這篇文獻濃縮成**一句繁體中文**，給臨床醫師快速判斷是否值得細讀。

規則：
- 只寫這篇「研究了什麼、主要發現是什麼」，控制在 55 個中文字以內。
- 只能根據下方摘要內容，**不得補充摘要沒有提到的資訊**。
- 不得使用「保證、治癒、完全預防、百分之百」等療效絕對化字眼；有不確定性就照實寫（如「證據有限」「結果不一致」）。
- 不要加標題、不要引號、不要條列、不要解釋，直接輸出那一句話。

標題：${title}

摘要：${abstract.slice(0, 3500)}`;

async function summarize(title, abstract) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: PROMPT(title, abstract),
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 160 },
    }),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const data = await res.json();
  return (data.response ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** 機械檢查：不合格就回 null，寧可留空也不要寫出有問題的醫療敘述。 */
function validate(text, abstract, title) {
  if (!text) return null;
  const line = text.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
  const clean = line.replace(/^["「『]|["」』]$/g, "").trim();
  if (!clean || clean.length > MAX_LEN) return null;
  if (BANNED.test(clean)) return null;
  // 中文字要佔多數，避免模型直接回英文
  const cjk = (clean.match(/[一-鿿]/g) ?? []).length;
  if (cjk < clean.length * 0.5) return null;
  // 摘要裡查無實據的數字視為編造——這道檢查是為了擋掉模型自行生出效果量。
  // 但要比對得準：模型常把 15.3% 寫成 15%、把年份寫進共識名稱，
  // 所以允許小數截斷，並一併比對標題。
  const source = `${abstract} ${title}`;
  for (const num of clean.match(/\d+(?:\.\d+)?/g) ?? []) {
    const found =
      source.includes(num) ||
      new RegExp(`(?<!\\d)${num.replace(".", "\\.")}(?:\\.\\d+)?(?!\\d)`).test(source);
    if (!found) return null;
  }
  return clean;
}

const data = JSON.parse(readFileSync(filePath, "utf8"));
const targets = data.items.filter((i) => !i.tldr && i.pmid);
console.log(`待補摘要：${targets.length} / ${data.items.length} 篇（模型 ${MODEL}）`);

const abstracts = await fetchAbstracts(targets.map((i) => i.pmid));
console.log(`PubMed 取回摘要：${abstracts.size} 篇`);

let ok = 0;
let skipped = 0;
for (const item of targets) {
  const abstract = abstracts.get(item.pmid);
  if (!abstract) {
    skipped++;
    console.log(`  ⏭  ${item.pmid} 無摘要，略過`);
    continue;
  }
  try {
    const raw = await summarize(item.title, abstract);
    const summary = validate(raw, abstract, item.title);
    if (!summary) {
      skipped++;
      console.log(`  ⏭  ${item.pmid} 產出未通過檢查，略過：${JSON.stringify(raw).slice(0, 160)}`);
      continue;
    }
    item.tldr = summary;
    item.tldrSource = "local-llm";
    ok++;
    console.log(`  ✅ ${item.pmid} ${summary}`);
  } catch (e) {
    skipped++;
    console.log(`  ⏭  ${item.pmid} ${e.message}`);
  }
  await sleep(150);
}

data.summarizedAt = new Date().toISOString().slice(0, 10);
data.summaryModel = MODEL;
writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
console.log(`\n完成：補上 ${ok} 篇，略過 ${skipped} 篇 → ${filePath}`);
