import { compatibleIdentifiers, identifiersOf } from "./identity";
import type { BibliographyEntry, FullTextMetadata, SourceAbstract } from "./types";

/** Only public HTTPS links; reject credentials, local hosts, IP literals and malformed URLs. */
export function publicHttpsUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || /[\u0000-\u0020\u007f]/.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return undefined;
    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)) return undefined;
    if (!/^[a-z\d.-]+\.[a-z]{2,}$/i.test(host)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function sourceUrlIsValid(url: string | undefined): boolean {
  const safe = publicHttpsUrl(url);
  if (!safe) return false;
  const parsed = new URL(safe);
  return (parsed.hostname === "europepmc.org" && /^\/article\/(?:MED|PMC|PPR)\/[a-z\d]+$/i.test(parsed.pathname))
    || (parsed.hostname === "pubmed.ncbi.nlm.nih.gov" && /^\/\d+\/?$/.test(parsed.pathname));
}

/** Validate again when merging a persisted overlay, not only while building it. */
export function verifiedFullText(value?: FullTextMetadata, record?: BibliographyEntry): FullTextMetadata | undefined {
  if (!value || value.status !== "verified" || !sourceUrlIsValid(value.sourceUrl) || !Number.isFinite(Date.parse(value.verifiedAt || ""))) return undefined;
  if (record && value.sourceUrl !== record.sourceUrl) return undefined;
  const url = publicHttpsUrl(value.url), pdfUrl = publicHttpsUrl(value.pdfUrl);
  if (!url && !pdfUrl) return undefined;
  if (record) {
    const ids = identifiersOf({ ...record, url: "" });
    for (const link of [url, pdfUrl].filter(Boolean) as string[]) {
      const linkedIds = identifiersOf({ url: link });
      const parsed = new URL(link);
      if (parsed.hostname === "europepmc.org") {
        linkedIds.pmcid = parsed.pathname.match(/^\/articles\/(PMC\d+)\/?$/i)?.[1]?.toUpperCase() || null;
        if (!linkedIds.pmcid || linkedIds.pmcid !== ids.pmcid) return undefined;
      }
      if (!compatibleIdentifiers(ids, linkedIds)) return undefined;
    }
  }
  return { ...value, url: url || pdfUrl, pdfUrl, licenseUrl: publicHttpsUrl(value.licenseUrl) };
}

export function verifiedAbstract(value?: SourceAbstract | null, expectedSourceUrl?: string): SourceAbstract | undefined {
  if (!value || !value.text?.trim() || !sourceUrlIsValid(value.sourceUrl) || !Number.isFinite(Date.parse(value.verifiedAt))) return undefined;
  if (expectedSourceUrl && value.sourceUrl !== expectedSourceUrl) return undefined;
  if (value.source !== "Europe PMC" && value.source !== "PubMed") return undefined;
  return value;
}
