import { canonicalPaperId } from "./identity";
import type { Item } from "./types";

export const FACETS = ["region", "disease", "theme", "population"] as const;
export type FacetKey = typeof FACETS[number];
export type FacetState = Record<FacetKey, string>;
export const EMPTY_FACETS: FacetState = { region: "", disease: "", theme: "", population: "" };
export const FACET_LABELS: Record<FacetKey, string> = { region: "部位", disease: "疾病", theme: "介入／主題", population: "族群" };
export function facetValues(item: Item, key: FacetKey): string[] {
  return (key === "region" ? [item.region] : key === "disease" ? [item.disease, ...(item.diseases ?? [])] : key === "theme" ? item.themes : item.populations).filter(Boolean);
}
export function matchesFacets(item: Item, state: FacetState, except?: FacetKey): boolean {
  return FACETS.every(key => key === except || !state[key] || facetValues(item, key).includes(state[key]));
}
/** Counts reflect all other active conditions, with papers deduplicated per option. */
export function facetOptions(items: Item[], state: FacetState, key: FacetKey) {
  const counts = new Map<string, Set<string>>();
  for (const item of items) {
    if (!matchesFacets(item, state, key)) continue;
    for (const label of facetValues(item, key)) {
      if (!counts.has(label)) counts.set(label, new Set());
      counts.get(label)!.add(canonicalPaperId(item));
    }
  }
  if (state[key] && !counts.has(state[key])) counts.set(state[key], new Set());
  return [...counts].map(([value, ids]) => ({ value, count: ids.size })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-Hant"));
}
