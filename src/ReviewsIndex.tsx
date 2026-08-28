import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import NewThisMonth from "./NewThisMonth";
import ReviewRow from "./ReviewRow";
import { groupOf } from "./regionGroups";
import { matchesQuery, suggestTerms, tokenize } from "./search";
import type { Axis, Item, ReviewsData } from "./types";
import { useUrlState } from "./useUrlState";

// ---------------------------------------------------------------------------
// 運動醫學 Review 索引（獨立公開頁）
// 資料：public/data/reviews-index.json（RSS monorepo 的 scripts/reviews-index-* 產生後同步）
//
// 兩種模式：
//  - 瀏覽模式（無查詢）：依所選軸分組 → 疾病手風琴，適合不知道要找什麼時逛。
//  - 搜尋模式（有查詢）：平坦列表直接列出命中文獻。手風琴適合 2–5 筆補充內容，
//    不適合當搜尋結果——原本搜尋後只看到一條收合的「膝 · 69 篇」，還要再點一次。
// ---------------------------------------------------------------------------

const AXIS_LABEL: Record<Axis, string> = {
  region: "依部位",
  theme: "依臨床主題",
  population: "依族群",
};

// 缺值桶。237 篇 PubMed 文獻的 themes／populations 是空陣列，若直接回空陣列，
// 這些文獻在「依臨床主題」「依族群」兩軸會整批消失（首頁卻宣稱收錄 PubMed）。
const UNLABELLED: Record<Axis, string> = {
  region: "未分類部位",
  theme: "未分類主題",
  population: "未標族群",
};

function keysForAxis(item: Item, axis: Axis): string[] {
  const keys =
    axis === "region"
      ? [item.region].filter(Boolean)
      : axis === "theme"
        ? item.themes
        : item.populations;
  return keys.length ? keys : [UNLABELLED[axis]];
}

// 綜合排序：以「近的區間優先」，同區間內 IF 高者優先，再依年份新到舊。
const INTERVAL = 5;
const ANCHOR_YEAR = new Date().getFullYear();
function intervalBucket(year: number | null | undefined): number {
  if (year == null) return 1e9;
  return Math.floor((ANCHOR_YEAR - year) / INTERVAL);
}
function sortByIntervalThenIF(a: Item, b: Item): number {
  const ba = intervalBucket(a.year);
  const bb = intervalBucket(b.year);
  if (ba !== bb) return ba - bb;
  const ia = a.impactFactor ?? -1;
  const ib = b.impactFactor ?? -1;
  if (ib !== ia) return ib - ia;
  return (b.year ?? 0) - (a.year ?? 0);
}
function sortByYear(a: Item, b: Item): number {
  return (b.year ?? 0) - (a.year ?? 0) || (b.impactFactor ?? -1) - (a.impactFactor ?? -1);
}

// 上游同一篇文獻會以兩種方式重複出現：依多個疾病重複列出（分組瀏覽時刻意如此），
// 以及同一篇同時收錄 DOI 版與出版社版網址（41 組）。統計與平坦列表都必須以
// 「唯一文獻」為單位，否則切換分類軸時首頁數字會從 911 跳到 1,291。
//
// 去重鍵用正規化標題而非網址——網址才是會分裂的那個欄位。
function paperKey(item: Item): string {
  return item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") || item.url;
}

function uniqueItems(items: Item[]): Item[] {
  const byKey = new Map<string, Item>();
  for (const item of items) {
    const key = paperKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...item, diseases: [item.disease].filter(Boolean) });
      continue;
    }
    const diseases =
      item.disease && !existing.diseases?.includes(item.disease)
        ? [...(existing.diseases ?? []), item.disease]
        : existing.diseases;
    // 合併時保留資訊較多的那份：有 PMID、有免費全文連結的優先。
    byKey.set(key, {
      ...existing,
      diseases,
      pmid: existing.pmid ?? item.pmid,
      free: existing.free || item.free,
      freeUrl: existing.freeUrl ?? item.freeUrl,
      tldr: existing.tldr ?? item.tldr,
      impactFactor: existing.impactFactor ?? item.impactFactor,
    });
  }
  return [...byKey.values()];
}

interface DiseaseGroup {
  disease: string;
  items: Item[];
}
interface AxisGroup {
  key: string;
  diseases: DiseaseGroup[];
  total: number;
}

