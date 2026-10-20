import { useId, useMemo, useState } from "react";
import { toBibTeXBatch, toRISBatch, toVancouver } from "./citation";
import { LIBRARY_MAX_BYTES } from "./libraryStorage";
import type { ReadStatus } from "./libraryStorage";
import type { Item } from "./types";
import type { LibraryApi } from "./useLibrary";

interface LibraryPanelProps { library: LibraryApi; onOpen?: (item: Item) => void }
const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-linestrong px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 dark:border-linestrong-dark";
function download(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LibraryPanel({ library, onOpen }: LibraryPanelProps) {
  const headingId = useId(), fileId = useId();
  const [filter, setFilter] = useState<"all" | ReadStatus>("all");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const saved = useMemo(() => library.entries.filter(entry => entry.starred), [library.entries]);
  const visible = saved.filter(entry => filter === "all" || entry.readStatus === filter);
  const chosen = saved.filter(entry => selected.has(entry.id));
  const exportable = chosen.flatMap(entry => entry.snapshot ? [entry.snapshot] : []);
  const allVisible = visible.length > 0 && visible.every(entry => selected.has(entry.id));
  const exportFile = (format: "ris" | "bib") => {
    try {
      download(format === "ris" ? toRISBatch(exportable) : toBibTeXBatch(exportable), `sportsmedicine-library.${format}`, format === "ris" ? "application/x-research-info-systems;charset=utf-8" : "application/x-bibtex;charset=utf-8");
      setNotice(`已準備 ${exportable.length} 篇文獻的 ${format === "ris" ? "RIS" : "BibTeX"} 檔。${chosen.length > exportable.length ? `另有 ${chosen.length - exportable.length} 篇舊收藏缺少書目快照，請用 JSON 備份保留。` : "缺漏書目欄位請回溯原文確認。"}`);
    } catch { setNotice("無法建立下載檔，請檢查瀏覽器的下載設定後重試。"); }
  };
  return <section aria-labelledby={headingId} className="space-y-4 rounded-xl border border-line bg-surface p-4 text-body dark:border-line-dark dark:bg-surface-dark dark:text-body-dark sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id={headingId} className="text-xl font-bold text-ink dark:text-ink-dark">我的文獻庫 <span className="text-base font-normal">{saved.length} 篇</span></h2>
        <p className="mt-1 max-w-3xl text-sm text-muted dark:text-muted-dark">只儲存在這個瀏覽器，不會跨裝置同步。清除網站資料可能遺失；請定期匯出 JSON 備份。保存的書目與摘要可在文獻離開目前索引後繼續查閱，不包含全文。</p>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" className={button} disabled={library.storageStatus === "loading"} onClick={() => {
          try { download(library.exportBackup(), `sportsmedicine-library-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8"); setNotice("已準備 JSON 備份，包含收藏、閱讀狀態、最近點閱與書目快照。"); }
          catch { setNotice("無法建立備份檔，請檢查瀏覽器的下載設定後重試。"); }
        }}>匯出 JSON 備份</button>
        <label htmlFor={fileId} className={`${button} relative cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand`}>
          {importing ? "匯入中…" : "匯入 JSON 備份"}
          <input id={fileId} aria-label="匯入文獻庫 JSON 備份" className="absolute inset-0 w-full cursor-pointer opacity-0" type="file" accept=".json,application/json" disabled={importing || library.storageStatus === "loading"} onChange={async event => {
            const input = event.currentTarget, file = input.files?.[0];
            if (!file) return;
            setImporting(true);
            try {
              if (file.size > LIBRARY_MAX_BYTES) { setNotice("備份超過 4 MB 上限，原有文獻庫未變更。"); return; }
              const result = library.importBackup(await file.text());
              setNotice(result.message);
            } catch { setNotice("無法讀取備份檔，原有文獻庫未變更。"); }
            finally { input.value = ""; setImporting(false); }
          }} />
        </label>
      </div>
    </div>
    {library.storageMessage && <p role="alert" className="rounded-lg border border-linestrong bg-surface-alt p-3 text-sm dark:border-linestrong-dark dark:bg-surface-altdark">{library.storageMessage}</p>}
    <p className="sr-only" role="status" aria-live="polite">{notice}</p>
    {notice && <p aria-hidden="true" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="依閱讀狀態顯示收藏">
      {([ ["all", "全部"], ["pending", "待讀"], ["read", "已讀"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} className={`${button} ${filter === value ? "bg-surface-alt text-ink dark:bg-surface-altdark dark:text-ink-dark" : ""}`} onClick={() => setFilter(value)}>{label}（{value === "all" ? saved.length : saved.filter(entry => entry.readStatus === value).length}）</button>)}
    </div>
    {saved.length > 0 && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 print:hidden dark:border-line-dark">
      <button type="button" disabled={!visible.length} className={button} onClick={() => setSelected(previous => {
        const next = new Set(previous);
        for (const entry of visible) if (allVisible) next.delete(entry.id); else next.add(entry.id);
        return next;
      })}>{allVisible ? "取消勾選目前清單" : "勾選目前清單"}</button>
      <span className="text-sm">已勾選 {chosen.length} 篇</span>
      <button type="button" className={button} disabled={!exportable.length} onClick={() => exportFile("ris")}>匯出所選 RIS</button>
      <button type="button" className={button} disabled={!exportable.length} onClick={() => exportFile("bib")}>匯出所選 BibTeX</button>
    </div>}
    {library.storageStatus === "loading" ? <p role="status">正在讀取本機文獻庫…</p> : visible.length === 0 ? <p className="py-3 text-sm">{saved.length ? "這個閱讀狀態目前沒有文獻。" : "在文獻旁按下收藏，即可保存書目與摘要，並安排待讀或已讀狀態。"}</p> : <ul className="divide-y divide-line dark:divide-line-dark">
      {visible.map(entry => <li key={entry.id} className="space-y-3 py-4">
        <div className="flex items-start gap-3">
          <label className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center print:hidden"><input type="checkbox" className="h-5 w-5 accent-brand" checked={selected.has(entry.id)} aria-label={`勾選文獻：${entry.snapshot?.title ?? entry.id}`} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(entry.id); else next.delete(entry.id); return next; })} /></label>
          <div className="min-w-0 flex-1">
            <h3 className="break-words font-semibold text-ink dark:text-ink-dark" lang={entry.snapshot ? "en" : undefined}>{entry.snapshot?.title ?? `舊收藏：${entry.id}`}</h3>
            {entry.snapshot ? <p className="mt-1 text-sm text-muted dark:text-muted-dark">{entry.snapshot.journal || entry.snapshot.source} · {entry.snapshot.year ?? "年份未提供"}</p> : <p className="mt-1 text-sm">這篇舊收藏尚無書目快照，可能已離開目前索引。識別碼仍保留在 JSON 備份中。</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <label className="flex min-h-11 items-center gap-2 text-sm">閱讀狀態
            <select aria-label={`閱讀狀態：${entry.snapshot?.title ?? entry.id}`} className="min-h-11 rounded-lg border border-linestrong bg-surface px-2 dark:border-linestrong-dark dark:bg-surface-dark" value={entry.readStatus} onChange={event => library.setReadStatus(entry.id, event.target.value as ReadStatus, entry.snapshot ?? undefined)}><option value="pending">待讀</option><option value="read">已讀</option></select>
          </label>
          <button type="button" className={button} aria-label={`取消收藏：${entry.snapshot?.title ?? entry.id}`} onClick={() => library.toggleStar(entry.id, entry.aliases, entry.snapshot ?? undefined)}>取消收藏</button>
          {entry.snapshot && onOpen && <button type="button" className={button} onClick={() => onOpen(entry.snapshot!)}>開啟文獻詳情</button>}
        </div>
        {entry.snapshot && <details className="rounded-lg bg-surface-alt p-3 text-sm dark:bg-surface-altdark">
          <summary className="cursor-pointer py-1 font-medium">查閱保存的摘要與書目</summary>
          <div className="mt-3 space-y-3 break-words">
            <p>{entry.snapshot.tldr || entry.snapshot.abstract?.text || "未保存摘要。"}</p>
            {!entry.snapshot.tldr && entry.snapshot.abstract && <p className="text-xs text-muted dark:text-muted-dark">{entry.snapshot.abstract.excerptOnly ? "原文摘要節錄（非完整摘要），來源：" : "原文摘要來源："}<a className="underline" href={entry.snapshot.abstract.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.snapshot.abstract.source}</a> · {entry.snapshot.abstract.verifiedAt.slice(0, 10)}</p>}
            {entry.snapshot.tldrSource === "local-llm" && <p className="text-xs text-muted dark:text-muted-dark">AI 摘要，未經人工核對。</p>}
            <p>{toVancouver(entry.snapshot)}</p>
            <p className="text-xs text-muted dark:text-muted-dark">書目欄位缺漏時不會自動補造；引用前請回溯原文確認。</p>
            <a href={entry.snapshot.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-brand underline dark:text-brand-dark" onClick={() => library.markRead(entry.id, entry.snapshot!)}>原始文獻 ↗</a>
          </div>
        </details>}
      </li>)}
    </ul>}
  </section>;
}
