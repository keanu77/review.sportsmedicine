#!/usr/bin/env node
// 為全站文獻建立中文摘要疊加層 public/data/summaries.json。
//
// 為什麼要獨立成一個檔：reviews-index.json 每月會被上游**整檔覆蓋**，
// 摘要寫回去下次同步就消失。疊加層以正規化標題為鍵，前端載入時合併，
// 因此同步只會帶來「還沒有摘要的新文獻」，既有成果不受影響。
//
// 為什麼不直接從標題生成：只讀標題產出的等於改寫標題，不會增加資訊量。
// 一律先取回 PubMed 摘要原文，取不到就不寫。
//
// PMID 來源依序：資料自帶 → 由 URL 裡的 DOI 反查 → 由標題反查（需標題吻合才採用）。
//
// 用法：
//   node scripts/build-summaries.mjs                 # 只補還沒有摘要的
//   node scripts/build-summaries.mjs --all           # 全部重做（含覆寫既有疊加層）
//   node scripts/build-summaries.mjs --limit 50      # 先試跑 N 篇
//   node scripts/build-summaries.mjs --model <name>

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ARGS = process.argv.slice(2);
const flag = (name) => ARGS.includes(name);
const value = (name, fallback) => {
  const i = ARGS.indexOf(name);
  return i > -1 ? ARGS[i + 1] : fallback;
};

const INDEX_PATH = "public/data/reviews-index.json";
const OUT_PATH = "public/data/summaries.json";
const PMID_CACHE = "public/data/.pmid-cache.json";
const MODEL = value("--model", "qwen3.8:27b-mlx");
const LIMIT = Number(value("--limit", "0")) || Infinity;
const REDO_ALL = flag("--all");
const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";

// 擋的是「替讀者下推薦」與療效保證，不是「陳述該研究的比較結果」。
// 「統合分析顯示 A 效果最佳」是在報告研究發現，可以留；
// 「A 可能為首選」是把單一研究外推成臨床建議，必須擋。
const BANNED =
  /(保證|治癒|完全預防|百分之百|100%\s*有效|絕對有效|根治|(?:是|為|可能為|應為)\s*(?:首選|最佳選擇|不二之選)|首選方案|建議優先採用)/;
const MAX_LEN = 80;
const NCBI_GAP = 380; // NCBI 未帶 API key 時每秒最多 3 次

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const titleKey = (t) => String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

// ---------------------------------------------------------------- 唯一文獻
const index = readJson(INDEX_PATH, null);
if (!index) {
  console.error(`找不到 ${INDEX_PATH}`);
  process.exit(1);
}
const unique = new Map();
for (const item of index.items) {
  const key = titleKey(item.title) || item.url;
  const existing = unique.get(key);
  if (!existing) unique.set(key, item);
  else if (!existing.pmid && item.pmid) unique.set(key, item);
}
const papers = [...unique.entries()].map(([key, item]) => ({ key, item }));

const out = REDO_ALL
  ? { generatedAt: null, model: MODEL, summaries: {} }
  : readJson(OUT_PATH, { generatedAt: null, model: MODEL, summaries: {} });
const pmidCache = readJson(PMID_CACHE, {});

const todo = papers.filter(({ key }) => !out.summaries[key]).slice(0, LIMIT);
console.log(`唯一文獻 ${papers.length} 篇｜待處理 ${todo.length} 篇｜模型 ${MODEL}`);

// ---------------------------------------------------------------- PMID 解析
function doiOf(url) {
  const m = String(url ?? "").match(/(?:doi\.org\/|\/doi\/(?:abs|full|pdf)\/)(10\.\d{4,9}\/\S+)/i);
  return m ? decodeURIComponent(m[1]).replace(/[).]+$/, "") : null;
}

