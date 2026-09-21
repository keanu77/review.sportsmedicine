import { doiOf, sourceInput, workbenchUrl } from "./identity";
import { toVancouver } from "./citation";
import { studyTypeLabel } from "./studyType";
import type { Item } from "./types";

export default function PaperDetails({ item }: { item: Item | undefined }) {
  return <section aria-label="文獻詳情" className="space-y-4 rounded-xl border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark sm:p-6">
    <a className="inline-flex min-h-11 items-center text-brand underline dark:text-brand-dark" href="#">← 返回文獻索引</a>
    {item ? <>
      <h1 className="break-words text-2xl font-bold text-ink dark:text-ink-dark" lang="en">{item.title}</h1>
      <p className="text-sm">{item.journal || item.source} · {item.year || "年份未提供"} · {studyTypeLabel(item.title) || "文體未辨識"}（依標題推測）</p>
      {item.tldr && <p>{item.tldr}{item.tldrSource === "local-llm" && <span className="ml-2 text-xs text-muted dark:text-muted-dark">AI 摘要，未經人工核對</span>}</p>}
      <dl className="space-y-2 break-words text-sm">
        <div><dt className="font-semibold">DOI</dt><dd>{doiOf(item) || "未提供"}</dd></div>
        <div><dt className="font-semibold">PMID／PMCID</dt><dd>{[item.pmid, item.pmcid].filter(Boolean).join(" / ") || "未提供"}</dd></div>
        <div><dt className="font-semibold">作者</dt><dd>{item.authors?.join(", ") || "索引未提供作者，引用前請補核"}</dd></div>
        <div><dt className="font-semibold">全文與授權</dt><dd>{item.free ? "索引標示可能有免費全文；尚未逐篇驗證 PDF 與再利用授權。" : "索引未確認開放全文。"} 工作台會另行查核可取得的原始全文。</dd></div>
      </dl>
      <div className="rounded-lg bg-surface-alt p-3 text-sm dark:bg-surface-altdark"><h2 className="font-semibold">可回溯引用</h2><p className="mt-1 break-words">{toVancouver(item)}</p><p className="mt-2 text-xs">索引未收錄的作者、卷期與頁碼不會自動補造。</p></div>
      <div className="flex flex-wrap gap-3">
        <a className="inline-flex min-h-11 items-center rounded border border-linestrong px-3" href={item.url} target="_blank" rel="noopener noreferrer">原始文獻 ↗</a>
        <a className="inline-flex min-h-11 items-center rounded bg-brand-strong px-3 text-white" href={workbenchUrl(item)}>製作社群素材</a>
      </div>
      {!sourceInput(item) && <p className="text-sm">這篇索引尚無可辨識的 DOI、PMID 或 PMCID；進入工作台後需補上識別碼。</p>}
    </> : <p role="status">索引中找不到這篇文獻；請返回索引重新搜尋。</p>}
  </section>;
}
