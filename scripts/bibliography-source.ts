import { compatibleIdentifiers, identifiersOf, normalizedTitle } from "../src/identity.ts";
import { selectBibliography } from "../src/enrich.ts";
import { publicationDate } from "../src/publicationDate.ts";
import { publicHttpsUrl } from "../src/sourceMetadata.ts";
import type { BibliographyEntry, FullTextMetadata, Item, SourceAbstract } from "../src/types.ts";

export interface EuropePmcResult {
  id: string; source: string; title?: string; pubYear?: string;
  pmid?: string; pmcid?: string; doi?: string; pageInfo?: string;
  firstPublicationDate?: string;
  isOpenAccess?: string;
  hasPDF?: string;
  license?: string;
  abstractText?: string;
  fullTextUrlList?: { fullTextUrl?: { availability?: string; availabilityCode?: string; documentStyle?: string; site?: string; url?: string }[] };
  authorList?: { author?: { fullName?: string; collectiveName?: string }[] };
  journalInfo?: { volume?: string; issue?: string; journal?: { title?: string; medlineAbbreviation?: string } };
}

function plainText(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/<\/?[a-z][^>]*>/gi, " ").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()] || entity;
    const num = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isInteger(num) && num > 0 && num <= 0x10ffff ? String.fromCodePoint(num) : entity;
  }).replace(/\s+/g, " ").trim();
}

export function sourceAbstract(raw: string | undefined, sourceUrl: string, verifiedAt: string): SourceAbstract | null {
  if (!raw?.trim()) return null;
  const text = plainText(raw);
  if (!text) return null;
  const sections = [...raw.matchAll(/<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>\s*([\s\S]*?)(?=<h[1-6](?:\s|>)|$)/gi)]
    .map(match => ({ label: plainText(match[2]), text: plainText(match[3]) }))
    .filter(section => section.label && section.text);
  return { text, ...(sections.length ? { sections } : {}), source: "Europe PMC", sourceUrl, verifiedAt };
}

/** Access and license are separate. A PMCID/isOpenAccess flag alone proves neither a working URL nor reuse permission. */
export function sourceFullText(raw: EuropePmcResult, sourceUrl: string, verifiedAt: string): FullTextMetadata {
  const ids = identifiersOf({ ...raw, url: "" });
  const links = (raw.fullTextUrlList?.fullTextUrl ?? []).flatMap(link => {
    if (!(link.availabilityCode === "OA" || link.availabilityCode === "F" || /^(?:open access|free)$/i.test(link.availability || ""))) return [];
    let candidate = link.url || "";
    // Europe PMC sometimes reports its own links as HTTP; only known repository hosts are upgraded.
    candidate = candidate.replace(/^http:\/\/(europepmc\.org|pmc\.ncbi\.nlm\.nih\.gov)\//i, "https://$1/");
    const url = publicHttpsUrl(candidate);
    if (!url) return [];
    const parsed = new URL(url);
    const linkedIds = identifiersOf({ url, freeUrl: null });
    const epmcId = parsed.hostname === "europepmc.org" ? parsed.pathname.match(/^\/articles\/(PMC\d+)\/?$/i)?.[1]?.toUpperCase() : undefined;
    if (epmcId) linkedIds.pmcid = epmcId;
    if (!compatibleIdentifiers(ids, linkedIds)) return [];
    if (parsed.hostname === "europepmc.org" && (!epmcId || ids.pmcid !== epmcId)) return [];
    if (parsed.hostname === "pmc.ncbi.nlm.nih.gov" && (!linkedIds.pmcid || ids.pmcid !== linkedIds.pmcid)) return [];
    return [{ url, pdf: link.documentStyle?.toLowerCase() === "pdf", repository: /^(?:europepmc.org|pmc.ncbi.nlm.nih.gov)$/.test(parsed.hostname) }];
  }).sort((a, b) => Number(b.repository) - Number(a.repository));
  const html = links.find(link => !link.pdf), pdf = links.find(link => link.pdf);
  const license = typeof raw.license === "string" && raw.license.trim() ? raw.license.trim() : undefined;
  return { status: html || pdf ? "verified" : "unknown", ...(html || pdf ? { url: (html || pdf)!.url } : {}),
    ...(pdf ? { pdfUrl: pdf.url } : {}), sourceUrl, verifiedAt, ...(license ? { license } : {}),
    reason: html || pdf ? "source-listed-free-full-text" : "no-source-listed-free-full-text" };
}

export function europePmcRecord(raw: EuropePmcResult, verifiedAt: string): BibliographyEntry {
  const sourceUrl = `https://europepmc.org/article/${encodeURIComponent(raw.source)}/${encodeURIComponent(raw.id)}`;
  return {
    title: raw.title || "", year: /^\d{4}$/.test(raw.pubYear || "") ? Number(raw.pubYear) : null,
    firstPublicationDate: publicationDate(raw.firstPublicationDate),
    ...identifiersOf({ ...raw, url: "" }),
    authors: (raw.authorList?.author ?? []).map(author => author.fullName || author.collectiveName || "").filter(Boolean),
    journal: raw.journalInfo?.journal?.title || raw.journalInfo?.journal?.medlineAbbreviation || null,
    volume: raw.journalInfo?.volume || null, issue: raw.journalInfo?.issue || null, pages: raw.pageInfo || null,
    source: "Europe PMC", sourceUrl,
    verifiedAt, matchMethod: "identifier",
    fullText: sourceFullText(raw, sourceUrl, verifiedAt),
    abstract: sourceAbstract(raw.abstractText, sourceUrl, verifiedAt),
  };
}

/** Europe PMC free access does not grant redistribution. Retain source attribution and license. */
export function publicBibliographyRecord(record: BibliographyEntry): BibliographyEntry {
  if (!record.abstract) return record;
  if (record.abstract.excerptOnly) return record;
  const license = record.fullText?.license;
  const normalized = (license || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:cc by|cc by sa|cc0)(?: \d+(?:\.\d+)?)?$/.test(normalized)) {
    return { ...record, abstract: { ...record.abstract, excerptOnly: false, license } };
  }
  const words = record.abstract.text.trim().split(/\s+/);
  return { ...record, abstract: { text: words.slice(0, 25).join(" ") + (words.length > 25 ? "…" : ""),
    source: record.abstract.source, sourceUrl: record.abstract.sourceUrl, verifiedAt: record.abstract.verifiedAt, excerptOnly: true } };
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
