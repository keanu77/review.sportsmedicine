import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { createBibliographyIndex, enrichItems } from "./enrich";
import { canonicalPaperId, paperAliases, uniquePapers } from "./identity";
import PaperDetails from "./PaperDetails";
import LibraryPanel from "./LibraryPanel";
import FacetFilters from "./FacetFilters";
import Topics, { TOPICS, TopicLinks } from "./Topics";
import DataHealth from "./DataHealth";
import { EMPTY_FACETS, FACETS, FACET_LABELS, matchesFacets } from "./facets";
import { paperLink, paperSlug, paperSlugFromPath, safeIndexReturn } from "./paperRoutes";
import { studyTypeOf } from "./studyType";
import NewThisMonth from "./NewThisMonth";
import ReviewRow from "./ReviewRow";
import { toneByIndex, toneOf, toneVars } from "./regionGroups";
import { matchesQuery, rankResults, searchSortLabel, suggestTerms, tokenize, type SearchSort } from "./search";
import type { Axis, BibliographyData, BibliographyEntry, Item, ReviewsData, SummariesData, TagsData } from "./types";
import { useLibrary } from "./useLibrary";
import { useUrlState } from "./useUrlState";
import { matchesPublicationWindow, parsePublicationPeriod, PUBLICATION_PERIODS, publicationWindow } from "./publicationDate";

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

