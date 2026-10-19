import { useState } from "react";
import { doiOf } from "./identity";
import { copyText, toBibTeX, toVancouver } from "./citation";
import { studyTypeLabel } from "./studyType";
import type { ReadStatus } from "./libraryStorage";
import type { Item } from "./types";

const action = "inline-flex min-h-11 items-center justify-center rounded-lg border border-linestrong px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark";
export default function PaperDetails({ item, returnHref = "/", starred = false, onToggleStar, readStatus, onReadStatus }: {
  item: Item | undefined; returnHref?: string; starred?: boolean; onToggleStar?: () => void;
  readStatus?: ReadStatus; onReadStatus?: (status: ReadStatus) => void;
}) {
  const [feedback, setFeedback] = useState("");
  const copy = async (format: "vancouver" | "bibtex") => {
    if (!item) return;
    setFeedback(await copyText(format === "vancouver" ? toVancouver(item) : toBibTeX(item)) ? "引用已複製" : "無法存取剪貼簿，請選取下方引用文字複製。");
  };
  return <section aria-label="文獻詳情" className="space-y-5 rounded-xl border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark sm:p-6">
    <a className="inline-flex min-h-11 items-center text-brand underline dark:text-brand-dark" href={returnHref}>← 返回文獻索引</a>
    {item ? <>
      <header className="space-y-3">
        <p className="text-sm text-muted dark:text-muted-dark">{item.journal || item.source} · {item.year || "年份未提供"} · {studyTypeLabel(item.title) || "文體未辨識"}（依標題推測）</p>
        <h1 className="break-words text-2xl font-bold leading-snug text-ink dark:text-ink-dark sm:text-3xl" lang="en">{item.title}</h1>
        <p className="text-sm">{[item.region, item.disease].filter(Boolean).join(" · ")}</p>
      </header>
      <div className="flex flex-wrap gap-2 print:hidden">
        {onToggleStar && <button className={`${action} motion-action`} type="button" aria-pressed={starred} onClick={onToggleStar}>{starred ? "★ 已收藏" : "☆ 收藏文獻"}</button>}
        {onReadStatus && <button className={action} type="button" aria-pressed={readStatus === "read"} onClick={() => onReadStatus(readStatus === "read" ? "pending" : "read")}>{readStatus === "read" ? "已讀，改為待讀" : "標記為已讀"}</button>}
        <button className={action} type="button" onClick={() => copy("vancouver")}>複製引用</button>
        <button className={action} type="button" onClick={() => copy("bibtex")}>複製 BibTeX</button>
        <p role="status" className="w-full text-sm text-brand dark:text-brand-dark">{feedback}</p>
      </div>
      <section className="rounded-lg bg-surface-alt p-4 dark:bg-surface-altdark" aria-label="中文閱讀摘要">
        <h2 className="font-semibold text-ink dark:text-ink-dark">中文閱讀摘要</h2>
        <p className="mt-2 leading-relaxed">{item.tldr || "這篇文獻的中文摘要尚待補齊；請先從下方來源閱讀原始摘要。"}</p>
        {item.tldrSource === "local-llm" && <p className="mt-2 text-xs text-muted dark:text-muted-dark">AI 依來源摘要整理，未經人工逐篇核對。閱讀結論前，請回溯研究族群、方法與限制。</p>}
      </section>
      {item.abstract && <section className="space-y-3" aria-label="原始摘要">
        <h2 className="font-semibold text-ink dark:text-ink-dark">{item.abstract.excerptOnly ? "原始摘要節錄" : "原始摘要"}</h2>
        {item.abstract.sections?.length ? item.abstract.sections.map((part, i) => <div key={i} lang="en"><h3 className="text-sm font-semibold">{part.label}</h3><p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{part.text}</p></div>) : <p lang="en" className="whitespace-pre-line text-sm leading-relaxed">{item.abstract.text}</p>}
        <p className="text-xs text-muted dark:text-muted-dark"><a className="text-brand underline dark:text-brand-dark" href={item.abstract.sourceUrl} target="_blank" rel="noopener noreferrer">至 {item.abstract.source} 閱讀完整來源 ↗</a> · 擷取日期 {item.abstract.verifiedAt.slice(0, 10)}</p>
      </section>}
      <details className="rounded-lg border border-line p-3 dark:border-line-dark">
        <summary className="min-h-11 cursor-pointer font-semibold">書目、來源與全文狀態</summary>
        <dl className="mt-2 space-y-3 break-words text-sm">
          <div><dt className="font-semibold">DOI</dt><dd>{doiOf(item) || "未提供"}</dd></div>
          <div><dt className="font-semibold">PMID／PMCID</dt><dd>{[item.pmid, item.pmcid].filter(Boolean).join(" / ") || "未提供"}</dd></div>
          <div><dt className="font-semibold">作者</dt><dd>{item.authors?.join(", ") || "索引未提供作者，引用前請補核"}</dd></div>
          <div><dt className="font-semibold">首次發表日期</dt><dd>{item.firstPublicationDate || "未提供完整日期"}{item.firstPublicationDate && <span className="block text-xs">Europe PMC 提供，部分日期可能依年份或月份推定。</span>}</dd></div>
          <div><dt className="font-semibold">卷／期／頁碼或文章編號</dt><dd>{item.volume || "卷未提供"} ／ {item.issue || "期未提供"} ／ {item.pages || "頁碼或文章編號未提供"}</dd></div>
          <div><dt className="font-semibold">書目來源與查核日期</dt><dd>{item.bibliography ? <><a className="text-brand underline dark:text-brand-dark" href={item.bibliography.sourceUrl} target="_blank" rel="noopener noreferrer">{item.bibliography.source}</a> · {item.bibliography.verifiedAt.slice(0, 10)}<span className="block text-xs">僅核對書目欄位與來源連結；不代表已評讀研究品質。</span></> : "書目資料尚未取得可核對來源；缺漏欄位請回溯原文確認。"}</dd></div>
          <div><dt className="font-semibold">全文與授權</dt><dd>{item.fullText?.status === "verified" ? `來源列有免費全文（查核 ${item.fullText.verifiedAt?.slice(0, 10) || "日期未提供"}），未逐篇測試 PDF 下載。` : item.free ? "上游標示可能有免費全文，尚待來源確認。" : "來源尚未確認免費全文。"} {item.fullText?.license ? `來源授權標示：${item.fullText.license}。` : "未提供再利用授權。"}</dd></div>
        </dl>
      </details>
      <section className="rounded-lg bg-surface-alt p-3 text-sm dark:bg-surface-altdark"><h2 className="font-semibold">可回溯引用</h2><p className="mt-1 break-words">{toVancouver(item)}</p></section>
      <div className="flex flex-wrap gap-3">
        <a className={action} href={item.url} target="_blank" rel="noopener noreferrer">原始文獻 ↗</a>
        {item.free && <a className={`${action} bg-free text-white`} href={item.fullText?.url || item.freeUrl || item.url} target="_blank" rel="noopener noreferrer">{item.fullText?.status === "verified" ? "來源列出的免費全文" : "查看可能的免費全文"} ↗</a>}
      </div>
      <p className="text-xs text-muted dark:text-muted-dark">本站供教育與研究參考。單篇摘要、文體標籤與期刊影響係數不等於證據品質或個別病人的診療建議。</p>
    </> : <p role="status">索引中找不到這篇文獻；請返回索引重新搜尋。</p>}
  </section>;
}
