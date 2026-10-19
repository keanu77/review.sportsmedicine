/** Pre-render public discovery pages. No private APIs, credentials or model calls. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { publicDocument, escapeHtml } from "./public-document";
import PublicShell from "../src/PublicShell";
import PaperDetails from "../src/PaperDetails";
import Topics, { TOPICS, TopicLinks } from "../src/Topics";
import { createBibliographyIndex, enrichItems } from "../src/enrich";
import { uniquePapers } from "../src/identity";
import { paperPath, SITE_URL } from "../src/paperRoutes";
import { matchesQuery, rankResults, tokenize } from "../src/search";
import type { BibliographyData, ReviewsData, SummariesData, TagsData } from "../src/types";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const read = async <T,>(name: string): Promise<T> => JSON.parse(await readFile(resolve(root, "public/data", name), "utf8"));
const [index, bibliography, summaries, tags] = await Promise.all([read<ReviewsData>("reviews-index.json"), read<BibliographyData>("bibliography.json"), read<SummariesData>("summaries.json"), read<TagsData>("tags.json")]);
const items = uniquePapers(enrichItems(index.items, summaries.summaries, tags.tags, createBibliographyIndex(bibliography.records)));
const template = await readFile(resolve(root, "dist/index.html"), "utf8");
if (!template.includes('<div id="root"></div>')) throw new Error("Run npm run build to produce a fresh Vite shell before rendering public pages.");
// Search needs bibliographic fields, not every original abstract. Detail pages bootstrap their own record.
const searchBibliography = { ...bibliography, records: bibliography.records.map(({ abstract: _abstract, ...record }) => record) };
await writeFile(resolve(root, "dist/data/bibliography-index.json"), JSON.stringify(searchBibliography));
const paths = new Set<string>();
async function page(path: string, title: string, description: string, body: string, bootstrap?: { id: string; data: unknown }, noindex = false) {
  if (paths.has(path)) throw new Error(`Duplicate public route: ${path}`);
  paths.add(path);
  const canonical = `${SITE_URL}${path}`;
  const html = publicDocument(template, { title, description, canonical, body, bootstrap, noindex });
  const file = resolve(root, "dist", path === "/404.html" ? "404.html" : `.${path}index.html`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
for (const item of items) {
  await page(paperPath(item), `${item.title}｜運動醫學 Review 索引`, (item.tldr || `${item.journal || item.source} · ${item.year || ""}。查看來源、書目與全文狀態。`).slice(0, 180), renderToStaticMarkup(<PublicShell><PaperDetails item={item} /></PublicShell>), { id: "paper-data", data: item });
}
for (const topic of TOPICS) {
  const tokens = tokenize(topic.query), matched = rankResults(items.filter(item => matchesQuery(item, tokens)), tokens, "relevance");
  const data = { ...topic, total: matched.length, items: matched.slice(0, 12), updated: index.meta.updated };
  await page(`/topics/${topic.slug}/`, `${topic.title}｜運動醫學 Review 索引`, topic.description, renderToStaticMarkup(<PublicShell><Topics data={data} /></PublicShell>), { id: "topic-data", data });
}
await page("/", "運動醫學 Review 索引", "查找運動醫學與復健回顧，依部位、主題及族群篩選，保存閱讀清單與匯出引用。", renderToStaticMarkup(<PublicShell><section className="space-y-5 py-5"><h1 className="text-3xl font-bold">運動醫學 Review 索引</h1><p>收錄 {items.length} 篇運動醫學與復健文獻。互動搜尋需啟用 JavaScript；也可從以下主題閱讀文獻。</p><TopicLinks /></section></PublicShell>));
await page("/404.html", "找不到頁面｜運動醫學 Review 索引", "請返回文獻索引重新搜尋。", renderToStaticMarkup(<PublicShell><PaperDetails item={undefined} /></PublicShell>), undefined, true);
// A real 404 disables Cloudflare Pages' automatic SPA fallback. Preserve the private shell explicitly.
await mkdir(resolve(root, "dist/workbench"), { recursive: true });
await writeFile(resolve(root, "dist/workbench/index.html"), template.replace("</head>", '<meta name="robots" content="noindex, nofollow" /></head>'));
const publicPaths = [...paths].filter(path => path !== "/404.html");
await writeFile(resolve(root, "dist/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicPaths.map(path => `<url><loc>${escapeHtml(SITE_URL + path)}</loc></url>`).join("")}</urlset>\n`);
console.log(`Pre-rendered ${items.length} papers, ${TOPICS.length} topics, index and 404; sitemap has ${publicPaths.length} public URLs.`);
