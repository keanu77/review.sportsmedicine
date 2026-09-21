import type { Item } from "./types";

/** Keep this alias stable: summary overlays and existing browser bookmarks use it. */
export function paperKey(item: Pick<Item, "title" | "url">): string {
  return item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") || item.url;
}

export function doiOf(item: Pick<Item, "url" | "doi">): string | null {
  const raw = item.doi?.trim() || item.url.match(/(?:doi\.org\/|\/doi\/(?:abs\/|full\/|pdf\/)?)(10\.\d{4,9}\/[^?#\s]+)/i)?.[1];
  if (!raw) return null;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* Keep malformed upstream escapes readable. */ }
  decoded = decoded.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
  return /^10\.\d{4,9}\/\S+$/i.test(decoded) ? decoded.toLowerCase() : null;
}

export function sourceInput(item: Item): string | null {
  const doi = doiOf(item);
  if (doi) return doi;
  if (item.pmid && /^\d+$/.test(item.pmid)) return `PMID:${item.pmid}`;
  if (item.pmcid && /^PMC\d+$/i.test(item.pmcid)) return item.pmcid.toUpperCase();
  const pmid = item.url.match(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1];
  if (pmid) return `PMID:${pmid}`;
  const pmcid = (item.freeUrl || item.url).match(/(?:pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc)\/articles\/(PMC\d+)/i)?.[1];
  return pmcid?.toUpperCase() ?? null;
}

export function canonicalPaperId(item: Item): string {
  const source = sourceInput(item);
  return source?.startsWith("10.") ? `doi:${source}` : source?.toLowerCase() || `title:${paperKey(item)}`;
}

export function paperAliases(item: Item): string[] {
  return [...new Set([canonicalPaperId(item), paperKey(item), `title:${paperKey(item)}`, ...(item.identityAliases ?? []),
    ...(item.pmid ? [`pmid:${item.pmid}`] : []), ...(item.pmcid ? [item.pmcid.toLowerCase()] : [])])];
}

/** Merge identifier and historical title aliases without losing disease memberships. */
export function uniquePapers(items: Item[]): Item[] {
  type Group = { item: Item; aliases: Set<string> };
  const groups = new Set<Group>();
  const byAlias = new Map<string, Set<Group>>();
  const identifiers = (item: Item) => ({ doi: doiOf(item), pmid: item.pmid || item.url.match(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1], pmcid: item.pmcid?.toUpperCase() || (item.freeUrl || item.url).match(/(?:pmc\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pmc)\/articles\/(PMC\d+)/i)?.[1]?.toUpperCase() });
  const compatible = (a: Item, b: Item) => {
    const first = identifiers(a), second = identifiers(b);
    return (["doi", "pmid", "pmcid"] as const).every(key => !first[key] || !second[key] || first[key] === second[key]);
  };
  const shareIdentifier = (a: Item, b: Item) => {
    const first = identifiers(a), second = identifiers(b);
    return (["doi", "pmid", "pmcid"] as const).some(key => first[key] && first[key] === second[key]);
  };
  const mutuallyCompatible = (matches: Group[]) => matches.every((group, index) => matches.slice(index + 1).every(other => compatible(group.item, other.item)));
  const indexGroup = (group: Group) => {
    for (const alias of group.aliases) {
      if (!byAlias.has(alias)) byAlias.set(alias, new Set());
      byAlias.get(alias)!.add(group);
    }
  };
  for (const item of items) {
    const aliases = paperAliases(item);
    let matches = [...new Set(aliases.flatMap(alias => [...(byAlias.get(alias) ?? [])]))].filter(group => compatible(group.item, item));
    // A title-only row must not bridge two papers whose explicit identifiers conflict.
    if (!mutuallyCompatible(matches)) {
      const explicitMatches = matches.filter(group => shareIdentifier(group.item, item));
      matches = explicitMatches.length && mutuallyCompatible(explicitMatches) ? explicitMatches : matches.filter(group => Object.values(identifiers(group.item)).every(value => !value));
    }
    const group = matches[0];
    if (!group) {
      const created = { item: { ...item, diseases: [...new Set([...(item.diseases ?? []), item.disease].filter(Boolean))] }, aliases: new Set(aliases) };
      groups.add(created);
      indexGroup(created);
      continue;
    }
    for (const incoming of [item, ...matches.slice(1).map(match => match.item)]) {
      const existing = group.item;
      group.item = { ...existing,
        diseases: [...new Set([...(existing.diseases ?? []), ...(incoming.diseases ?? []), incoming.disease].filter(Boolean))],
        pmid: existing.pmid ?? incoming.pmid, pmcid: existing.pmcid ?? incoming.pmcid, doi: doiOf(existing) ?? doiOf(incoming),
        authors: existing.authors?.length ? existing.authors : incoming.authors,
        free: existing.free || incoming.free, freeUrl: existing.freeUrl ?? incoming.freeUrl,
        tldr: existing.tldr ?? incoming.tldr, impactFactor: existing.impactFactor ?? incoming.impactFactor,
      };
    }
    for (const alias of aliases) group.aliases.add(alias);
    for (const other of matches.slice(1)) {
      for (const alias of other.aliases) group.aliases.add(alias);
      for (const alias of other.aliases) byAlias.get(alias)?.delete(other);
      groups.delete(other);
    }
    indexGroup(group);
  }
  return [...groups].map(group => ({ ...group.item, identityAliases: [...group.aliases] }));
}

export function workbenchUrl(item: Item): string {
  const params = new URLSearchParams({ title: item.title });
  const input = sourceInput(item);
  if (input) params.set("input", input);
  return `/workbench/?${params}`;
}
