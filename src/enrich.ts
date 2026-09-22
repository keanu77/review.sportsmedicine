import { compatibleIdentifiers, identifiersOf, normalizedTitle, paperAliases, paperKey } from "./identity";
import type { BibliographyEntry, Item, TagsData } from "./types";

export type BibliographyLookup = BibliographyEntry[] | ReadonlyMap<string, readonly BibliographyEntry[]>;

/** Build once per data update. Explicit snapshots avoid stale caches when builders replace array entries. */
export function createBibliographyIndex(records: readonly BibliographyEntry[]): ReadonlyMap<string, readonly BibliographyEntry[]> {
  const index = new Map<string, BibliographyEntry[]>();
  for (const record of records) {
    const title = normalizedTitle(record.title);
    const entries = index.get(title);
    if (entries) entries.push(record); else index.set(title, [record]);
  }
  return index;
}

/** Exact source identity plus matching title/year; never resolve a conflicting identifier by title. */
export function selectBibliography(item: Item, records: BibliographyLookup): BibliographyEntry | undefined {
  const ids = identifiersOf(item);
  const title = normalizedTitle(item.title);
  const possible = Array.isArray(records) ? records : records.get(title) ?? [];
  const candidates = possible.filter(record => {
    if (!title || title !== normalizedTitle(record.title)) return false;
    const candidate = identifiersOf({ ...record, url: "" });
    if (!compatibleIdentifiers(ids, candidate)) return false;
    const sameId = (["doi", "pmid", "pmcid"] as const).some(key => ids[key] && ids[key] === candidate[key]);
    const compatibleYear = item.year != null && record.year != null && Math.abs(item.year - record.year) <= 1;
    return (sameId && (item.year == null || record.year == null || compatibleYear)) || compatibleYear;
  });
  const exact = candidates.filter(record => {
    const candidate = identifiersOf({ ...record, url: "" });
    return (["doi", "pmid", "pmcid"] as const).some(key => ids[key] && ids[key] === candidate[key]);
  });
  const matches = exact.length ? exact : candidates;
  return matches.length === 1 ? matches[0] : undefined;
}

export function enrichItem(item: Item, summaries: Record<string, string>, tags: TagsData["tags"], bibliography: BibliographyLookup = []): Item {
  const key = paperKey(item);
  const record = selectBibliography(item, bibliography);
  let next: Item = record ? { ...item, doi: record.doi || item.doi, pmid: record.pmid || item.pmid,
    pmcid: record.pmcid || item.pmcid, authors: record.authors.length ? record.authors : item.authors,
    journal: record.journal || item.journal, volume: record.volume || item.volume,
    issue: record.issue || item.issue, pages: record.pages || item.pages, year: record.year ?? item.year,
    firstPublicationDate: record.firstPublicationDate ?? item.firstPublicationDate,
    bibliography: record, identityAliases: paperAliases(item) } : item;
  next = summaries[key] ? { ...next, tldr: summaries[key], tldrSource: "local-llm" } : next;
  for (const tag of Object.values(tags)) {
    const current = next[tag.axis] ?? [];
    const renamed = current.map(value => tag.absorbs?.includes(value) ? tag.label : value);
    const add = tag.keys.includes(key) && !renamed.includes(tag.label);
    if (add || renamed.some((value, index) => value !== current[index])) {
      next = { ...next, [tag.axis]: [...new Set(add ? [...renamed, tag.label] : renamed)] };
    }
  }
  return next;
}
