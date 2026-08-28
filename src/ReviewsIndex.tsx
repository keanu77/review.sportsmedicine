import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import NewThisMonth from "./NewThisMonth";
import ReviewRow from "./ReviewRow";
import { toneByIndex, toneOf } from "./regionGroups";
import { matchesQuery, suggestTerms, tokenize } from "./search";
import type { Axis, Item, ReviewsData, SummariesData, TagsData } from "./types";
import { useLibrary } from "./useLibrary";
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

// 熱門檢索：都經過別名表展開，點下去就能看到中英文獻一起命中
const QUICK_SEARCHES = ["ACL", "PRP", "RTP", "腦震盪", "冰凍肩", "肌少症"];

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
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<TagsData["tags"]>({});
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useUrlState();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showStarred, setShowStarred] = useState(false);
  const { stars, recent, toggleStar, markRead, clearRecent } = useLibrary();
  const searchRef = useRef<HTMLInputElement>(null);
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
    // 兩份資料平行取，摘要疊加層缺漏或損毀不影響主索引。
    fetch(`${import.meta.env.BASE_URL}data/reviews-index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ReviewsData) => setData(d))
      .catch((e) => setErr(String(e.message || e)));

    fetch(`${import.meta.env.BASE_URL}data/summaries.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SummariesData | null) => {
        if (d && d.summaries) setSummaries(d.summaries);
      })
      .catch(() => {
        /* 摘要是加值資訊，載入失敗就沿用資料本身的 tldr */
      });

    fetch(`${import.meta.env.BASE_URL}data/tags.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: TagsData | null) => {
        if (d && d.tags) setTags(d.tags);
      })
      .catch(() => {
        /* 標籤是加值資訊，載入失敗就沿用資料本身的分類 */
      });
  }, []);

  useEffect(() => setOpen(new Set()), [axis]);

  // 鍵盤捷徑：/ 或 ⌘K 聚焦搜尋、Esc 清除。PubMed 重度使用者的肌肉記憶。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Escape" && typing) {
        setView({ q: "" });
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView]);

  // 疊加層優先於資料自帶的 tldr——後者多數只複述標題、讀不出結論。
  // 在過濾之前合併，搜尋才吃得到新摘要與新標籤的內容。
  //
  // 標籤採**聯集**：上游既有的標籤改名為新 label 後保留，再加上分類器確認的。
  // 不用分類器結果取代上游——對檢索工具而言漏掉一篇相關文獻，比多收一篇無關的嚴重。
  const merged: Item[] = useMemo(() => {
    if (!data) return [];
    const hasSummaries = Object.keys(summaries).length > 0;
    const tagList = Object.values(tags);
    if (!hasSummaries && !tagList.length) return data.items;

    return data.items.map((item) => {
      const key = paperKey(item);
      const summary = summaries[key];
      let next = summary ? { ...item, tldr: summary, tldrSource: "local-llm" } : item;

      for (const tag of tagList) {
        const absorbs = tag.absorbs ?? [];
        const current = next[tag.axis] ?? [];
        const renamed = current.map((v) => (absorbs.includes(v) ? tag.label : v));
        const shouldAdd = tag.keys.includes(key) && !renamed.includes(tag.label);
        if (shouldAdd || renamed.some((v, i) => v !== current[i])) {
          const values = shouldAdd ? [...renamed, tag.label] : renamed;
          next = { ...next, [tag.axis]: [...new Set(values)] };
        }
      }
      return next;
    });
  }, [data, summaries, tags]);

  const starSet = useMemo(() => new Set(stars), [stars]);

  const filtered: Item[] = useMemo(
    () =>
      merged.filter((it) => {
        if (freeOnly && !it.free) return false;
        if (showStarred && !starSet.has(paperKey(it))) return false;
        return matchesQuery(it, tokens);
      }),
    [merged, tokens, freeOnly, showStarred, starSet],
  );

  // 最近瀏覽：以唯一文獻為單位，保持點擊當下的順序
  const recentItems = useMemo(() => {
    if (!recent.length) return [];
    const byKey = new Map(uniqueItems(merged).map((i) => [paperKey(i), i]));
    return recent.map((k) => byKey.get(k)).filter((i): i is Item => Boolean(i)).slice(0, 5);
  }, [recent, merged]);

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

    // 部位軸是解剖順序（肩→肘→腕…），必須沿用上游的排列；
    // 主題與族群軸上游本來就是依篇數遞減，新標籤沒有上游位置，
    // 直接用實際篇數排才不會讓 78 篇的分類落在 2 篇的「軍事人員」後面。
    const order = data.axes[axis].map((a) => a.key);
    const byUpstreamOrder = axis === "region";

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

    // 缺值桶（未分類主題／未標族群）一律排最後
    const rank = (k: string) => {
      if (k.startsWith("未")) return 1e12;
      const i = order.indexOf(k);
      return i === -1 ? 1e9 : i;
    };
    result.sort((a, b) => {
      const unlabelled = rank(a.key) >= 1e12 || rank(b.key) >= 1e12;
      if (unlabelled) return rank(a.key) - rank(b.key) || b.total - a.total;
      return byUpstreamOrder
        ? rank(a.key) - rank(b.key) || b.total - a.total
        : b.total - a.total;
    });
    return result;
  }, [data, axis, filtered, hasQuery, tags]);

  // 統計一律以唯一文獻計數。切換分類軸不該改變「有幾篇文獻」這件事。
  const stats = useMemo(() => {
    const unique = uniqueItems(filtered);
    return {
      groupCount: hasQuery ? 0 : groups.length,
      reviewCount: unique.length,
      freeCount: unique.filter((i) => i.free).length,
    };
  }, [filtered, groups, hasQuery]);

  const totalUnique = useMemo(() => uniqueItems(merged).length, [merged]);

  const suggestions = useMemo(
    () =>
      data && hasQuery && flatResults.length === 0
        ? suggestTerms(merged, deferredQ)
        : [],
    [merged, hasQuery, flatResults.length, deferredQ],
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
      {/* Hero：品牌漸層底 + 右上光暈，資訊由上而下是「這是什麼 → 規模 → 直接開始找」 */}
      <header className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-wash-from via-surface to-wash-to p-6 dark:border-line-dark dark:from-surface-dark dark:via-surface-dark dark:to-surface-altdark sm:p-8 print:rounded-none print:border-0 print:bg-none print:p-0">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-wash-edge opacity-70 blur-3xl dark:bg-brand/20 print:hidden"
        />
        <div className="relative">
          <p className="text-xs font-semibold tracking-[0.18em] text-brand dark:text-brand-dark">
            SPORTS MEDICINE · REVIEW INDEX
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink dark:text-ink-dark sm:text-5xl">
            運動醫學 Review 索引
          </h1>
          <p className="mt-1 text-base font-medium text-brand dark:text-brand-dark">
            系統性回顧 · 統合分析 · 臨床指引
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-body dark:text-body-dark">
            從知識庫的運動醫學／復健文獻，加上 PubMed
            權威期刊（BJSM、AJSM、JOSPT、KSSTA、Cochrane…）的近年綜述，
            可依<span className="font-semibold">部位、臨床主題、族群</span>瀏覽。
          </p>

          {/* 數據帶：分格呈現，與說明文字明確分層 */}
          <dl className="mt-6 grid max-w-xl grid-cols-3 overflow-hidden rounded-xl border border-line bg-surface/80 dark:border-line-dark dark:bg-surface-dark/60">
            <StatCell n={stats.reviewCount} label={hasQuery ? "篇符合" : "篇文獻"} />
            <StatCell n={stats.freeCount} label="免費全文" accent />
            <StatCell
              n={hasQuery ? flatResults.length : stats.groupCount}
              label={hasQuery ? "篇結果" : AXIS_LABEL[axis].replace("依", "") + "分類"}
              last
            />
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 print:hidden">
            <span className="text-xs font-medium text-muted dark:text-muted-dark">
              熱門檢索
            </span>
            {QUICK_SEARCHES.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => setView({ q: term })}
                className="cursor-pointer rounded-full border border-brand/30 bg-surface/70 px-3 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-brand-dark/40 dark:bg-surface-dark/50 dark:text-brand-dark dark:hover:bg-brand-dark dark:hover:text-ink"
              >
                {term}
              </button>
            ))}
            {data.meta.updated && (
              <span className="ml-auto text-xs text-muted dark:text-muted-dark">
                更新：{data.meta.updated}
              </span>
            )}
          </div>
        </div>
      </header>

      <NewThisMonth jcrYear={jcrYear} />

      {/* Toolbar：行動裝置不 sticky，避免動態高度的工具列遮住錨點目標 */}
      <div className="z-10 space-y-3 rounded-lg border border-line bg-surface/95 p-3 backdrop-blur dark:border-line-dark dark:bg-surface-dark/95 sm:sticky sm:top-0 print:hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor={searchId}
              className="mb-1 block text-xs font-medium text-body dark:text-body-dark"
            >
              搜尋文獻
              <kbd className="ml-2 hidden rounded border border-line px-1 font-sans text-[10px] font-normal text-muted dark:border-line-dark dark:text-muted-dark sm:inline">
                /
              </kbd>
            </label>
            <input
              id={searchId}
              ref={searchRef}
              type="search"
              value={view.q}
              onChange={(e) => setView({ q: e.target.value })}
              placeholder="病名、縮寫或期刊，例：ACL、PRP、RTP、冰凍肩、BJSM"
              className="min-h-11 w-full rounded-md border border-linestrong bg-surface px-3 text-sm text-ink placeholder:text-muted focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:bg-surface-altdark dark:text-ink-dark dark:placeholder:text-muted-dark dark:focus-visible:ring-brand-dark"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-body dark:text-body-dark">
              <input
                type="checkbox"
                checked={freeOnly}
                onChange={(e) => setView({ free: e.target.checked })}
                className="h-5 w-5 rounded accent-brand-strong"
              />
              只顯示免費全文
            </label>
            {stars.length > 0 && (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-body dark:text-body-dark">
                <input
                  type="checkbox"
                  checked={showStarred}
                  onChange={(e) => setShowStarred(e.target.checked)}
                  className="h-5 w-5 rounded accent-brand-strong"
                />
                只看收藏（{stars.length}）
              </label>
            )}
          </div>
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
          starSet={starSet}
          onToggleStar={toggleStar}
          onOpen={markRead}
          onClear={() => setView({ q: "" })}
          onClearFree={() => setView({ free: false })}
        />
      ) : (
        <>
          {recentItems.length > 0 && (
            <section
              aria-label="最近瀏覽"
              className="rounded-lg border border-line bg-surface px-3 py-2 dark:border-line-dark dark:bg-surface-dark print:hidden"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-muted dark:text-muted-dark">
                  最近瀏覽
                </h2>
                <button
                  type="button"
                  onClick={clearRecent}
                  className="cursor-pointer rounded px-2 py-1 text-xs text-muted hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-muted-dark dark:hover:text-brand-dark"
                >
                  清除
                </button>
              </div>
              <ul className="mt-1 space-y-1">
                {recentItems.map((r) => (
                  <li key={paperKey(r)} className="text-sm">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate py-1.5 text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-brand-dark"
                    >
                      <span lang="en">{r.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <nav aria-label="分類快速導覽" className="flex flex-wrap gap-2 print:hidden">
            {groups.map((g, i) => {
              // 部位軸的顏色代表解剖大類；其餘兩軸沒有對應，顏色純為裝飾（見 regionGroups.ts）
              const tone =
                axis === "region" ? toneOf(g.key) : toneByIndex(i);
              return (
                <a
                  key={g.key}
                  href={`#grp-${encodeURIComponent(g.key)}`}
                  className="flex min-h-[2.25rem] items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  style={
                    {
                      background: tone.light.bg,
                      borderColor: tone.light.border,
                      color: tone.light.text,
                      "--dot": tone.light.dot,
                    } as React.CSSProperties
                  }
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full bg-[var(--dot)]"
                  />
                  {g.key}
                  <span className="tabular-nums opacity-70">{g.total}</span>
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

          {groups.map((g, i) => (
            <AxisSection
              key={g.key}
              group={g}
              index={i}
              axis={axis}
              jcrYear={jcrYear}
              open={open}
              onToggle={toggle}
              starSet={starSet}
              onToggleStar={toggleStar}
              onOpen={markRead}
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
  starSet,
  onToggleStar,
  onOpen,
  onClear,
  onClearFree,
}: {
  results: Item[];
  query: string;
  total: number;
  freeOnly: boolean;
  suggestions: string[];
  jcrYear: string;
  starSet: Set<string>;
  onToggleStar: (key: string) => void;
  onOpen: (key: string) => void;
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
          <ReviewRow
            key={paperKey(r)}
            item={r}
            jcrYear={jcrYear}
            showTaxonomy
            starred={starSet.has(paperKey(r))}
            onToggleStar={() => onToggleStar(paperKey(r))}
            onOpen={() => onOpen(paperKey(r))}
          />
        ))}
      </ul>
    </section>
  );
}

