#!/usr/bin/env node
// 為全站文獻建立自訂標籤疊加層 public/data/tags.json。
//
// 為什麼是疊加層：reviews-index.json 每月被上游整檔覆蓋，標籤寫回去下次同步就消失。
// 疊加層以正規化標題為鍵，前端載入時併進 themes / populations。
//
// 為什麼不用關鍵字直接判：關鍵字分不出「研究兒童」與「提到兒童」。實測誤判包括
// 手部麻醉綜述（只說兒童可在超音波下施行）、腘繩肌訓練（只說青少年證據有限）、
// 扁桃體切除 PRP（兒童無效的次族群結果）。這三篇都不該進兒童分類。
// 所以流程是：寬鬆關鍵字前篩 → 取 PubMed 摘要原文 → 本機 LLM 依明確準則判定。
//
// 用法：
//   node scripts/build-tags.mjs                    # 只補還沒判定的
//   node scripts/build-tags.mjs --tag pediatric    # 只跑單一標籤
//   node scripts/build-tags.mjs --all              # 全部重判
//   node scripts/build-tags.mjs --model <name>

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ARGS = process.argv.slice(2);
const flag = (n) => ARGS.includes(n);
const value = (n, d) => (ARGS.indexOf(n) > -1 ? ARGS[ARGS.indexOf(n) + 1] : d);

const INDEX_PATH = "public/data/reviews-index.json";
const SUMMARY_PATH = "public/data/summaries.json";
const OUT_PATH = "public/data/tags.json";
const PMID_CACHE = "public/data/.pmid-cache.json";
const MODEL = value("--model", "qwen3.8:27b-mlx");
const ONLY = value("--tag", null);
const REDO = flag("--all");
const OLLAMA = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const NCBI_GAP = 380;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const titleKey = (t) => String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const readJson = (p, f) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : f);

// ---------------------------------------------------------------- 標籤定義
//
// prefilter 刻意寬鬆（寧可多送幾篇給 LLM 判，也不要在這關漏掉），
// criteria 才是真正的判準，會原樣進 prompt。
const TAGS = {
  pediatric: {
    axis: "populations",
    label: "兒童・青少年",
    // 併入既有的「青少年」：臨床上 pediatric/adolescent 通常同一群，
    // 拆成兩個各四十篇的桶反而更難找。
    absorbs: ["青少年"],
    prefilter:
      /p(a)?ediatric|child|adolescen|youth|juvenile|teenager|school[- ]age|prepubert|pubert|skeletally immature|growth plate|phys(is|eal)|epiphys|apophys|young athlete|osgood|schlatter|sever'?s|sinding|little league|salter|perthes|scfe|slipped capital|idiopathic scoliosis|osteochondritis dissecans|discoid meniscus|tarsal coalition|spondylolysis|apophysitis|兒童|青少年|青春期|生長板|學童|小兒|幼年/i,
    criteria: `這篇文獻的**研究對象是否主要為 18 歲以下的兒童或青少年**？

算（回 YES）：
- 研究族群明確是兒童、青少年、學齡運動員、骨骼未成熟者
- 探討的疾病本質上屬於兒童／青少年（如 Osgood-Schlatter、生長板損傷、青少年特發性脊椎側彎、股骨頭骨骺滑脫）

不算（回 NO）：
- 只是**提到**兒童（例如「此技術在兒童也可安全施行」）
- 只是把兒童列為**次族群分析**的一部分，主體是成人
- 只是說「兒童／青少年的證據不足」這類限制陳述
- 研究族群是成人或未區分年齡`,
  },
  regenerative: {
    axis: "themes",
    label: "再生・增生療法（PRP）",
    absorbs: [],
    prefilter:
      /\b(prp|platelet[- ]rich|prolotherapy|dextrose|stem cell|mesenchymal|bmac|bone marrow aspirate|orthobiolog|regenerative|autologous conditioned|growth factor injection|lipoaspirate|adipose[- ]derived)|富血小板|增生療法|幹細胞|骨髓抽吸|再生醫學/i,
    criteria: `這篇文獻是否**以再生／增生療法為主要介入或主要比較對象之一**？

再生／增生療法包含：PRP（富血小板血漿）、增生療法（prolotherapy、高濃度葡萄糖）、
幹細胞／間質幹細胞、骨髓抽吸濃縮液（BMAC）、脂肪來源細胞、其他 orthobiologics。

算（回 YES）：
- 主要介入就是上述療法
- 是多組比較（如網路統合分析、療法比較）中的其中一個治療組——醫師找這類證據時需要看到
- 整篇的主題就是再生療法本身，即使不是療效試驗（例如如何最佳化其品質、施打前準備、
  製備方式比較、安全性回顧、相關指引章節）

不算（回 NO）：
- 只在討論或未來方向裡順帶提及
- 主要介入是手術、復健、藥物或其他物理治療（如震波），再生療法只是背景敘述`,
  },
};

