// 文獻搜尋比對。
//
// 兩個必須同時解決的問題：
//  1. 涵蓋率——原本只比對 title + disease，導致「PRP」漏 36 篇、「IJSPT」命中 0。
//     改為比對全部文字欄位，並套用 aliases.ts 的縮寫展開。
//  2. 精確度——原本用裸 String.includes，「at」命中 846/911 篇（吃到 systematic、meta）。
//     爆量只發生在拉丁字母被吃進英文單字裡，所以只有拉丁 token 要求詞界；
//     漢字資訊密度高，單字（「膝」「肩」）本身就夠精確，維持子字串比對。

import { ALIASES, expandToken } from "./aliases";
import type { Item } from "./types";
import { doiOf, identifiersOf, uniquePapers } from "./identity";

/** 一篇文獻所有可搜尋的文字，小寫合併。 */
export function haystackOf(item: Item): string {
  return [
    item.title,
    item.year == null ? null : String(item.year),
    item.disease,
    item.tldr,
    item.source,
    item.journal,
    item.pmid,
    item.pmcid,
    doiOf(item),
    ...(item.authors ?? []),
    item.region,
    ...(item.themes ?? []),
    ...(item.populations ?? []),
    ...(item.diseases ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const LATIN_ONLY = /^[a-z0-9][a-z0-9 .'-]*$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 拉丁詞：短詞（≤3）要求前後皆為詞界，避免 at/rc/ct 這類炸開；
// 長單字只要求前緣詞界，讓 tendin 仍能命中 tendinopathy；完整片語兩端皆要求詞界。
function latinMatcher(token: string): RegExp {
  const t = escapeRegExp(token).replace(/ /g, "\\s+");
  return token.length <= 3 || token.includes(" ")
    ? new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9])`, "i")
    : new RegExp(`(?<![a-z0-9])${t}`, "i");
}

/** 單一 token 是否命中——自身或任一別名命中即可。 */
function tokenMatches(haystack: string, token: string): boolean {
  return expandToken(token).some((term) => {
    if (LATIN_ONLY.test(term)) return latinMatcher(term).test(haystack);
    return haystack.includes(term.toLowerCase());
  });
}

// 最長片語優先，避免 rotator cuff repair 被較短的 rotator cuff 吃掉。
const ALIAS_PHRASES = Object.keys(ALIASES).filter(term => term.includes(" "))
  .map(term => term.split(" ")).sort((a, b) => b.length - a.length);

/** AND 是分隔符；其餘查詢詞維持 AND 語意，不將 OR 誤當成支援的布林運算子。 */
export function tokenize(query: string): string[] {
  const words = query.trim().replace(/\b(doi|pmid|pmcid):\s+/gi, "$1:")
    .split(/\s+/).filter(Boolean).map(word => /^https?:/i.test(word) ? word : word.toLowerCase());
  const tokens: string[] = [];
  for (let index = 0; index < words.length;) {
    if (words[index] === "and") { index++; continue; }
    const phrase = ALIAS_PHRASES.find(parts => parts.every((part, offset) => words[index + offset] === part));
    tokens.push(phrase ? phrase.join(" ") : words[index]);
    index += phrase?.length ?? 1;
  }
  return tokens;
}

function canonicalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return null;
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.hostname.toLowerCase()}${decodeURI(url.pathname).replace(/\/$/, "")}${url.search}`;
  } catch { return null; }
}

function exactToken(item: Item, token: string): boolean | null {
  const isUrl = /^https?:/i.test(token);
  const doi = doiOf({ doi: isUrl ? undefined : token, url: token });
  if (doi) return identifiersOf(item).doi === doi;
  // Ordinary words are not URLs. Avoid repeatedly throwing URL parse errors for them.
  const queryIds = isUrl ? identifiersOf({ url: token }) : null;
  const pmid = token.match(/^pmid:(\d+)$/i)?.[1] || token.match(/^(\d{5,9})$/)?.[1] || queryIds?.pmid;
  if (pmid) return identifiersOf(item).pmid === pmid;
  const pmcid = token.match(/^(?:pmcid:)?(PMC\d+)$/i)?.[1]?.toUpperCase() || queryIds?.pmcid;
  if (pmcid) return identifiersOf(item).pmcid === pmcid;
  const url = isUrl ? canonicalUrl(token) : null;
  if (url) return [item.url, item.freeUrl].some(value => value && canonicalUrl(value) === url);
  return null;
}

/** 全部 token 都命中才算命中（AND 語意）。 */
export function matchesQuery(item: Item, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const haystack = haystackOf(item);
  return tokens.every((token) => exactToken(item, token) ?? tokenMatches(haystack, token));
}

export type SearchSort = "relevance" | "latest";

export function searchSortLabel(sort: SearchSort): string {
  return sort === "latest" ? "依年份新到舊" : "依相關度";
}

// 只採明確的疾病／組織／運動情境詞，不從「髖與鼠蹊」「頭頸」等部位桶推論。
// 例如尿失禁、生殖或落髮文獻可能被分在這些桶，不能因此拿到運動醫學加分。
const SPORTS_CONTEXT = /\b(?:osteoarthrit[a-z]*|tendin[a-z]*|tendon[a-z]*|ligament[a-z]*|menisc[a-z]*|epicondyl[a-z]*|musculoskeletal|orthop[a-z]*|rotator cuff|plantar fasci[a-z]*|spondyl[a-z]*|disc degenerat[a-z]*|muscle injur[a-z]*|muscle strain[a-z]*|athlete[a-z]*|sports? injur[a-z]*|sports? medicine|return[ -]to[ -](?:sport|play)|(?:knee|shoulder|hip|ankle|elbow|low back) pain)\b|骨關節炎|肌腱|韌帶|半月板|旋轉肌袖|五十肩|冰凍肩|足底筋膜|椎間盤|肌肉(?:拉傷|損傷)|運動(?:傷害|員)|回場|膝痛|肩痛|下背痛/i;

export interface RelevanceScore {
  identifier: number;
  title: number;
  authors: number;
  topics: number;
  sportsContext: number;
  total: number;
}

/** Deterministic, additive weights; the sports-context bonus applies only to an unqualified PRP query. */
export function relevanceScore(item: Item, tokens: string[]): RelevanceScore {
  const score = { identifier: 0, title: 0, authors: 0, topics: 0, sportsContext: 0, total: 0 };
  for (const token of tokens) {
    if (exactToken(item, token)) score.identifier += 100;
    if (tokenMatches(item.title.toLowerCase(), token)) score.title += 10;
    if (tokenMatches((item.authors ?? []).join(" ").toLowerCase(), token)) score.authors += 5;
    if (tokenMatches([item.disease, ...(item.diseases ?? []), ...(item.themes ?? [])].join(" ").toLowerCase(), token)) score.topics += 3;
  }
  // A qualifier (e.g. PRP alopecia / infertility) disables the whole bonus. No papers
  // are hidden or negatively scored, and chronological sorting bypasses it entirely.
  const genericPrp = tokens.length > 0 && tokens.every(token => expandToken(token).includes("prp"));
  if (genericPrp) {
    if (SPORTS_CONTEXT.test(item.title)) score.sportsContext += 8;
    if (SPORTS_CONTEXT.test([item.disease, ...(item.diseases ?? [])].join(" "))) score.sportsContext += 4;
  }
  score.total = score.identifier + score.title + score.authors + score.topics + score.sportsContext;
  return score;
}

export function rankResults(items: Item[], tokens: string[], sort: SearchSort): Item[] {
  // Scoring parses identifiers and matches aliases once per paper, not once per comparison.
  const scores = sort === "relevance" ? new Map(items.map(item => [item, relevanceScore(item, tokens).total])) : null;
  return [...items].sort((a, b) => (scores ? scores.get(b)! - scores.get(a)! : 0)
    || (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title));
}

export interface SearchSuggestion {
  /** Plain search input; the UI must not append the displayed count to this value. */
  query: string;
  label: string;
  /** Number of unique papers matching query in the supplied catalog, before UI filters. */
  count: number;
}

/** Recover from an over-constrained query using topics from papers matching any of its terms. */
export function suggestQueries(items: Item[], query: string, limit = 4): SearchSuggestion[] {
  const tokens = tokenize(query);
  if (!tokens.length || limit <= 0) return [];
  const labels = new Map<string, number>();
  for (const item of uniquePapers(items)) {
    if (!tokens.some(token => matchesQuery(item, [token]))) continue;
    for (const label of new Set([item.disease, ...(item.diseases ?? []), ...(item.themes ?? [])])) {
      if (label && !label.startsWith("未分類")) labels.set(label, (labels.get(label) ?? 0) + 1);
    }
  }
  return [...labels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit).map(([label]) => ({
      query: label,
      label,
      count: uniquePapers(items.filter(item => matchesQuery(item, tokenize(label)))).length,
    })).filter(suggestion => suggestion.count > 0);
}

/** Backward-compatible display strings; clickable UIs should use suggestQueries instead. */
export function suggestTerms(items: Item[], query: string, limit = 4): string[] {
  return suggestQueries(items, query, limit).map(({ label, count }) => `${label}（${count}）`);
}
