import { useEffect, useState } from "react";
import ReviewRow from "./ReviewRow";
import type { NewItemsData } from "./types";

// 「本月新增文獻」——每月同步時由 scripts/build-new-items.mjs 比對前後快照算出，
// 逐篇條列（已去重）。資料檔不存在或格式不符時整個區塊靜默不顯示，不影響主索引。

function monthLabel(batch: string | null): string {
  if (!batch) return "最新新增文獻";
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return batch.slice(0, 7) === currentMonth ? "本月新增文獻" : "最新新增文獻";
}

export default function NewThisMonth({ jcrYear }: { jcrYear: string }) {
  const [data, setData] = useState<NewItemsData | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/new-items.json`, { cache: "no-store" })
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
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-emerald-900 dark:text-emerald-200">
            🆕 {monthLabel(data.batch)}
            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
              {data.count}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-emerald-800/70 dark:text-emerald-300/70">
            {data.batch ?? "—"} 批次
            {data.previousBatch && ` · 相對前次（${data.previousBatch}）新增`}
          </p>
        </div>
        <svg
          viewBox="0 0 24 24"
          className={`h-5 w-5 shrink-0 text-emerald-700 transition-transform dark:text-emerald-400 ${
            expanded ? "rotate-90" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>

      {expanded &&
        (data.count === 0 ? (
          <p className="border-t border-emerald-200 px-4 py-3 text-sm text-emerald-800/80 dark:border-emerald-900 dark:text-emerald-300/80">
            本批次沒有新增文獻。
          </p>
        ) : (
          <ul className="max-h-[26rem] divide-y divide-emerald-100 overflow-y-auto border-t border-emerald-200 bg-white dark:divide-slate-800 dark:border-emerald-900 dark:bg-slate-900">
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
    </section>
  );
}