async function esearch(term) {
  const url =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
    `?db=pubmed&retmode=json&retmax=3&term=${encodeURIComponent(term)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.esearchresult?.idlist ?? [];
  } catch {
    return [];
  }
}

async function resolvePmids() {
  let resolved = 0;
  let lookups = 0;
  for (const p of todo) {
    if (p.item.pmid) {
      p.pmid = p.item.pmid;
      resolved++;
      continue;
    }
    if (p.key in pmidCache) {
      if (pmidCache[p.key]) {
        p.pmid = pmidCache[p.key];
        resolved++;
      }
      continue;
    }
    const doi = doiOf(p.item.url);
    let ids = [];
    if (doi) {
      ids = await esearch(`${doi}[DOI]`);
      await sleep(NCBI_GAP);
      lookups++;
    }
    if (!ids.length) {
      // 標題反查：留給 efetch 階段做標題吻合驗證，這裡先取候選
      ids = await esearch(`${p.item.title.replace(/[[\]]/g, " ")}[Title]`);
      await sleep(NCBI_GAP);
      lookups++;
    }
    p.pmid = ids[0] ?? null;
    p.needsTitleCheck = !doi || !ids.length;
    pmidCache[p.key] = p.pmid;
    if (p.pmid) resolved++;
    if (lookups % 25 === 0) {
      writeFileSync(PMID_CACHE, JSON.stringify(pmidCache));
      process.stdout.write(`\r  PMID 解析中… ${resolved}/${todo.length}`);
    }
  }
  writeFileSync(PMID_CACHE, JSON.stringify(pmidCache));
  console.log(`\r  PMID 解析完成：${resolved}/${todo.length} 篇有 PMID          `);
}

// ---------------------------------------------------------------- 摘要抓取
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
    const title = (article.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const parts = [...article.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    );
    const abstract = parts.join(" ").trim();
    if (abstract) byPmid.set(pmid, { abstract, title });
  }
  return byPmid;
}

// ---------------------------------------------------------------- 生成
const PROMPT = (title, abstract) => `你是運動醫學臨床文獻編輯。請把下面這篇文獻濃縮成**一句繁體中文**，給臨床醫師快速判斷是否值得細讀。

規則：
- 必須寫出「研究了什麼」**以及「主要發現是什麼」**，控制在 55 個中文字以內。只講主題不講結論是不合格的。
- 只能根據下方摘要內容，**不得補充摘要沒有提到的資訊或數字**。
- 只**報告這篇研究發現了什麼**，不要替讀者下臨床建議（不可寫「應選擇」「可能為首選」）。
  陳述該研究的比較結果（如「統合分析顯示 A 組疼痛改善幅度最大」）可以，但不得寫成一般性推薦。
- 不得用「保證、治癒、完全預防、百分之百有效」等療效保證字眼；證據不足或結果分歧就照實寫（如「證據有限」「結果不一致」）。
- 全句用繁體中文；臨床縮寫（ACL、PRP、MET-min、BMI…）可保留原文，但不要整段英文。
- 專有名詞用台灣慣用譯名：network meta-analysis→網路統合分析、meta-analysis→統合分析、
  systematic review→系統性回顧、randomized controlled trial→隨機對照試驗、
  concussion→腦震盪、return to play→重返運動、guideline→指引。不要自創譯名。
- 直接輸出那一句話，不要標題、引號、條列或說明。

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
      options: { temperature: 0.2, num_predict: 200 },
    }),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const data = await res.json();
  return (data.response ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function validate(text, abstract, title) {
  if (!text) return null;
  const line = text.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "";
  const clean = line.replace(/^["「『]|["」』]$/g, "").trim();
  if (!clean || clean.length > MAX_LEN) return null;
  if (BANNED.test(clean)) return null;
  const cjk = (clean.match(/[一-鿿]/g) ?? []).length;
  if (cjk < clean.length * 0.5) return null;
  // 摘要與標題都查無實據的數字視為編造（允許小數截斷，如 14.8 寫成 14）
  const source = `${abstract} ${title}`;
  for (const num of clean.match(/\d+(?:\.\d+)?/g) ?? []) {
    const ok =
      source.includes(num) ||
      new RegExp(`(?<!\\d)${num.replace(".", "\\.")}(?:\\.\\d+)?(?!\\d)`).test(source);
    if (!ok) return null;
  }
  return clean;
}

// ---------------------------------------------------------------- 主流程
await resolvePmids();

const withPmid = todo.filter((p) => p.pmid);
const abstracts = new Map();
for (let i = 0; i < withPmid.length; i += 150) {
  const batch = withPmid.slice(i, i + 150);
  try {
    const got = await fetchAbstracts(batch.map((p) => p.pmid));
    for (const [k, v] of got) abstracts.set(k, v);
  } catch (e) {
    console.log(`  ⚠️ efetch 批次失敗（${e.message}），略過此批`);
  }
  process.stdout.write(`\r  摘要抓取中… ${abstracts.size} 篇`);
  await sleep(NCBI_GAP);
}
console.log(`\r  摘要抓取完成：${abstracts.size} 篇有摘要原文        `);

let ok = 0;
let skipped = 0;
let done = 0;
for (const p of withPmid) {
  const record = abstracts.get(p.pmid);
  done++;
  if (!record) {
    skipped++;
    continue;
  }
  // 標題反查來的必須確認是同一篇，否則寧可不寫
  if (p.needsTitleCheck) {
    const a = titleKey(record.title);
    const b = titleKey(p.item.title);
    if (!a.startsWith(b.slice(0, 40)) && !b.startsWith(a.slice(0, 40))) {
      skipped++;
      continue;
    }
  }
  try {
    const summary = validate(await summarize(p.item.title, record.abstract), record.abstract, p.item.title);
    if (!summary) {
      skipped++;
    } else {
      out.summaries[p.key] = summary;
      ok++;
    }
  } catch {
    skipped++;
  }
  if (done % 20 === 0) {
    out.generatedAt = new Date().toISOString().slice(0, 10);
    out.model = MODEL;
    out.count = Object.keys(out.summaries).length;
    writeFileSync(OUT_PATH, JSON.stringify(out, null, 0) + "\n");
    process.stdout.write(`\r  生成中… ${done}/${withPmid.length}（成功 ${ok}、略過 ${skipped}）`);
  }
}

out.generatedAt = new Date().toISOString().slice(0, 10);
out.model = MODEL;
out.count = Object.keys(out.summaries).length;
writeFileSync(OUT_PATH, JSON.stringify(out, null, 0) + "\n");
console.log(`\r本輪新增 ${ok} 篇、略過 ${skipped} 篇；疊加層共 ${out.count} 篇 → ${OUT_PATH}      `);
