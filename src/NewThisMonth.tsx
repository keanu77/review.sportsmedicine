import { useEffect, useId, useState } from "react";
import ReviewRow from "./ReviewRow";
import type { NewItemsData } from "./types";

// 「本月新增文獻」——每月同步時由 scripts/build-new-items.mjs 比對前後快照算出。
//
// 預設收合：回訪的醫師每次進站要的是搜尋框，不是先跨過 28 篇無中文摘要的英文長標題；
// 而且資料是非同步抵達的，預設展開會在 Hero 與工具列之間插進一大塊內容造成版面跳動。
// 資料檔不存在或格式不符時整個區塊靜默不顯示，不影響主索引。

function monthLabel(batch: string | null): string {
  if (!batch) return "最新新增文獻";
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return batch.slice(0, 7) === currentMonth ? "本月新增文獻" : "最新新增文獻";
}

export default function NewThisMonth({ jcrYear }: { jcrYear: string }) {
  const [data, setData] = useState<NewItemsData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/new-items.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: NewItemsData | null) => {
        if (!cancelled && d && Array.isArray(d.items)) setData(d);
      })
      .catch(() => {
        /* 新增清單是附加資訊，載入失敗就不顯示 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20"
    >
      <h2 id={headingId}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700 dark:focus-visible:ring-emerald-400"
        >
          <span className="min-w-0">
            <span className="text-base font-bold text-emerald-900 dark:text-emerald-200">
              {monthLabel(data.batch)}
            </span>
            <span className="ml-2 rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
              {data.count}
            </span>
            <span className="mt-0.5 block text-xs text-emerald-900/80 dark:text-emerald-300/80">
              {data.batch ?? "—"} 批次
              {data.previousBatch && ` · 相對前次（${data.previousBatch}）新增`}
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            className={`h-5 w-5 shrink-0 text-emerald-800 transition-transform dark:text-emerald-400 ${
              expanded ? "rotate-90" : ""
            }`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </h2>

      <div id={panelId} hidden={!expanded}>
        {expanded &&
          (data.count === 0 ? (
            <p className="border-t border-emerald-300 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:text-emerald-300">
              本批次沒有新增文獻。
            </p>
          ) : (
            <ul className="divide-y divide-emerald-100 border-t border-emerald-300 bg-white dark:divide-slate-800 dark:border-emerald-800 dark:bg-slate-900">
              {data.items.map((item) => (
                <ReviewRow
                  key={item.url || item.title}
                  item={item}
                  jcrYear={jcrYear}
                  showTaxonomy
                />
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