function AxisSection({
  group,
  index,
  axis,
  jcrYear,
  open,
  onToggle,
  starSet,
  onToggleStar,
  onOpen,
}: {
  group: AxisGroup;
  index: number;
  axis: Axis;
  jcrYear: string;
  open: Set<string>;
  onToggle: (key: string) => void;
  starSet: Set<string>;
  onToggleStar: (key: string) => void;
  onOpen: (key: string) => void;
}) {
  const tone = axis === "region" ? toneOf(group.key) : toneByIndex(index);
  return (
    <section id={`grp-${encodeURIComponent(group.key)}`} className="scroll-mt-4 sm:scroll-mt-40">
      <div
        className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2"
        style={{
          background: tone.light.bg,
          borderColor: tone.light.border,
        }}
      >
        <span
          aria-hidden="true"
          className="h-3 w-3 rounded-full"
          style={{ background: tone.light.dot }}
        />
        <h2 className="text-base font-bold" style={{ color: tone.light.text }}>
          {group.key}
        </h2>
        <span className="text-xs opacity-80" style={{ color: tone.light.text }}>
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
                  style={{ borderLeft: `3px solid ${tone.light.dot}` }}
                >
                  <span className="font-medium text-ink dark:text-ink-dark">
                    {d.disease}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted dark:text-muted-dark">
                    {d.items.length} 篇
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-4 w-4 transition-transform print:hidden ${isOpen ? "rotate-90" : ""}`}
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
                          starred={starSet.has(paperKey(r))}
                          onToggleStar={() => onToggleStar(paperKey(r))}
                          onOpen={() => onOpen(paperKey(r))}
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
        少數文獻無法判定則不標示。標示「AI 摘要」者，該句由本機語言模型自 PubMed
        摘要原文濃縮而成，同樣未經人工核對，臨床判讀請以原始文獻為準。
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

function StatCell({
  n,
  label,
  accent,
  last,
}: {
  n: number;
  label: string;
  accent?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`px-4 py-3 ${last ? "" : "border-r border-line dark:border-line-dark"}`}
    >
      <dt className="sr-only">{label}</dt>
      <dd>
        <span
          className={`block font-display text-3xl font-bold tabular-nums ${accent ? "text-free dark:text-free-dark" : "text-ink dark:text-ink-dark"}`}
        >
          {n.toLocaleString("en-US")}
        </span>
        <span className="text-xs text-muted dark:text-muted-dark">{label}</span>
      </dd>
    </div>
  );
}