const selected = ONLY ? { [ONLY]: TAGS[ONLY] } : TAGS;
if (ONLY && !TAGS[ONLY]) {
  console.error(`未知標籤 ${ONLY}，可用：${Object.keys(TAGS).join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------- 資料
const index = readJson(INDEX_PATH, null);
if (!index) {
  console.error(`找不到 ${INDEX_PATH}`);
  process.exit(1);
}
const summaries = readJson(SUMMARY_PATH, { summaries: {} }).summaries;
const pmidCache = readJson(PMID_CACHE, {});

const unique = new Map();
for (const item of index.items) {
  const key = titleKey(item.title) || item.url;
  const existing = unique.get(key);
  if (!existing) unique.set(key, item);
  else if (!existing.pmid && item.pmid) unique.set(key, item);
}
const papers = [...unique.entries()].map(([key, item]) => ({
  key,
  item,
  // 前篩看得到的文字：標題、病名、中文摘要、既有標籤
  text: [item.title, item.disease, summaries[key] ?? item.tldr, ...(item.themes ?? []), ...(item.populations ?? [])]
    .filter(Boolean)
    .join(" "),
}));

const out = readJson(OUT_PATH, { generatedAt: null, model: MODEL, tags: {} });
if (REDO) for (const name of Object.keys(selected)) delete out.tags[name];
for (const name of Object.keys(selected)) {
  out.tags[name] ??= { keys: [] };
  // label / axis / absorbs 一律以程式碼裡的定義為準，改定義後不必手動改檔案
  Object.assign(out.tags[name], {
    label: selected[name].label,
    axis: selected[name].axis,
    absorbs: selected[name].absorbs,
  });
}

// ---------------------------------------------------------------- PubMed
async function fetchAbstracts(pmids) {
  const byPmid = new Map();
  const titles = new Map();
  for (let i = 0; i < pmids.length; i += 150) {
    const batch = pmids.slice(i, i + 150);
    const url =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
      `?db=pubmed&retmode=xml&rettype=abstract&id=${batch.join(",")}`;
    try {
      const xml = await (await fetch(url)).text();
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
        const text = parts.join(" ").trim();
        if (text) {
          byPmid.set(pmid, text);
          titles.set(pmid, title);
        }
      }
    } catch (e) {
      console.log(`  ⚠️ efetch 批次失敗（${e.message}）`);
    }
    await sleep(NCBI_GAP);
  }
  return { byPmid, titles };
}

// ---------------------------------------------------------------- 判定
async function classify(criteria, title, evidence) {
  const prompt = `你是運動醫學臨床文獻編輯，正在為文獻索引做分類。

${criteria}

只根據下列資訊判斷，不要推測資訊之外的內容。
**只回答一個字：YES 或 NO。**不要解釋、不要標點。

標題：${title}

摘要：${evidence.slice(0, 3000)}`;

  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 8 },
    }),
  });
  if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
  const text = ((await res.json()).response ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (/^yes\b/i.test(text)) return true;
  if (/^no\b/i.test(text)) return false;
  return null; // 判不出來就不標，不猜
}

// ---------------------------------------------------------------- 主流程
for (const [name, spec] of Object.entries(selected)) {
  const bucket = out.tags[name];
  const done = new Set(bucket.keys);
  const skipped = new Set(bucket.rejected ?? []);

  const candidates = papers.filter(
    (p) =>
      !done.has(p.key) &&
      !skipped.has(p.key) &&
      (spec.prefilter.test(p.text) ||
        spec.absorbs.some((t) => (p.item.populations ?? []).includes(t) || (p.item.themes ?? []).includes(t))),
  );
  console.log(`\n[${name}] ${spec.label}｜前篩候選 ${candidates.length} 篇`);
  if (!candidates.length) continue;

  const needPmid = candidates.map((p) => p.item.pmid ?? pmidCache[p.key]).filter(Boolean);
  const { byPmid: abstracts, titles } = await fetchAbstracts(needPmid);
  console.log(`  取得摘要 ${abstracts.size} 篇`);

  let yes = 0;
  let no = 0;
  let unknown = 0;
  const rejected = new Set(bucket.rejected ?? []);
  for (const [i, p] of candidates.entries()) {
    const pmid = p.item.pmid ?? pmidCache[p.key];
    // 沒有摘要時退回中文摘要；兩者皆無就跳過，不靠標題硬猜
    // PMID 不是資料自帶的就要確認抓回來的是同一篇——反查有可能配到別的文獻，
    // 拿錯摘要會直接導致分類錯誤。對不上就退回中文摘要，不用那份摘要原文。
    let abstract = pmid ? abstracts.get(pmid) : undefined;
    if (abstract && !p.item.pmid) {
      const a = titleKey(titles.get(pmid) ?? "");
      const b = titleKey(p.item.title);
      if (!a.startsWith(b.slice(0, 40)) && !b.startsWith(a.slice(0, 40))) abstract = undefined;
    }
    const evidence = abstract || summaries[p.key] || p.item.tldr;
    if (!evidence) {
      unknown++;
      continue;
    }
    try {
      const verdict = await classify(spec.criteria, p.item.title, evidence);
      if (verdict === true) {
        bucket.keys.push(p.key);
        yes++;
      } else if (verdict === false) {
        rejected.add(p.key);
        no++;
      } else unknown++;
    } catch {
      unknown++;
    }
    if ((i + 1) % 20 === 0) process.stdout.write(`\r  判定中… ${i + 1}/${candidates.length}（收 ${yes}、排除 ${no}）`);
  }
  bucket.rejected = [...rejected];
  console.log(`\r  完成：收 ${yes} 篇、排除 ${no} 篇、無法判定 ${unknown} 篇        `);
}

out.generatedAt = new Date().toISOString().slice(0, 10);
out.model = MODEL;
for (const b of Object.values(out.tags)) b.count = b.keys.length;
writeFileSync(OUT_PATH, JSON.stringify(out, null, 0) + "\n");
console.log(
  `\n→ ${OUT_PATH}：` +
    Object.entries(out.tags).map(([n, b]) => `${b.label} ${b.count} 篇`).join("、"),
);
