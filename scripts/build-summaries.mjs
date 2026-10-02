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
//   node scripts/build-summaries.mjs --all           # 全部重做：先寫候選檔，整輪無外部錯誤才原子替換正式檔
//   node scripts/build-summaries.mjs --limit 50      # 先試跑 N 篇
//   node scripts/build-summaries.mjs --model <name>

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { doiOf, titleKey } from "./lib/literature-keys.mjs";
import { unsupportedNumbers } from "./lib/summary-checks.mjs";

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
const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

// ---------------------------------------------------------------- 寫檔
function writeJsonAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 0) + "\n");
  renameSync(tmp, path);
}

const candidatePathOf = (outPath) => outPath.replace(/\.json$/, "") + ".candidate.json";

/**
 * 把這一輪的成果寫出去。
 *
 * 增量模式只會新增摘要，中途寫入正式檔也不會讓既有成果變少。
 * `--all` 是從空白重建：途中遇到 PubMed／ollama 錯誤會少掉一批，
 * 所以只寫候選檔，整輪零外部錯誤才原子替換正式檔；否則保留舊資料與候選檔供檢查。
 */
export function commitSummaries(outPath, out, { redoAll, externalErrors, final = true }) {
  const data = { ...out, count: Object.keys(out.summaries).length };
  if (!redoAll) {
    writeJsonAtomic(outPath, data);
    return { replaced: true, path: outPath };
  }
  const candidate = candidatePathOf(outPath);
  writeJsonAtomic(candidate, data);
  if (!final || externalErrors > 0) return { replaced: false, path: candidate };
  renameSync(candidate, outPath);
  return { replaced: true, path: outPath };
}

// ---------------------------------------------------------------- PMID 解析
/** 查詢失敗會丟錯，讓呼叫端分得出「查無結果」與「沒查成」。 */
async function esearch(term) {
  const url =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
    `?db=pubmed&retmode=json&retmax=3&term=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`esearch HTTP ${res.status}`);
  const json = await res.json();
  if (!json.esearchresult) throw new Error("esearch 回應缺少 esearchresult");
  return json.esearchresult.idlist ?? [];
}

/**
 * 解析一篇文獻的 PMID。`cacheable` 只有在每一次查詢都確實完成時才為 true——
 * 429／網路中斷若被記成「無 PMID」，之後每次執行都會直接略過這篇，永遠補不回來。
 */
export async function resolvePmid(item, key, cache, search, pause = async () => {}) {
  if (item.pmid) return { pmid: String(item.pmid), cacheable: false };
  if (key in cache && cache[key]) return { pmid: cache[key], cacheable: false };
  if (key in cache) return { pmid: null, cacheable: false };

  let failed = false;
  const lookup = async (term) => {
    try {
      return await search(term);
    } catch {
      failed = true;
      return [];
    } finally {
      await pause();
    }
  };

  const doi = doiOf(item.url);
  let ids = doi ? await lookup(`${doi}[DOI]`) : [];
  if (!ids.length) {
    // 標題反查：留給 efetch 階段做標題吻合驗證，這裡先取候選
    ids = await lookup(`${String(item.title ?? "").replace(/[[\]]/g, " ")}[Title]`);
  }
  const pmid = ids[0] ?? null;
  return { pmid, cacheable: pmid !== null || !failed };
}

async function resolvePmids(todo, pmidCache) {
  let resolved = 0;
  let lookups = 0;
  let cache = pmidCache;
  for (const p of todo) {
    const { pmid, cacheable } = await resolvePmid(p.item, p.key, cache, esearch, async () => {
      lookups++;
      await sleep(NCBI_GAP);
    });
    p.pmid = pmid;
    if (pmid) resolved++;
    if (cacheable) cache = { ...cache, [p.key]: pmid };
    if (lookups && lookups % 25 === 0) {
      writeFileSync(PMID_CACHE, JSON.stringify(cache));
      process.stdout.write(`\r  PMID 解析中… ${resolved}/${todo.length}`);
    }
  }
  writeFileSync(PMID_CACHE, JSON.stringify(cache));
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
  if (unsupportedNumbers(clean, `${abstract} ${title}`).length) return null;
  return clean;
}

// ---------------------------------------------------------------- 主流程
async function main() {
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

  const todo = papers.filter(({ key }) => !out.summaries[key]).slice(0, LIMIT);
  console.log(`唯一文獻 ${papers.length} 篇｜待處理 ${todo.length} 篇｜模型 ${MODEL}`);

  await resolvePmids(todo, readJson(PMID_CACHE, {}));

  // 外部錯誤（PubMed 批次失敗、ollama 失敗）會讓 --all 少掉本來有的摘要，必須計數。
  let externalErrors = 0;
  const withPmid = todo.filter((p) => p.pmid);
  const abstracts = new Map();
  for (let i = 0; i < withPmid.length; i += 150) {
    const batch = withPmid.slice(i, i + 150);
    try {
      const got = await fetchAbstracts(batch.map((p) => p.pmid));
      for (const [k, v] of got) abstracts.set(k, v);
    } catch (e) {
      externalErrors += batch.length;
      console.log(`  ⚠️ efetch 批次失敗（${e.message}），略過此批`);
    }
    process.stdout.write(`\r  摘要抓取中… ${abstracts.size} 篇`);
    await sleep(NCBI_GAP);
  }
  console.log(`\r  摘要抓取完成：${abstracts.size} 篇有摘要原文        `);

  const stamp = () => {
    out.generatedAt = new Date().toISOString().slice(0, 10);
    out.model = MODEL;
  };
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
    // 只要 PMID 不是資料自帶的，就必須確認抓回來的是同一篇，否則寧可不寫。
    //
    // 這裡不能只驗「這一輪剛反查到的」——快取命中時解析迴圈會直接 continue，
    // 旗標根本不會被設到，於是反查來的 PMID 一路沒驗證。實測 557 篇反查結果裡
    // 有 24 篇配到完全不同的文獻（游泳者肩痛 → 上海生態系統模擬）。
    if (!p.item.pmid) {
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
      externalErrors++;
      skipped++;
    }
    if (done % 20 === 0) {
      stamp();
      commitSummaries(OUT_PATH, out, { redoAll: REDO_ALL, externalErrors, final: false });
      process.stdout.write(`\r  生成中… ${done}/${withPmid.length}（成功 ${ok}、略過 ${skipped}）`);
    }
  }

  stamp();
  const result = commitSummaries(OUT_PATH, out, { redoAll: REDO_ALL, externalErrors });
  const total = Object.keys(out.summaries).length;
  console.log(`\r本輪新增 ${ok} 篇、略過 ${skipped} 篇；疊加層共 ${total} 篇 → ${result.path}      `);
  if (!result.replaced) {
    console.error(`❌ 全量重建有 ${externalErrors} 篇遇到外部錯誤，正式檔 ${OUT_PATH} 未被替換；候選檔保留在 ${result.path}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
