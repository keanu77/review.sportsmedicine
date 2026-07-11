import { useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// 運動醫學 Review 索引（獨立公開頁）
// 資料：public/data/reviews-index.json（RSS monorepo 的 scripts/reviews-index-* 產生後同步過來）
// 三種分類軸：依部位 / 依臨床主題 / 依族群。前端動態依所選軸分組 → 疾病 → review 卡。
// ---------------------------------------------------------------------------

type Axis = "region" | "theme" | "population";

interface Item {
  title: string;
  year: number | null;
  url: string;
  source: string;
  tldr: string | null;
  free: boolean;
  freeUrl?: string | null;
  journal?: string | null;
  pmid?: string | null;
  impactFactor?: number | null;
  origin?: "kb" | "pubmed";
  region: string;
  disease: string;
  themes: string[];
  populations: string[];
}
interface AxisKey {
  key: string;
  count: number;
}
interface ReviewsData {
  meta: {
    updated: string;
    total: number;
    freeCount: number;
    ifJcrYear?: string;
    note?: string;
  };
  axes: { region: AxisKey[]; theme: AxisKey[]; population: AxisKey[] };
  items: Item[];
}

const AXIS_LABEL: Record<Axis, string> = {
  region: "依部位",
  theme: "依臨床主題",
  population: "依族群",
};

// 決定某個 item 在指定軸下歸屬的分類鍵（region 單值、theme/population 多值）
function keysForAxis(item: Item, axis: Axis): string[] {
  if (axis === "region") return [item.region];
  if (axis === "theme") return item.themes;
  return item.populations;
}

// 綜合排序：以「近的區間優先」，同區間內 IF 高者優先，再依年份新到舊。
// 每 5 年為一區間（相對當前年份）；無年份者排到最後、無 IF 視為最低。
const INTERVAL = 5;
const ANCHOR_YEAR = new Date().getFullYear();
function intervalBucket(year: number | null | undefined): number {
  if (year == null) return 1e9;
  return Math.floor((ANCHOR_YEAR - year) / INTERVAL);
}
function sortByIntervalThenIF(a: Item, b: Item): number {
  const ba = intervalBucket(a.year);
  const bb = intervalBucket(b.year);
  if (ba !== bb) return ba - bb; // 近五年 → 上一個五年 → …
  const ia = a.impactFactor ?? -1;
  const ib = b.impactFactor ?? -1;
  if (ib !== ia) return ib - ia; // 同區間 IF 高優先
  return (b.year ?? 0) - (a.year ?? 0); // 再依年份新到舊
}

// 依鍵字串產生穩定色（Okabe–Ito 友善色盤）
const PALETTE = [
  "#0072B2",
  "#009E73",
  "#D55E00",
  "#56B4E9",
  "#E69F00",
  "#CC79A7",
  "#3B5169",
  "#9B2226",
  "#6A8CA6",
  "#117733",
  "#882255",
];
function colorOf(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

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
  const [axis, setAxis] = useState<Axis>("region");
  const [q, setQ] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    // BASE_URL 兼容 GitHub Pages 子路徑與自訂網域根域
    fetch(`${import.meta.env.BASE_URL}data/reviews-index.json`, {
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ReviewsData) => setData(d))
      .catch((e) => setErr(String(e.message || e)));
  }, []);

  // 切換軸時收合所有展開項
  useEffect(() => setOpen(new Set()), [axis]);

  // 先過濾（免費 + 關鍵字），再依所選軸分組 → 疾病，最後把單篇疾病收進「其他」
  const groups: AxisGroup[] = useMemo(() => {
    if (!data) return [];
    const term = q.trim().toLowerCase();
    const items = data.items.filter((it) => {
      if (freeOnly && !it.free) return false;
      if (term) {
        return (
          it.disease.toLowerCase().includes(term) ||
          it.title.toLowerCase().includes(term)
        );
      }
      return true;
    });

    // axis-key → disease → items（多值軸會重複歸屬）
    const byKey = new Map<string, Map<string, Item[]>>();
    for (const it of items) {
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
      const diseases: DiseaseGroup[] = [];
      const singles: Item[] = [];
      for (const [disease, arr] of dm) {
        if (arr.length === 1) singles.push(arr[0]);
        else diseases.push({ disease, items: arr });
      }
      diseases.sort((a, b) => b.items.length - a.items.length);
      if (singles.length)
        diseases.push({ disease: "其他（單篇主題）", items: singles });
      const total = diseases.reduce((n, d) => n + d.items.length, 0);
      result.push({ key, diseases, total });
    }
    // 缺值桶（未分類主題／未標族群）一律排到最後
    const rank = (k: string) => {
      if (k.startsWith("未")) return 1e12;
      const i = order.indexOf(k);
      return i === -1 ? 1e9 : i;
    };
    result.sort((a, b) => rank(a.key) - rank(b.key) || b.total - a.total);
    return result;
  }, [data, axis, q, freeOnly]);

  const stats = useMemo(() => {
    const reviewCount = groups.reduce((n, g) => n + g.total, 0);
    const freeCount = groups.reduce(
      (n, g) =>
        n +
        g.diseases.reduce(
          (m, d) => m + d.items.filter((i) => i.free).length,
          0,
        ),
      0,
    );
    return { groupCount: groups.length, reviewCount, freeCount };
  }, [groups]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (err) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        資料載入失敗：{err}
        <div className="mt-1 text-sm opacity-80">
          預期檔案：<code>data/reviews-index.json</code>
        </div>
      </div>
    );
  }
  if (!data)
    return (
      <div className="p-8 text-slate-500 dark:text-slate-400">
        載入分類資料中…
      </div>
    );

  const jcrYear = data.meta.ifJcrYear ?? "2023";

  return (
    <div className="space-y-5">
      {/* Hero */}
      <header className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950">
        <p className="text-xs font-semibold tracking-widest text-sky-600 dark:text-sky-400">
          SPORTS MEDICINE · REVIEW INDEX
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
          運動醫學 Review 索引
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
          從知識庫的運動醫學／復健文獻，加上 PubMed
          權威期刊（BJSM、AJSM、JOSPT、KSSTA、Cochrane…）
          的近年綜述，篩出系統性回顧、統合分析與臨床指引，可依
          <span className="font-medium">部位、臨床主題、族群</span>
          三種方式瀏覽。知識庫文章附一句 AI 摘要，並標示可公開取得的免費全文。
        </p>
        <div className="mt-4 flex flex-wrap gap-6">
          <Stat
            n={stats.groupCount}
            label={AXIS_LABEL[axis].replace("依", "") + "分類"}
          />
          <Stat n={stats.reviewCount} label="review" />
          <Stat n={stats.freeCount} label="免費全文" accent />
        </div>
        {data.meta.updated && (
          <p className="mt-3 text-xs text-slate-400">
            更新：{data.meta.updated}
          </p>
        )}
      </header>

      {/* Toolbar */}
      <div className="sticky top-0 z-10 space-y-3 rounded-lg border border-slate-200 bg-white/90 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        {/* 分類軸切換 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            分類方式
          </span>
          {(Object.keys(AXIS_LABEL) as Axis[]).map((a) => (
            <button
              key={a}
              onClick={() => setAxis(a)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                axis === a
                  ? "bg-sky-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {AXIS_LABEL[a]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(e) => setFreeOnly(e.target.checked)}
              className="h-4 w-4 rounded accent-emerald-600"
            />
            🔓 只顯示免費全文
          </label>
          <div className="relative flex-1 min-w-[220px]">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋疾病或標題…（例：前十字韌帶、足底筋膜炎、腦震盪）"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
      </div>

      {/* 分類導覽 chips */}
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <a
            key={g.key}
            href={`#grp-${encodeURIComponent(g.key)}`}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition hover:opacity-80"
            style={{
              borderColor: colorOf(g.key) + "55",
              color: colorOf(g.key),
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: colorOf(g.key) }}
            />
            {g.key}
            <span className="text-slate-400">{g.total}</span>
          </a>
        ))}
      </div>

      {/* Sections */}
      {groups.length === 0 && (
        <div className="rounded-lg border border-slate-200 p-8 text-center text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {q ? `沒有符合「${q}」的結果` : "目前沒有符合條件的項目"}
          {freeOnly && "（已篩選：只看免費全文）"}
        </div>
      )}

      {groups.map((g) => (
        <section
          key={g.key}
          id={`grp-${encodeURIComponent(g.key)}`}
          className="scroll-mt-24"
        >
          <div
            className="mb-2 flex items-center gap-2 rounded-lg px-3 py-2"
            style={{
              background: colorOf(g.key) + "14",
              border: `1px solid ${colorOf(g.key)}30`,
            }}
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: colorOf(g.key) }}
            />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {g.key}
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {g.diseases.length} 個主題 · {g.total} 篇
            </span>
          </div>

          <ul className="space-y-1.5">
            {g.diseases.map((d) => {
              const key = `${axis}::${g.key}::${d.disease}`;
              const isOpen = open.has(key);
              return (
                <li
                  key={key}
                  className="rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  <button
                    onClick={() => toggle(key)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left"
                    style={{ borderLeft: `3px solid ${colorOf(g.key)}` }}
                  >
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {d.disease}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      {d.items.length} 篇
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </span>
                  </button>

                  {isOpen && (
                    <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                      {d.items
                        .slice()
                        .sort(sortByIntervalThenIF)
                        .map((r, i) => (
                          <li key={i} className="px-3 py-2.5">
                            <div className="flex items-start gap-2">
                              {r.year && (
                                <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  {r.year}
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
                                >
                                  {r.title}
                                </a>
                                {r.tldr && (
                                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                    {r.tldr}
                                  </p>
                                )}
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                    {r.source}
                                  </span>
                                  {typeof r.impactFactor === "number" && (
                                    <span
                                      className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                                      title={`期刊影響係數（近似，Clarivate JCR ${jcrYear}）`}
                                    >
                                      IF≈{r.impactFactor}
                                    </span>
                                  )}
                                  {r.origin === "pubmed" && (
                                    <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                                      PubMed{r.pmid ? ` ${r.pmid}` : ""}
                                    </span>
                                  )}
                                  {r.free && (
                                    <a
                                      href={r.freeUrl || r.url}
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
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <footer className="space-y-1 border-t border-slate-200 pt-4 text-xs text-slate-400 dark:border-slate-800">
        <p>
          免費全文為啟發式判定（依來源網域是否開放取用），非逐篇 Unpaywall
          驗證；引用前請循原文與 DOI 取正式版。
        </p>
        <p>
          IF≈ 為期刊影響係數<strong>近似值</strong>（Clarivate JCR {jcrYear}），
          僅供參考、逐年變動；僅對可辨識的特定期刊標示（來源為出版社／聚合網域者不標）。
        </p>
      </footer>
    </div>
  );
}

function Stat({
  n,
  label,
  accent,
}: {
  n: number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-2xl font-bold tabular-nums ${accent ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white"}`}
      >
        {n.toLocaleString("en-US")}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