// 上游同一篇文獻會以兩種方式重複出現：依多個疾病重複列出（分組瀏覽時刻意如此），
// 以及同一篇同時收錄 DOI 版與出版社版網址（41 組）。統計與平坦列表都必須以
// 「唯一文獻」為單位，否則切換分類軸時首頁數字會從 911 跳到 1,291。
//
// 去重鍵用正規化標題而非網址——網址才是會分裂的那個欄位。
const uniqueItems = uniquePapers;

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
  const [initialPaper] = useState<Item | undefined>(() => {
    try { return JSON.parse(document.getElementById("paper-data")?.textContent || "null") || undefined; } catch { return undefined; }
  });
  const [data, setData] = useState<ReviewsData | null>(initialPaper ? { meta: { updated: "", total: 1, freeCount: initialPaper.free ? 1 : 0 }, axes: { region: [], theme: [], population: [] }, items: [initialPaper] } : null);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<TagsData["tags"]>({});
  const [bibliography, setBibliography] = useState<BibliographyEntry[]>(initialPaper?.bibliography ? [initialPaper.bibliography] : []);
  const bibliographyIndex = useMemo(() => createBibliographyIndex(bibliography), [bibliography]);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useUrlState();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showStarred, setShowStarred] = useState(false);
  const [paperHash, setPaperHash] = useState(() => window.location.hash);
  useEffect(() => {
    const sync = () => setPaperHash(window.location.hash);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const advancedId = useId();
  const [advancedFilters, setAdvancedFilters] = useState(false);

  const axis = (["region", "theme", "population"] as const).includes(
    view.axis as Axis,
  )
    ? (view.axis as Axis)
    : "region";
  const freeOnly = view.free;
  const dateWindow = publicationWindow(view.period);
  const dateFrom = dateWindow?.from, dateTo = dateWindow?.to;

  // 本地過濾工作量不小（911 筆 × 多欄位），用 useDeferredValue 讓輸入保持即時回應。
  const deferredQ = useDeferredValue(view.q);
  const isSearching = view.q !== deferredQ;
  const tokens = useMemo(() => tokenize(deferredQ), [deferredQ]);
  const hasQuery = tokens.length > 0 || FACETS.some(key => view[key]) || Boolean(view.year || view.type || view.period || view.free || showStarred);

  useEffect(() => {
    if (initialPaper) return;
    fetch(`${import.meta.env.BASE_URL}data/bibliography-index.json`)
      .then(response => response.ok && response.headers.get("content-type")?.includes("json") ? response : fetch(`${import.meta.env.BASE_URL}data/bibliography.json`))
      .then(response => response.ok ? response.json() : null)
      .then((data: BibliographyData | null) => {
        if (data?.version === 1 && Array.isArray(data.records)) setBibliography(data.records);
      })
      .catch(() => { /* Bibliography is optional; source index remains readable. */ });
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
    return enrichItems(data.items, summaries, tags, bibliographyIndex);
  }, [data, summaries, tags, bibliographyIndex]);

  const library = useLibrary(merged);
  const { stars, recent, toggleStar, markRead, clearRecent } = library;
  const markOpened = (key: string) => markRead(key, merged.find(item => paperAliases(item).includes(key)));
  const currentSlug = paperSlugFromPath(window.location.pathname);
  let selectedId = paperHash.startsWith("#paper=") ? paperHash.slice(7) : "";
  try { selectedId = decodeURIComponent(selectedId); } catch { /* Invalid legacy link. */ }
  const savedItems = library.entries.flatMap(entry => entry.snapshot ? [entry.snapshot] : []);
  const selectedPaper = currentSlug ? [...merged, ...savedItems].find(item => paperSlug(item) === currentSlug) : selectedId ? uniqueItems([...merged, ...savedItems]).find(item => paperAliases(item).includes(selectedId)) : undefined;
  useEffect(() => {
    if (!currentSlug || selectedPaper || !data) return;
    document.title = "找不到文獻｜運動醫學 Review 索引";
    const robots = document.createElement("meta"); robots.name = "robots"; robots.content = "noindex";
    document.head.appendChild(robots);
    return () => robots.remove();
  }, [currentSlug, selectedPaper, data]);

  const starSet = useMemo(() => {
    const saved = new Set(stars);
    const expanded = new Set<string>();
    for (const item of merged) {
      const aliases = paperAliases(item);
      if (aliases.some(alias => saved.has(alias))) expanded.add(canonicalPaperId(item));
    }
    return expanded;
  }, [stars, merged]);
  const togglePaper = (key: string) => {
    const candidates = [...merged, ...savedItems];
    const item = candidates.find(candidate => canonicalPaperId(candidate) === key) ?? candidates.find(candidate => paperAliases(candidate).includes(key));
    toggleStar(item ? canonicalPaperId(item) : key, item ? paperAliases(item) : [key], item);
  };

  const beforeFacets: Item[] = useMemo(
    () =>
      merged.filter((it) => {
        if (!matchesPublicationWindow(it.firstPublicationDate, dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null)) return false;
        if (view.year && String(it.year) !== view.year) return false;
        if (view.type && studyTypeOf(it.title) !== view.type) return false;
        if (freeOnly && !it.free) return false;
        if (showStarred && !starSet.has(canonicalPaperId(it))) return false;
        return matchesQuery(it, tokens);
      }),
    [merged, tokens, freeOnly, showStarred, starSet, view.year, view.type, dateFrom, dateTo],
  );

  const filtered = useMemo(() => beforeFacets.filter(item => matchesFacets(item, view)), [beforeFacets, view.region, view.disease, view.theme, view.population]);

  // 最近瀏覽：以唯一文獻為單位，保持點擊當下的順序
  const recentItems = useMemo(() => {
    if (!recent.length) return [];
    const byKey = new Map(uniqueItems(merged).flatMap(item => paperAliases(item).map(alias => [alias, item] as const)));
    return recent.map((k) => byKey.get(k)).filter((i): i is Item => Boolean(i)).slice(0, 5);
  }, [recent, merged]);

  /** 搜尋模式的平坦結果，已去重。 */
  const flatResults = useMemo(
    () => (hasQuery ? rankResults(uniqueItems(filtered), tokens, view.sort) : []),
    [filtered, hasQuery, tokens, view.sort],
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
          請重新整理頁面，或稍後再試。<button type="button" className="ml-2 min-h-11 underline" onClick={() => window.location.reload()}>重新載入</button>
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
  if (currentSlug || selectedId) {
    return <PaperDetails item={selectedPaper} returnHref={currentSlug ? safeIndexReturn(window.location.search) : "#"} starred={selectedPaper ? stars.includes(canonicalPaperId(selectedPaper)) || starSet.has(canonicalPaperId(selectedPaper)) : false} onToggleStar={selectedPaper ? () => togglePaper(canonicalPaperId(selectedPaper)) : undefined} readStatus={selectedPaper ? library.getReadStatus(canonicalPaperId(selectedPaper), paperAliases(selectedPaper)) : "pending"} onReadStatus={selectedPaper ? status => library.setReadStatus(canonicalPaperId(selectedPaper), status, selectedPaper) : undefined} />;
  }

  const topic = TOPICS.find(entry => window.location.pathname.replace(/\/$/, "") === `/topics/${entry.slug}`);
  if (topic) {
    const topicTokens = tokenize(topic.query);
    const matches = rankResults(uniqueItems(merged).filter(item => matchesQuery(item, topicTokens)), topicTokens, "relevance");
    return <Topics data={{ ...topic, items: matches.slice(0, 12), total: matches.length, updated: data.meta.updated }} />;
  }

  return (
    <div className="space-y-5">
      <header className="border-b border-line py-4 dark:border-line-dark sm:py-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {!hasQuery && <p className="text-xs font-semibold tracking-[0.16em] text-brand dark:text-brand-dark">SPORTS MEDICINE · EVIDENCE LIBRARY</p>}
            <h1 className={`font-display font-bold tracking-tight text-ink dark:text-ink-dark ${hasQuery ? "text-2xl" : "mt-2 text-3xl sm:text-4xl"}`}>運動醫學 Review 索引</h1>
            {!hasQuery && <p className="mt-2 text-sm text-body dark:text-body-dark">從臨床問題出發，查找系統性回顧、統合分析與臨床指引。</p>}
          </div>
          <dl className="flex items-center gap-4 text-xs text-muted dark:text-muted-dark">
            <div><dt>收錄文獻</dt><dd><span className="font-display text-2xl font-semibold text-ink dark:text-ink-dark">{totalUnique}</span> 篇</dd></div>
            <div><dt>索引更新</dt><dd className="mt-1">{data.meta.updated || "日期未提供"}</dd></div>
          </dl>
        </div>
      </header>

      {/* Toolbar：行動裝置不 sticky，避免動態高度的工具列遮住錨點目標 */}
      <div className="space-y-4 rounded-lg border border-line bg-surface p-4 dark:border-line-dark dark:bg-surface-dark print:hidden">
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
              placeholder="病名、作者、期刊、DOI／PMID／PMCID 或文獻網址"
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
            {(stars.length > 0 || showStarred) && (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-body dark:text-body-dark">
                <input
                  type="checkbox"
                  checked={showStarred}
                  onChange={(e) => { setShowStarred(e.target.checked); setView({ page: 1 }); }}
                  className="h-5 w-5 rounded accent-brand-strong"
                />
                只看收藏（{stars.length}）
              </label>
            )}
          </div>
        </div>

        {!view.q && <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-muted dark:text-muted-dark">常用檢索</span>{QUICK_SEARCHES.map(term => <button key={term} type="button" onClick={() => setView({ q: term })} className="min-h-9 rounded border border-line px-3 text-brand hover:bg-surface-alt dark:border-line-dark dark:text-brand-dark dark:hover:bg-surface-altdark">{term}</button>)}</div>}
        <button type="button" aria-expanded={advancedFilters} aria-controls={advancedId} onClick={() => setAdvancedFilters(value => !value)} className="min-h-11 w-full text-left text-sm font-medium text-brand sm:hidden dark:text-brand-dark">篩選與排序 {advancedFilters ? "−" : "+"}</button>
        <div id={advancedId} className={advancedFilters ? "space-y-4" : "hidden space-y-4 sm:block"}>
        <FacetFilters items={beforeFacets} value={view} onChange={(key, value) => setView({ [key]: value, ...(key === "region" ? { disease: "" } : {}) })} />
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          {hasQuery && <label className="flex min-w-0 flex-col items-stretch gap-1 text-xs sm:flex-row sm:items-center sm:gap-2">排序
            <select aria-label="搜尋結果排序" value={view.sort} onChange={event => setView({ sort: event.target.value === "latest" ? "latest" : "relevance" })} className="min-h-11 min-w-0 flex-1 rounded border border-linestrong bg-surface px-2 text-sm dark:bg-surface-altdark dark:border-linestrong-dark">
              <option value="relevance">相關度</option><option value="latest">最新年份</option>
            </select>
          </label>}
          <label className="flex min-w-0 flex-col items-stretch gap-1 text-xs sm:flex-row sm:items-center sm:gap-2">發表時間
            <select aria-label="發表時間" value={view.period} onChange={event => setView({ period: parsePublicationPeriod(event.target.value) })} className="min-h-11 min-w-0 flex-1 rounded border border-linestrong bg-surface px-2 text-sm dark:bg-surface-altdark dark:border-linestrong-dark">
              {PUBLICATION_PERIODS.map(period => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col items-stretch gap-1 text-xs sm:flex-row sm:items-center sm:gap-2">年份
            <select aria-label="年份" value={view.year} onChange={e => setView({ year: e.target.value })} className="min-h-11 min-w-0 flex-1 rounded border border-linestrong bg-surface px-2 text-sm dark:bg-surface-altdark dark:border-linestrong-dark">
              <option value="">所有年份</option>
              {[...new Set(merged.flatMap(item => item.year ? [item.year] : []))].sort((a, b) => b - a).map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col items-stretch gap-1 text-xs sm:flex-row sm:items-center sm:gap-2">文體
            <select aria-label="文體（由標題推測）" value={view.type} onChange={e => setView({ type: e.target.value })} className="min-h-11 min-w-0 flex-1 rounded border border-linestrong bg-surface px-2 text-sm dark:bg-surface-altdark dark:border-linestrong-dark">
              <option value="">所有文體</option>
              {["系統性回顧", "統合分析", "傘狀回顧", "範疇回顧", "敘述性回顧", "指引", "共識"].map(type => <option key={type}>{type}</option>)}
            </select>
          </label>
          {(view.period || view.year || view.type) && <button type="button" className="min-h-11 rounded px-2 text-sm text-brand dark:text-brand-dark" onClick={() => setView({ period: "", year: "", type: "" })}>清除時間、年份與文體</button>}
        </div>
        </div>
        {FACETS.some(key => view[key]) && <div className="flex flex-wrap gap-2" aria-label="已選篩選條件">{FACETS.filter(key => view[key]).map(key => <button key={`${key}:${view[key]}`} type="button" onClick={() => setView({ [key]: "" })} className="motion-feedback min-h-9 rounded-full border border-line bg-surface-alt px-3 text-xs text-brand dark:border-line-dark dark:bg-surface-altdark dark:text-brand-dark" aria-label={`移除${FACET_LABELS[key]}篩選：${view[key]}`}>{view[key]} ×</button>)}</div>}
        {(FACETS.some(key => view[key]) || freeOnly || view.year || view.period || view.type || showStarred) && <button type="button" className="min-h-9 text-xs text-brand underline dark:text-brand-dark" onClick={() => { setView({ ...EMPTY_FACETS, free: false, year: "", type: "", period: "" }); setShowStarred(false); }}>清除所有篩選</button>}
        {dateWindow && <p className="text-xs text-muted dark:text-muted-dark" role="status">
          {PUBLICATION_PERIODS.find(period => period.value === view.period)?.label}：{dateWindow.from} 至 {dateWindow.to}（含當日）。依 Europe PMC 首次發表日期篩選，部分日期由來源推定；未提供日期的文獻不納入。
        </p>}
        {showStarred && stars.length === 0 && <p role="status" className="text-sm">收藏清單已清空。取消「只看收藏」即可繼續瀏覽。</p>}

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

      {!hasQuery && <NewThisMonth catalog={data.items} jcrYear={jcrYear} summaries={summaries} tags={tags} bibliography={bibliographyIndex} starSet={starSet} onToggleStar={togglePaper} onOpen={markOpened} />}
      <details className="rounded-lg border border-line p-3 dark:border-line-dark"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">我的文獻庫（{stars.length} 篇） · 閱讀狀態與備份</summary>
      <LibraryPanel library={library} onOpen={item => { markRead(canonicalPaperId(item), item); const live = merged.find(candidate => canonicalPaperId(candidate) === canonicalPaperId(item)); window.location.assign(live ? paperLink(live) : `#paper=${encodeURIComponent(canonicalPaperId(item))}`); }} />
      </details>
      {library.storageMessage && <p role="alert" className="text-sm">{library.storageMessage}</p>}
      {!hasQuery && <DataHealth />}
      {!hasQuery && <TopicLinks />}

      {/* 結果數變動要讓螢幕閱讀器知道（WCAG 4.1.3） */}
      <p role="status" aria-live="polite" aria-busy={isSearching} className="sr-only">
        {hasQuery
          ? `找到 ${flatResults.length} 篇符合「${deferredQ}」的文獻`
          : `顯示 ${stats.reviewCount} 篇文獻`}
      </p>

      {hasQuery ? (
        <SearchResults
          results={flatResults}
          page={view.page}
          onPageChange={page => setView({ page })}
          sort={view.sort}
          query={deferredQ}
          total={totalUnique}
          freeOnly={freeOnly}
          suggestions={suggestions}
          jcrYear={jcrYear}
          starSet={starSet}
          onToggleStar={togglePaper}
          onOpen={markOpened}
          onClear={() => setView({ q: "" })}
          onSuggestion={query => setView({ q: query })}
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
                  <li key={canonicalPaperId(r)} className="text-sm">
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
                  className="tone-surface flex min-h-[2.25rem] items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  style={toneVars(tone) as React.CSSProperties}
                >
                  <span
                    aria-hidden="true"
                    className="tone-dot h-2.5 w-2.5 rounded-full"
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
              onToggleStar={togglePaper}
              onOpen={markOpened}
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
  page,
  onPageChange,
  sort,
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
  onSuggestion,
}: {
  results: Item[];
  page: number;
  onPageChange: (page: number) => void;
  sort: SearchSort;
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
  onSuggestion: (query: string) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const focusAfterPage = useRef(false);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = Math.min(pageCount, Math.max(1, page));
  const start = (currentPage - 1) * pageSize;
  const changePage = (next: number) => { focusAfterPage.current = true; onPageChange(next); };
  useEffect(() => {
    if (focusAfterPage.current) {
      focusAfterPage.current = false;
      sectionRef.current?.focus();
      sectionRef.current?.scrollIntoView({ block: 'start' });
    }
  }, [currentPage]);
  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-line p-6 dark:border-line-dark">
        <p className="text-body dark:text-body-dark">
          {query ? `找不到「${query}」的文獻。` : "目前沒有符合篩選條件的文獻。"}
        </p>
        {suggestions.length > 0 && (
          <p className="mt-2 text-sm text-body dark:text-body-dark">
            你是不是要找：{suggestions.map(term => <button key={term} type="button" className="mr-2 min-h-11 text-brand underline dark:text-brand-dark" onClick={() => onSuggestion(term.replace(/（\d+）$/, ""))}>{term}</button>)}
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
    <section aria-label="搜尋結果" ref={sectionRef} tabIndex={-1} className="focus:outline-none">
      <p className="mb-2 text-sm text-body dark:text-body-dark">
        <span className="font-semibold tabular-nums text-ink dark:text-ink-dark">
          {results.length}
        </span>{" "}
        / {total} 篇符合「{query || "目前篩選"}」{freeOnly && "（限免費全文）"} · {searchSortLabel(sort)}
      </p>
      <p role="status" className="mb-2 text-xs text-muted dark:text-muted-dark">第 {currentPage} / {pageCount} 頁 · 顯示第 {start + 1}–{Math.min(start + pageSize, results.length)} 篇</p>
      {pageCount > 1 && <SearchPagination page={currentPage} count={pageCount} position="上方" onChange={changePage} />}
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface dark:divide-line-dark dark:border-line-dark dark:bg-surface-dark">
        {results.slice(start, start + pageSize).map((r) => (
          <ReviewRow
            key={canonicalPaperId(r)}
            item={r}
            jcrYear={jcrYear}
            showTaxonomy
            starred={starSet.has(canonicalPaperId(r))}
            onToggleStar={() => onToggleStar(canonicalPaperId(r))}
            onOpen={() => onOpen(canonicalPaperId(r))}
          />
        ))}
      </ul>
      {pageCount > 1 && <SearchPagination page={currentPage} count={pageCount} position="下方" onChange={changePage} />}
    </section>
  );
}

function SearchPagination({ page, count, position, onChange }: { page: number; count: number; position: string; onChange: (page: number) => void }) {
  const style = 'min-h-11 rounded border border-linestrong px-4 text-sm text-body disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:border-linestrong-dark dark:text-body-dark';
  return <nav aria-label={`搜尋結果分頁（${position}）`} className="my-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
    <button type="button" className={style} disabled={page === 1} onClick={() => onChange(page - 1)}>上一頁</button>
    <span className="text-sm tabular-nums text-body dark:text-body-dark">{page} / {count}</span>
    <button type="button" className={style} disabled={page === count} onClick={() => onChange(page + 1)}>下一頁</button>
  </nav>;
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
    <section id={`grp-${encodeURIComponent(group.key)}`} className="scroll-mt-4 sm:scroll-mt-40" style={toneVars(tone) as React.CSSProperties}>
      <div className="tone-surface mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2">
        <span aria-hidden="true" className="tone-dot h-3 w-3 rounded-full" />
        <h2 className="tone-text text-base font-bold">
          {group.key}
        </h2>
        <span className="tone-text text-xs opacity-80">
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
                  className="tone-edge flex min-h-11 w-full cursor-pointer items-center justify-between px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
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
                          starred={starSet.has(canonicalPaperId(r))}
                          onToggleStar={() => onToggleStar(canonicalPaperId(r))}
                          onOpen={() => onOpen(canonicalPaperId(r))}
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
        文體由標題自動推導（系統性回顧／統合分析／指引／共識…），未經人工核對；
        文體不等同證據品質；少數文獻無法判定則不標示。標示「AI 摘要」者，該句由本機語言模型自 PubMed
        摘要原文濃縮而成，同樣未經人工核對，臨床判讀請以原始文獻為準。
      </p>
      <p>
        免費全文區分來源已列出的開放連結與上游推測；來源查核日期見文獻詳情。可免費閱讀不代表可重製，授權以原始來源為準。
      </p>
      <p>
        IF 為期刊影響係數<strong>近似值</strong>（Clarivate JCR {jcrYear}），
        代表期刊而非單篇文獻的證據等級，僅供參考、逐年變動。
      </p>
    </footer>
  );
}
