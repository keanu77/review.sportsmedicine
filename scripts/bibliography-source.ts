import { compatibleIdentifiers, identifiersOf, normalizedTitle } from "../src/identity.ts";
import { selectBibliography } from "../src/enrich.ts";
import { publicationDate } from "../src/publicationDate.ts";
import type { BibliographyEntry, Item } from "../src/types.ts";

export interface EuropePmcResult {
  id: string; source: string; title?: string; pubYear?: string;
  pmid?: string; pmcid?: string; doi?: string; pageInfo?: string;
  firstPublicationDate?: string;
  authorList?: { author?: { fullName?: string; collectiveName?: string }[] };
  journalInfo?: { volume?: string; issue?: string; journal?: { title?: string; medlineAbbreviation?: string } };
}

export function europePmcRecord(raw: EuropePmcResult, verifiedAt: string): BibliographyEntry {
  return {
    title: raw.title || "", year: /^\d{4}$/.test(raw.pubYear || "") ? Number(raw.pubYear) : null,
    firstPublicationDate: publicationDate(raw.firstPublicationDate),
    ...identifiersOf({ ...raw, url: "" }),
    authors: (raw.authorList?.author ?? []).map(author => author.fullName || author.collectiveName || "").filter(Boolean),
    journal: raw.journalInfo?.journal?.title || raw.journalInfo?.journal?.medlineAbbreviation || null,
    volume: raw.journalInfo?.volume || null, issue: raw.journalInfo?.issue || null, pages: raw.pageInfo || null,
    source: "Europe PMC", sourceUrl: `https://europepmc.org/article/${encodeURIComponent(raw.source)}/${encodeURIComponent(raw.id)}`,
    verifiedAt, matchMethod: "identifier",
  };
}

export function resolveCandidates(item: Item, raw: EuropePmcResult[], verifiedAt: string): { record?: BibliographyEntry; reason?: string } {
  // MED and PMC can return the same paper. Collapse only compatible records with an identical DOI/PMID.
  const records: BibliographyEntry[] = [];
  for (const candidate of [...raw].sort((a, b) => Number(b.source === "MED") - Number(a.source === "MED"))) {
    const record = europePmcRecord(candidate, verifiedAt);
    const ids = identifiersOf({ ...record, url: "" });
    if (!record.title || !Object.values(ids).some(Boolean)) continue;
    const duplicate = records.some(previous => {
      const prev = identifiersOf({ ...previous, url: "" });
      return normalizedTitle(previous.title) === normalizedTitle(record.title) && compatibleIdentifiers(prev, ids)
        && (["doi", "pmid", "pmcid"] as const).some(key => ids[key] && ids[key] === prev[key]);
    });
    if (!duplicate) records.push(record);
  }
  const selected = selectBibliography(item, records);
  if (!selected) return { reason: raw.length ? "identity-or-title-conflict" : "no-exact-source-match" };
  const ids = identifiersOf(item), found = identifiersOf({ ...selected, url: "" });
  const exact = (["doi", "pmid", "pmcid"] as const).some(key => ids[key] && ids[key] === found[key]);
  return { record: { ...selected, matchMethod: exact ? "identifier" : "exact-title-year" } };
}
