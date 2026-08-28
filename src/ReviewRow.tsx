import type { Item } from "./types";

// 單篇文獻列。主索引的疾病展開清單與「本月新增」清單共用同一份樣式。
// showTaxonomy：脫離分組脈絡時（新增清單）補上部位／主題標籤。

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 5h5v5" />
      <path d="M19 5 11 13" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

export default function ReviewRow({
  item,
  jcrYear,
  showTaxonomy = false,
}: {
  item: Item;
  jcrYear: string;
  showTaxonomy?: boolean;
}) {
  const diseases = item.diseases?.length ? item.diseases : [item.disease];

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        {item.year && (
          <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {item.year}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
          >
            {item.title}
          </a>
          {item.tldr && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {item.tldr}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {showTaxonomy && (
              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                {item.region}
                {diseases.filter(Boolean).length > 0 &&
                  ` · ${diseases.filter(Boolean).join("／")}`}
              </span>
            )}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {item.source}
            </span>
            {typeof item.impactFactor === "number" && (
              <span
                className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                title={`期刊影響係數（近似，Clarivate JCR ${jcrYear}）`}
              >
                IF≈{item.impactFactor}
              </span>
            )}
            {item.origin === "pubmed" && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                PubMed{item.pmid ? ` ${item.pmid}` : ""}
              </span>
            )}
            {item.free && (
              <a
                href={item.freeUrl || item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400"
              >
                🔓 免費全文 <LinkIcon />
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
