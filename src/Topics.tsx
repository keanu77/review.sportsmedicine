import { paperPath } from "./paperRoutes";
import type { Item } from "./types";
export const TOPICS = [
  { slug: "acl", query: "ACL", title: "前十字韌帶與運動回歸", description: "查找 ACL 損傷、重建與運動回歸的相關回顧，再依部位、族群與年份縮小範圍。" },
  { slug: "prp", query: "PRP", title: "PRP 與再生治療", description: "查找血小板血漿的相關研究；請核對實際研究部位、比較治療與療效終點。" },
  { slug: "concussion", query: "腦震盪", title: "腦震盪與運動安全", description: "查找腦震盪相關回顧與指引，回溯研究族群、評估方法與適用情境。" },
] as const;
export interface TopicData { slug: string; title: string; description: string; query: string; total: number; items: Item[]; updated: string }
export function TopicLinks() {
  return <nav aria-label="主題閱讀入口" className="grid gap-3 sm:grid-cols-3">{TOPICS.map(topic => <a key={topic.slug} href={`/topics/${topic.slug}/`} className="rounded-lg border border-line p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-line-dark"><span className="font-semibold text-brand dark:text-brand-dark">{topic.title} →</span><p className="mt-1 text-xs text-muted dark:text-muted-dark">{topic.description}</p></a>)}</nav>;
}
export default function Topics({ data }: { data: TopicData }) {
  return <article className="space-y-5 py-5">
    <a href="/" className="inline-flex min-h-11 items-center text-brand underline dark:text-brand-dark">← 返回文獻索引</a>
    <header><p className="text-sm text-muted dark:text-muted-dark">主題閱讀入口</p><h1 className="mt-2 text-3xl font-bold text-ink dark:text-ink-dark">{data.title}</h1><p className="mt-3">{data.description}</p></header>
    <p className="text-sm">依「{data.query}」檢索，共 {data.total} 篇。以下依搜尋相關性列出前 {data.items.length} 篇，索引日期 {data.updated}。這是既有索引的入口，不是完整的系統性文獻搜尋或品質排名。</p>
    <a className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-white" href={`/?${new URLSearchParams({ q: data.query })}`}>搜尋全部結果與調整篩選</a>
    <ol className="divide-y divide-line dark:divide-line-dark">{data.items.map(item => <li key={paperPath(item)} className="space-y-2 py-4"><a href={paperPath(item)} className="font-semibold text-brand underline dark:text-brand-dark" lang="en">{item.title}</a><p className="text-xs text-muted dark:text-muted-dark">{item.year} · {item.journal || item.source}</p><p className="text-sm">{item.tldr || "中文摘要待補，請開啟文獻查看來源。"}</p>{item.tldrSource === "local-llm" && <p className="text-xs text-muted dark:text-muted-dark">AI 摘要，未經人工逐篇核對</p>}</li>)}</ol>
    <TopicLinks />
  </article>;
}
