import { useState } from "react";
import { copyText, toBibTeX, toVancouver } from "./citation";
import { studyTypeLabel } from "./studyType";
import { canonicalPaperId } from "./identity";
import type { Item } from "./types";

// 單篇文獻列。主索引的疾病展開清單、搜尋結果與「本月新增」共用。
//
// 資訊層級依醫師掃視的順序排：這是不是我要的題目（標題）→ 一句中文主張（tldr）
// → 哪年、什麼期刊、什麼證據等級（meta 行）→ 能不能打開（動作）。
// IF 刻意降權成 meta 行末的灰字：它是期刊級的近似值，不是這篇的證據等級，
// 原本的琥珀色塊比標題還搶眼，等於鼓勵用 IF 選文。

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 5h5v5" />
      <path d="M19 5 11 13" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </svg>
  );
}

const ACTION_CLASS =
  "inline-flex min-h-[2rem] items-center gap-1 rounded px-2 py-1 text-xs font-medium " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1";

export default function ReviewRow({
  item,
  jcrYear,
  showTaxonomy = false,
  starred = false,
  onToggleStar,
  onOpen,
}: {
  item: Item;
  jcrYear: string;
  showTaxonomy?: boolean;
  starred?: boolean;
  onToggleStar?: () => void;
  onOpen?: () => void;
}) {
  const [copied, setCopied] = useState<"vancouver" | "bibtex" | null>(null);

  const copy = async (format: "vancouver" | "bibtex") => {
    const text = format === "vancouver" ? toVancouver(item) : toBibTeX(item);
    if (await copyText(text)) {
      setCopied(format);
      window.setTimeout(() => setCopied(null), 2000);
    }
  };

  const diseases = (item.diseases?.length ? item.diseases : [item.disease]).filter(
    Boolean,
  );
  const evidence = studyTypeLabel(item.title);
  const pubmedUrl = item.pmid
    ? `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`
    : null;

  return (
    <li className="px-3 py-3">
      <div className="flex items-start gap-3">
        {item.year && (
          <span className="mt-0.5 w-10 shrink-0 text-sm tabular-nums text-muted dark:text-muted-dark">
            {item.year}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
            className="inline-block py-1 text-base font-semibold leading-snug text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-ink-dark dark:focus-visible:ring-brand-dark"
          >
            <span lang="en">{item.title}</span>
            <span className="sr-only">（另開新分頁）</span>
          </a>

          {item.tldr && (
            <p className="mt-1 text-sm leading-relaxed text-body dark:text-body-dark">
              {item.tldr}
              {item.tldrSource === "local-llm" && (
                <span
                  className="ml-1.5 whitespace-nowrap rounded border border-line px-1 py-px align-middle text-[10px] font-medium text-muted dark:border-line-dark dark:text-muted-dark"
                  title="本句由本機語言模型自 PubMed 摘要生成，未經人工核對"
                >
                  AI 摘要
                </span>
              )}
            </p>
          )}

          {/* meta 行：純文字、無底色，靠分隔點串起來，不與動作競爭視覺權重 */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted dark:text-muted-dark">
            {showTaxonomy && diseases.length > 0 && (
              <span>
                {item.region} · {diseases.join("／")}
              </span>
            )}
            <span lang="en">{item.source}</span>
            {item.firstPublicationDate && <time dateTime={item.firstPublicationDate} title="Europe PMC 首次發表日期，部分日期可能由來源推定">首次發表 {item.firstPublicationDate}</time>}
            {evidence && <span title="依標題推測文體，不代表本篇證據品質">{evidence}</span>}
            {typeof item.impactFactor === "number" && (
              <span className="tabular-nums text-muted dark:text-muted-dark">
                <span aria-hidden="true">IF {item.impactFactor}</span>
                <span className="sr-only">
                  期刊影響係數近似值 {item.impactFactor}，Clarivate JCR {jcrYear}，
                  代表期刊而非本篇的證據等級
                </span>
              </span>
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-2 print:hidden">
            <a href={`#paper=${encodeURIComponent(canonicalPaperId(item))}`} className={`${ACTION_CLASS} border border-linestrong text-body hover:bg-surface-alt dark:text-body-dark dark:border-linestrong-dark`} onClick={onOpen}>文獻詳情</a>
            {item.free && (
              <a
                href={item.freeUrl || item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${ACTION_CLASS} bg-free text-white hover:bg-free/90 focus-visible:ring-free`}
              >
                免費全文 <ExternalIcon />
                <span className="sr-only">（另開新分頁）</span>
              </a>
            )}
            {pubmedUrl && (
              <a
                href={pubmedUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onOpen}
                className={`${ACTION_CLASS} border border-linestrong text-body hover:bg-surface-alt focus-visible:ring-brand dark:border-linestrong-dark dark:text-body-dark dark:hover:bg-surface-altdark`}
              >
                PubMed <ExternalIcon />
                <span className="sr-only">（另開新分頁）</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => copy("vancouver")}
              className={`${ACTION_CLASS} cursor-pointer border border-linestrong text-body hover:bg-surface-alt focus-visible:ring-brand dark:border-linestrong-dark dark:text-body-dark dark:hover:bg-surface-altdark`}
            >
              {copied === "vancouver" ? "已複製" : "複製引用"}
            </button>
            <button
              type="button"
              onClick={() => copy("bibtex")}
              className={`${ACTION_CLASS} cursor-pointer border border-linestrong text-body hover:bg-surface-alt focus-visible:ring-brand dark:border-linestrong-dark dark:text-body-dark dark:hover:bg-surface-altdark`}
            >
              {copied === "bibtex" ? "已複製" : "BibTeX"}
            </button>

            {onToggleStar && (
              <button
                type="button"
                onClick={onToggleStar}
                aria-pressed={starred}
                className={`${ACTION_CLASS} cursor-pointer border focus-visible:ring-brand ${
                  starred
                    ? "border-brand bg-brand/10 text-brand dark:border-brand-dark dark:text-brand-dark"
                    : "border-linestrong text-body hover:bg-surface-alt dark:border-linestrong-dark dark:text-body-dark dark:hover:bg-surface-altdark"
                }`}
              >
                <StarIcon filled={starred} />
                {starred ? "已收藏" : "收藏"}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
