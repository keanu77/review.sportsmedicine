/** Source completeness and incremental summary backlog. No network or model calls.
 * node --import tsx scripts/build-readiness.ts
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createBibliographyIndex, enrichItems, overlayConflicts } from "../src/enrich.ts";
import { canonicalPaperId, identifiersOf, paperKey, uniquePapers } from "../src/identity.ts";
import type { BibliographyData, ReadinessData, ReadinessRecord, ReviewsData, SummariesData } from "../src/types.ts";

export function buildReadiness(index: ReviewsData, bibliography: BibliographyData, summaries: SummariesData, generatedAt = new Date().toISOString()): ReadinessData {
  const lookup = createBibliographyIndex(bibliography.records);
  const conflicts = overlayConflicts(index.items, lookup);
  const originals = uniquePapers(index.items);
  const items = enrichItems(originals, summaries.summaries, {}, lookup, index.items);
  const unresolved = new Map(bibliography.unresolved.map(record => [record.key, record]));
  const papers: ReadinessRecord[] = items.map((item, i) => {
    const raw = originals[i], key = canonicalPaperId(raw), titleKey = paperKey(raw);
    const conflict = conflicts.has(titleKey);
    const missing = [!item.authors?.length && "authors", !Object.values(identifiersOf(item)).some(Boolean) && "identifiers",
      !item.firstPublicationDate && "publication-date", !item.abstract?.text && "abstract", !item.tldr && "summary"].filter(Boolean) as string[];
    const reasons: string[] = [];
    if (unresolved.has(key)) reasons.push(unresolved.get(key)!.reason);
    if (conflict) reasons.push("conflicting-identifiers-for-title-overlay");
    if (!item.abstract?.text) reasons.push(item.bibliography ? "abstract-not-supplied-by-source" : "source-abstract-not-yet-verified");
    const attempt = summaries.attempts?.[titleKey];
    if (attempt?.reason && attempt.status !== "generated") reasons.push(attempt.reason);
    const blocked = conflict || !item.abstract?.text;
    return { key, title: item.title, bibliography: item.bibliography ? "verified" : "unresolved", abstract: item.abstract?.text ? "verified" : "missing",
      summary: item.tldr ? "available" : blocked ? "blocked" : "pending",
      summaryOverlay: !conflict && summaries.summaries[titleKey] ? "available" : blocked ? "blocked" : "pending",
      fullText: item.fullText?.status || "unknown", missing, reasons: [...new Set(reasons)], sourceUrl: item.bibliography?.sourceUrl };
  });
  const count = (predicate: (paper: ReadinessRecord) => boolean) => papers.filter(predicate).length;
  return { version: 1, generatedAt, sourceUpdated: index.meta.updated, indexUpdated: index.meta.updated, summaryGeneratedAt: summaries.generatedAt, counts: {
    total: papers.length, bibliographyVerified: count(p => p.bibliography === "verified"), bibliographyUnresolved: count(p => p.bibliography === "unresolved"),
    abstractVerified: count(p => p.abstract === "verified"), abstractMissing: count(p => p.abstract === "missing"),
    abstractFull: items.filter(item => item.abstract && !item.abstract.excerptOnly).length,
    abstractExcerpt: items.filter(item => item.abstract?.excerptOnly).length,
    summariesAvailable: count(p => p.summary === "available"), summaryBacklog: count(p => p.summary !== "available"),
    summaryReady: count(p => p.summary === "pending"), summaryBlocked: count(p => p.summary === "blocked"),
    overlaySummariesAvailable: count(p => p.summaryOverlay === "available"), overlaySummaryBacklog: count(p => p.summaryOverlay !== "available"),
    missingAuthors: count(p => p.missing.includes("authors")), missingIdentifiers: count(p => p.missing.includes("identifiers")), missingDate: count(p => p.missing.includes("publication-date")),
    fullTextVerified: count(p => p.fullText === "verified"), fullTextInferred: count(p => p.fullText === "inferred"), fullTextUnknown: count(p => p.fullText === "unknown"),
    conflictedTitleKeys: conflicts.size,
  }, papers };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("../public/data/", import.meta.url);
  const [index, bibliography, summaries] = await Promise.all(["reviews-index.json", "bibliography.json", "summaries.json"].map(async name => JSON.parse(await readFile(new URL(name, root), "utf8"))));
  const data = buildReadiness(index, bibliography, summaries);
  const temporary = new URL("readiness.json.tmp", root);
  await writeFile(temporary, JSON.stringify(data, null, 2) + "\n");
  await rename(temporary, new URL("readiness.json", root));
  console.log(JSON.stringify(data.counts, null, 2));
}