export default function ReviewsIndex() {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useUrlState();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const searchId = useId();

  const axis = (["region", "theme", "population"] as const).includes(
    view.axis as Axis,
  )
    ? (view.axis as Axis)
    : "region";
  const freeOnly = view.free;

  // 本地過濾工作量不小（911 筆 × 多欄位），用 useDeferredValue 讓輸入保持即時回應。
  const deferredQ = useDeferredValue(view.q);
  const isSearching = view.q !== deferredQ;
  const tokens = useMemo(() => tokenize(deferredQ), [deferredQ]);
  const hasQuery = tokens.length > 0;

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/reviews-index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ReviewsData) => setData(d))
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  useEffect(() => setOpen(new Set()), [axis]);

  const filtered: Item[] = useMemo(() => {
    if (!data) return [];
    return data.items.filter((it) => {
      if (freeOnly && !it.free) return false;
      return matchesQuery(it, tokens);
    });
  }, [data, tokens, freeOnly]);

  /** 搜尋模式的平坦結果，已去重。 */
  const flatResults = useMemo(
    () => (hasQuery ? uniqueItems(filtered).sort(sortByYear) : []),
    [filtered, hasQuery],
  );

  const groups: AxisGroup[] = useMemo(() => {
    if (!data || hasQuery) return [];
    const byKey = new Map<string, Map<string, Item[]>>();
    for (const it of filtered) {
      for (const k of keysForAxis(it, axis)) {
        if (!byKey.has(k)) byKey.set(k, new Map());
        const dm = byKey.get(k)!;
        if (!dm.has(it.disease)) dm.set(it.disease, []);
        dm.get(it.disease)!.push(it);
      }
    }

    const order = data.axes[axis].map((a) => a.key);
    const result: AxisGroup[] = [];
    for (const [key, dm] of byKey) {
      const diseases: DiseaseGroup[] = [...dm.entries()].map(([disease, items]) => ({
        disease,
        items,
      }));
      diseases.sort((a, b) => b.items.length - a.items.length);
      const total = diseases.reduce((n, d) => n + d.items.length, 0);
      result.push({ key, diseases, total });
    }
    const rank = (k: string) => {
      if (k.startsWith("未")) return 1e12;
      const i = order.indexOf(k);
      return i === -1 ? 1e9 : i;
    };
    result.sort((a, b) => rank(a.key) - rank(b.key) || b.total - a.total);
    return result;
  }, [data, axis, filtered, hasQuery]);

  // 統計一律以唯一文獻計數。切換分類軸不該改變「有幾篇文獻」這件事。
  const stats = useMemo(() => {
    const unique = uniqueItems(filtered);
    return {
      groupCount: hasQuery ? 0 : groups.length,
      reviewCount: unique.length,
      freeCount: unique.filter((i) => i.free).length,
    };
  }, [filtered, groups, hasQuery]);

  const totalUnique = useMemo(
    () => (data ? uniqueItems(data.items).length : 0),
    [data],
  );

  const suggestions = useMemo(
    () =>
      data && hasQuery && flatResults.length === 0
        ? suggestTerms(data.items, deferredQ)
        : [],
    [data, hasQuery, flatResults.length, deferredQ],
  );

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (err) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
      >
        資料載入失敗：{err}
        <div className="mt-1 text-sm">
          預期檔案：<code>data/reviews-index.json</code>
        </div>
      </div>
    );
  }
  if (!data)
    return (
      <div role="status" aria-live="polite" className="p-8 text-body dark:text-body-dark">
        載入分類資料中…
      </div>
    );

  const jcrYear = data.meta.ifJcrYear ?? "2023";

  return (
    <div className="space-y-5">
      {/* Hero */}
      <header className="rounded-xl border border-line bg-surface p-5 dark:border-line-dark dark:bg-surface-dark">
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink dark:text-ink-dark">
          運動醫學 Review 索引
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-body dark:text-body-dark">
          從知識庫的運動醫學／復健文獻，加上 PubMed
          權威期刊（BJSM、AJSM、JOSPT、KSSTA、Cochrane…）
          的近年綜述，篩出系統性回顧、統合分析與臨床指引，可依
          <span className="font-medium">部位、臨床主題、族群</span>
          三種方式瀏覽。
        </p>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Stat n={stats.reviewCount} label={hasQuery ? "篇符合" : "篇文獻"} />
          <Stat n={stats.freeCount} label="免費全文" accent />
          {!hasQuery && (
            <Stat
              n={stats.groupCount}
              label={AXIS_LABEL[axis].replace("依", "") + "分類"}
            />
          )}
          {data.meta.updated && (
            <span className="text-xs text-muted dark:text-muted-dark">
              更新：{data.meta.updated}
            </span>
          )}
        </div>
      </header>

      <NewThisMonth jcrYear={jcrYear} />

      {/* Toolbar：行動裝置不 sticky，避免動態高度的工具列遮住錨點目標 */}
      <div className="z-10 space-y-3 rounded-lg border border-line bg-surface/95 p-3 backdrop-blur dark:border-line-dark dark:bg-surface-dark/95 sm:sticky sm:top-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor={searchId}
              className="mb-1 block text-xs font-medium text-body dark:text-body-dark"
            >
              搜尋文獻
            </label>
            <input
              id={searchId}
              type="search"
              value={view.q}
              onChange={(e) => setView({ q: e.target.value })}
              placeholder="病名、縮寫或期刊，例：ACL、PRP、RTP、冰凍肩、BJSM"
              className="min-h-11 w-full rounded-md border border-linestrong bg-surface px-3 text-sm text-ink placeholder:text-muted focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:bg-surface-altdark dark:text-ink-dark dark:placeholder:text-muted-dark dark:focus-visible:ring-brand-dark"
            />
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-body dark:text-body-dark">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(e) => setView({ free: e.target.checked })}
              className="h-5 w-5 rounded accent-brand-strong"
            />
            只顯示免費全文
          </label>
        </div>

        {!hasQuery && (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">分類方式</legend>
            <span className="text-xs text-body dark:text-body-dark">分類方式</span>
            {(Object.keys(AXIS_LABEL) as Axis[]).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={axis === a}
                onClick={() => setView({ axis: a })}
                className={`min-h-11 cursor-pointer rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  axis === a
                    ? "bg-brand-strong text-white"
                    : "bg-surface-alt text-body hover:bg-line dark:bg-surface-altdark dark:text-body-dark dark:hover:bg-line-dark"
                }`}
              >
                {axis === a && <span aria-hidden="true">✓ </span>}
                {AXIS_LABEL[a]}
              </button>
            ))}
          </fieldset>
        )}
      </div>

      {/* 結果數變動要讓螢幕閱讀器知道（WCAG 4.1.3） */}
      <p role="status" aria-live="polite" aria-busy={isSearching} className="sr-only">
        {hasQuery
          ? `找到 ${flatResults.length} 篇符合「${deferredQ}」的文獻`
          : `顯示 ${stats.reviewCount} 篇文獻`}
      </p>

      {hasQuery ? (
        <SearchResults
          results={flatResults}
          query={deferredQ}
          total={totalUnique}
          freeOnly={freeOnly}
          suggestions={suggestions}
          jcrYear={jcrYear}
          onClear={() => setView({ q: "" })}
          onClearFree={() => setView({ free: false })}
        />
      ) : (
        <>
          <nav aria-label="分類快速導覽" className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const group = groupOf(g.key);
              return (
                <a
                  key={g.key}
                  href={`#grp-${encodeURIComponent(g.key)}`}
                  className="flex min-h-[2.25rem] items-center gap-1.5 rounded-full border border-linestrong px-3 text-sm font-medium text-body transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:text-body-dark dark:hover:bg-surface-altdark"
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full bg-[var(--dot)] dark:bg-[var(--dot-dark)]"
                    style={
                      {
                        "--dot": group.light,
                        "--dot-dark": group.dark,
                      } as React.CSSProperties
                    }
                  />
                  {g.key}
                  <span className="tabular-nums text-muted dark:text-muted-dark">
                    {g.total}
                  </span>
                </a>
              );
            })}
          </nav>

          {groups.length === 0 && (
            <div className="rounded-lg border border-line p-8 text-center text-body dark:border-line-dark dark:text-body-dark">
              目前沒有符合條件的項目
              {freeOnly && "（已篩選：只看免費全文）"}
            </div>
          )}

          {groups.map((g) => (
            <AxisSection
              key={g.key}
              group={g}
              axis={axis}
              jcrYear={jcrYear}
              open={open}
              onToggle={toggle}
            />
          ))}
        </>
      )}

      <Footer jcrYear={jcrYear} />
    </div>
  );
}

