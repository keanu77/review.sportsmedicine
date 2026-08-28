// 文獻搜尋比對。
//
// 兩個必須同時解決的問題：
//  1. 涵蓋率——原本只比對 title + disease，導致「PRP」漏 36 篇、「IJSPT」命中 0。
//     改為比對全部文字欄位，並套用 aliases.ts 的縮寫展開。
//  2. 精確度——原本用裸 String.includes，「at」命中 846/911 篇（吃到 systematic、meta）。
//     爆量只發生在拉丁字母被吃進英文單字裡，所以只有拉丁 token 要求詞界；
//     漢字資訊密度高，單字（「膝」「肩」）本身就夠精確，維持子字串比對。

import { expandToken } from "./aliases";
import type { Item } from "./types";

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
    item.region,
    ...(item.themes ?? []),
    ...(item.populations ?? []),
    ...(item.diseases ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const LATIN_ONLY = /^[a-z0-9][a-z0-9.-]*$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 拉丁詞：短詞（≤3）要求前後皆為詞界，避免 at/rc/ct 這類炸開；
// 長詞只要求前緣詞界，讓 tendin 仍能命中 tendinopathy。
function latinMatcher(token: string): RegExp {
  const t = escapeRegExp(token);
  return token.length <= 3
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

/** 把查詢字串切成 token。 */
export function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 全部 token 都命中才算命中（AND 語意）。 */
export function matchesQuery(item: Item, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const haystack = haystackOf(item);
  return tokens.every((token) => tokenMatches(haystack, token));
}

/**
 * 查詢完全沒有結果時，從 232 個病名與主題裡找出可以建議的替代詞，
 * 讓使用者有復原路徑，而不是撞牆。
 */
export function suggestTerms(items: Item[], query: string, limit = 4): string[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const expanded = tokens.flatMap((t) => expandToken(t).slice(1));
  if (!expanded.length) return [];

  const hits = new Map<string, number>();
  for (const item of items) {
    const haystack = haystackOf(item);
    if (!expanded.some((term) => haystack.includes(term.toLowerCase()))) continue;
    for (const label of [item.disease, ...(item.themes ?? [])]) {
      if (label) hits.set(label, (hits.get(label) ?? 0) + 1);
    }
  }
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, n]) => `${label}（${n}）`);
}
