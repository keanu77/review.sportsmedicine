import { canonicalPaperId } from "./identity";
import type { Item } from "./types";

export const SITE_URL = "https://review.sportsmedicine.tw";
/** Stable deterministic URL; readable identifier prefix plus full-ID hash prevents slug collisions. */
export function paperSlug(item: Item): string {
  const id = canonicalPaperId(item);
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  return `${id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "paper"}-${hash.toString(16).padStart(8, "0")}`;
}
export const paperPath = (item: Item) => `/papers/${paperSlug(item)}/`;
export function paperSlugFromPath(path: string): string | null {
  return path.match(/^\/papers\/([a-z0-9-]+)\/?$/)?.[1] ?? null;
}
export function safeIndexReturn(search: string): string {
  const query = new URLSearchParams(search);
  const from = query.get("from");
  return from && from.startsWith("?") && from.length <= 4096 ? `/${from}` : "/";
}
export function paperLink(item: Item): string {
  const from = typeof window !== "undefined" && window.location.pathname === "/" ? window.location.search : "";
  return paperPath(item) + (from ? `?${new URLSearchParams({ from })}` : "");
}