function SearchResults({
  results,
  query,
  total,
  freeOnly,
  suggestions,
  jcrYear,
  onClear,
  onClearFree,
}: {
  results: Item[];
  query: string;
  total: number;
  freeOnly: boolean;
  suggestions: string[];
  jcrYear: string;
  onClear: () => void;
  onClearFree: () => void;
}) {
  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-line p-6 dark:border-line-dark">
        <p className="text-body dark:text-body-dark">
          找不到「{query}」的文獻。
        </p>
        {suggestions.length > 0 && (
          <p className="mt-2 text-sm text-body dark:text-body-dark">
            你是不是要找：{suggestions.join(" · ")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClear}
            className="min-h-11 cursor-pointer rounded-md border border-linestrong px-4 text-sm font-medium text-body hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:text-body-dark dark:hover:bg-surface-altdark"
          >
            清除搜尋
          </button>
          {freeOnly && (
            <button
              type="button"
              onClick={onClearFree}
              className="min-h-11 cursor-pointer rounded-md border border-linestrong px-4 text-sm font-medium text-body hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:text-body-dark dark:hover:bg-surface-altdark"
            >
              取消「只看免費全文」
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="搜尋結果">
      <p className="mb-2 text-sm text-body dark:text-body-dark">
        <span className="font-semibold tabular-nums text-ink dark:text-ink-dark">
          {results.length}
        </span>{" "}
        / {total} 篇符合「{query}」{freeOnly && "（限免費全文）"} · 依年份新到舊
      </p>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface dark:divide-line-dark dark:border-line-dark dark:bg-surface-dark">
        {results.map((r) => (
          <ReviewRow key={paperKey(r)} item={r} jcrYear={jcrYear} showTaxonomy />
        ))}
      </ul>
    </section>
  );
}

function AxisSection({
  group,
  axis,
  jcrYear,
  open,
  onToggle,
}: {
  group: AxisGroup;
  axis: Axis;
  jcrYear: string;
  open: Set<string>;
  onToggle: (key: string) => void;
}) {
  const g = groupOf(group.key);
  return (
    <section id={`grp-${encodeURIComponent(group.key)}`} className="scroll-mt-4 sm:scroll-mt-40">
      <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface-alt px-3 py-2 dark:border-line-dark dark:bg-surface-altdark">
        <span
          aria-hidden="true"
          className="h-3 w-3 rounded-full bg-[var(--dot)] dark:bg-[var(--dot-dark)]"
          style={{ "--dot": g.light, "--dot-dark": g.dark } as React.CSSProperties}
        />
        <h2 className="text-base font-bold text-ink dark:text-ink-dark">
          {group.key}
        </h2>
        <span className="text-xs text-muted dark:text-muted-dark">
          {group.diseases.length} 個主題 · {group.total} 篇
        </span>
      </div>

      <ul className="space-y-1.5">
        {group.diseases.map((d) => {
          const key = `${axis}::${group.key}::${d.disease}`;
          const isOpen = open.has(key);
          const panelId = `panel-${encodeURIComponent(key)}`;
          const buttonId = `btn-${encodeURIComponent(key)}`;
          return (
            <li key={key} className="rounded-lg border border-line dark:border-line-dark">
              <h3>
                <button
                  id={buttonId}
                  type="button"
                  onClick={() => onToggle(key)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  style={{ borderLeft: `3px solid ${g.light}` }}
                >
                  <span className="font-medium text-ink dark:text-ink-dark">
                    {d.disease}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted dark:text-muted-dark">
                    {d.items.length} 篇
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
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
                  </span>
                </button>
              </h3>

              <div id={panelId} aria-labelledby={buttonId} hidden={!isOpen}>
                {isOpen && (
                  <ul className="divide-y divide-line border-t border-line dark:divide-line-dark dark:border-line-dark">
                    {d.items
                      .slice()
                      .sort(sortByIntervalThenIF)
                      .map((r) => (
                        <ReviewRow
                          key={`${r.url}::${r.title}`}
                          item={r}
                          jcrYear={jcrYear}
                        />
                      ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Footer({ jcrYear }: { jcrYear: string }) {
  return (
    <footer className="space-y-1 border-t border-line pt-4 text-xs text-muted dark:border-line-dark dark:text-muted-dark">
      <p className="font-medium text-body dark:text-body-dark">
        本索引僅供教育與研究參考，不構成診療建議。AI 摘要與分類可能有誤，引用前請回溯原始文獻與 DOI。
      </p>
      <p>
        證據類型由標題自動推導（系統性回顧／統合分析／指引／共識…），未經人工核對；
        少數文獻無法判定則不標示。
      </p>
      <p>
        免費全文為啟發式判定（依來源網域是否開放取用），非逐篇 Unpaywall 驗證。
      </p>
      <p>
        IF 為期刊影響係數<strong>近似值</strong>（Clarivate JCR {jcrYear}），
        代表期刊而非單篇文獻的證據等級，僅供參考、逐年變動。
      </p>
    </footer>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div>
      <div
        className={`font-display text-3xl font-bold tabular-nums ${accent ? "text-free dark:text-free-dark" : "text-ink dark:text-ink-dark"}`}
      >
        {n.toLocaleString("en-US")}
      </div>
      <div className="text-xs text-muted dark:text-muted-dark">{label}</div>
    </div>
  );
}
