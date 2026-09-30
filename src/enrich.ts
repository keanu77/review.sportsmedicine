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

/** Conflicting identifiers cannot share a legacy title-keyed overlay, even for co-publications. */
export function overlayConflicts(items: readonly Item[], bibliography: BibliographyLookup = []): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const raw of items) {
    const item = enrichItem(raw, {}, {}, bibliography);
    const key = paperKey(raw);
    const group = groups.get(key);
    if (group) group.push(item); else groups.set(key, [item]);
  }
  return new Map([...groups].filter(([, group]) => group.some((item, index) =>
    group.slice(index + 1).some(other => !compatibleIdentifiers(identifiersOf(item), identifiersOf(other))))));
}

/** Use the whole catalog as context even when rendering a small subset such as new items. */
export function enrichItems(items: readonly Item[], summaries: Record<string, string>, tags: TagsData["tags"], bibliography: BibliographyLookup = [], catalog: readonly Item[] = items): Item[] {
  const blocked = new Set(overlayConflicts(catalog === items ? items : [...catalog, ...items], bibliography).keys());
  return items.map(item => enrichItem(item, summaries, tags, bibliography, blocked));
}

/** Single-record primitive. Lists must use enrichItems to check cross-record identity conflicts. */
export function enrichItem(item: Item, summaries: Record<string, string>, tags: TagsData["tags"], bibliography: BibliographyLookup = [], blocked: ReadonlySet<string> = new Set()): Item {
  const key = paperKey(item);
  const record = selectBibliography(item, bibliography);
  let next: Item = record ? { ...item, doi: record.doi || item.doi, pmid: record.pmid || item.pmid,
    pmcid: record.pmcid || item.pmcid, authors: record.authors.length ? record.authors : item.authors,
    journal: record.journal || item.journal, volume: record.volume || item.volume,
    issue: record.issue || item.issue, pages: record.pages || item.pages, year: record.year ?? item.year,
    firstPublicationDate: record.firstPublicationDate ?? item.firstPublicationDate,
    bibliography: record, identityAliases: paperAliases(item) } : item;
  next = !blocked.has(key) && summaries[key] ? { ...next, tldr: summaries[key], tldrSource: "local-llm" } : next;
  for (const tag of Object.values(tags)) {
    const current = next[tag.axis] ?? [];
    const renamed = current.map(value => tag.absorbs?.includes(value) ? tag.label : value);
    const add = !blocked.has(key) && tag.keys.includes(key) && !renamed.includes(tag.label);
    if (add || renamed.some((value, index) => value !== current[index])) {
      next = { ...next, [tag.axis]: [...new Set(add ? [...renamed, tag.label] : renamed)] };
    }
  }
  return next;
}
