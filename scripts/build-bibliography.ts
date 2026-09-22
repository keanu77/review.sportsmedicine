/** Refresh durable public bibliography. Never writes reviews-index.json or changes free/full-text claims.
 * node --import tsx scripts/build-bibliography.ts [--limit N] [--refresh]
 * Cache contains public API responses only; an explicit --refresh bypasses the 30-day positive cache.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { identifiersOf, paperAliases, canonicalPaperId, uniquePapers, normalizedTitle } from "../src/identity.ts";
import { createBibliographyIndex, selectBibliography } from "../src/enrich.ts";
import { resolveCandidates, type EuropePmcResult } from "./bibliography-source.ts";
import type { BibliographyData, BibliographyEntry, Item, ReviewsData } from "../src/types.ts";

const root = new URL("../", import.meta.url);
const output = new URL("public/data/bibliography.json", root);
const input: ReviewsData = JSON.parse(await readFile(new URL("public/data/reviews-index.json", root), "utf8"));
const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg < 0 ? Infinity : Number(args[limitArg + 1]);
if (!(limit > 0)) throw new Error("--limit must be positive");
const refresh = args.includes("--refresh");
const cacheDir = process.env.BIBLIOGRAPHY_CACHE_DIR || join(tmpdir(), "review-public-bibliography-cache-v1");
await mkdir(cacheDir, { recursive: true });
const now = new Date().toISOString();
let previous: BibliographyData = { version: 1, generatedAt: now, records: [], unresolved: [] };
try { previous = JSON.parse(await readFile(output, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
if (previous.version !== 1 || !Array.isArray(previous.records)) throw new Error("Unsupported bibliography overlay");
const records = [...previous.records];
const unresolved = new Map(previous.unresolved.map(entry => [entry.key, entry]));
const allItems = uniquePapers(input.items);
const initialIndex = createBibliographyIndex(records);
const pending = allItems.filter(item => refresh || !selectBibliography(item, initialIndex)).slice(0, limit);
let requests = 0, cached = 0, examined = 0, matched = 0, nextRequestAt = 0, sourceFailures = 0, consecutiveFailures = 0;
let savedSignature = JSON.stringify({ records: previous.records, unresolved: previous.unresolved });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const cacheTtl = 30 * 24 * 60 * 60 * 1000;

async function querySource(query: string): Promise<{ result: EuropePmcResult[]; verifiedAt: string }> {
  const key = createHash("sha256").update(query).digest("hex");
  const path = join(cacheDir, `${key}.json`);
  if (!refresh) {
    try {
      const result = JSON.parse(await readFile(path, "utf8"));
      const age = Date.now() - Date.parse(result.verifiedAt);
      if (age >= 0 && age < (result.result.length ? cacheTtl : 24 * 60 * 60 * 1000)) { cached++; return result; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await pause(Math.max(0, nextRequestAt - Date.now()));
    nextRequestAt = Date.now() + 650;
    requests++;
    try {
      const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
      url.search = new URLSearchParams({ query, resultType: "core", format: "json", pageSize: "1000" }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "sportsmedicine-review-bibliography/1.0 (public bibliographic metadata)" } });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw new Error(`Non-retryable HTTP ${response.status}`);
        const retryAfter = Number(response.headers.get("retry-after"));
        await pause(Math.min(10_000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt));
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await response.json();
      if (!Number.isFinite(body.hitCount) || !Array.isArray(body.resultList?.result)) throw new Error(`Invalid Europe PMC response${body.errMsg ? `: ${String(body.errMsg).slice(0, 100)}` : ""}`);
      if (body.hitCount > body.resultList.result.length) throw new Error("Ambiguous query exceeded page size; no candidates accepted");
      const result = { verifiedAt: new Date().toISOString(), result: body.resultList.result as EuropePmcResult[] };
      await writeFile(`${path}.tmp`, JSON.stringify(result));
      await rename(`${path}.tmp`, path);
      return result;
    } catch (error) {
      if (attempt === 2 || String(error).includes("Non-retryable")) throw error;
      await pause(500 * 2 ** attempt);
    }
  }
  throw new Error("Source retry budget exhausted");
}

function addRecord(item: Item, record: BibliographyEntry) {
  const old = records.findIndex(existing => existing.sourceUrl === record.sourceUrl && normalizedTitle(existing.title) === normalizedTitle(record.title));
  if (old >= 0) records[old] = record; else records.push(record);
  unresolved.delete(canonicalPaperId(item));
  matched++;
}
function markUnresolved(item: Item, reason: string, checkedAt?: string) {
  const key = canonicalPaperId(item), old = unresolved.get(key);
  unresolved.set(key, { key, title: item.title, reason, checkedAt: checkedAt || (old?.reason === reason ? old.checkedAt : new Date().toISOString()) });
}
async function save() {
  const signature = JSON.stringify({ records, unresolved: [...unresolved.values()] });
  if (signature === savedSignature) return;
  const data: BibliographyData = { version: 1, generatedAt: new Date().toISOString(), records, unresolved: [...unresolved.values()] };
  await writeFile(new URL("public/data/bibliography.json.tmp", root), JSON.stringify(data, null, 2) + "\n");
  await rename(new URL("public/data/bibliography.json.tmp", root), output);
  savedSignature = signature;
}
const quote = (value: string) => `"${value.replace(/["\\]/g, " ")}"`;
const identifierQuery = (item: Item) => {
  const ids = identifiersOf(item);
  if (ids.doi) return `DOI:${quote(ids.doi)}`;
  if (ids.pmid) return `(EXT_ID:${ids.pmid} AND SRC:MED)`;
  if (ids.pmcid) return `PMCID:${ids.pmcid}`;
  return null;
};

const withIds = pending.filter(item => identifierQuery(item));
const titleQueue = pending.filter(item => !identifierQuery(item));
for (let offset = 0; offset < withIds.length; offset += 25) {
  const batch = withIds.slice(offset, offset + 25);
  try {
    const response = await querySource(batch.map(identifierQuery).join(" OR "));
    consecutiveFailures = 0;
    for (const item of batch) {
      const resolved = resolveCandidates(item, response.result, response.verifiedAt);
      if (resolved.record) { addRecord(item, resolved.record); examined++; }
      else titleQueue.push(item);
    }
  } catch (error) {
    sourceFailures++; consecutiveFailures++;
    for (const item of batch) { markUnresolved(item, `source-unavailable: ${String(error).slice(0, 160)}`); examined++; }
  }
  await save();
  console.log(JSON.stringify({ phase: "identifiers", examined, matched, requests, cached }));
  if (consecutiveFailures >= 3) break;
}
for (const item of titleQueue) {
  if (consecutiveFailures >= 3) break;
  if (!item.year) { markUnresolved(item, "title-match-requires-year"); examined++; continue; }
  try {
    const response = await querySource(`TITLE:${quote(item.title)} AND FIRST_PDATE:[${item.year - 1}-01-01 TO ${item.year + 1}-12-31]`);
    consecutiveFailures = 0;
    const resolved = resolveCandidates(item, response.result, response.verifiedAt);
    if (resolved.record) addRecord(item, resolved.record); else markUnresolved(item, resolved.reason || "unresolved", response.verifiedAt);
  } catch (error) { sourceFailures++; consecutiveFailures++; markUnresolved(item, `source-unavailable: ${String(error).slice(0, 160)}`); }
  examined++;
  if (examined % 10 === 0) { await save(); console.log(JSON.stringify({ phase: "titles", examined, matched, requests, cached })); }
}
await save();
const finalIndex = createBibliographyIndex(records);
const resolvedItems = allItems.filter(item => selectBibliography(item, finalIndex));
console.log(JSON.stringify({ totalRaw: input.items.length, totalUnique: allItems.length, examined, newlyMatched: matched,
  resolved: resolvedItems.length, unresolved: allItems.length - resolvedItems.length,
  matchedByIdentifier: resolvedItems.filter(item => selectBibliography(item, finalIndex)?.matchMethod === "identifier").length,
  matchedByTitleYear: resolvedItems.filter(item => selectBibliography(item, finalIndex)?.matchMethod === "exact-title-year").length,
  durableRecords: records.length, requests, cached, sourceFailures,
  previouslySavedAliases: resolvedItems.reduce((count, item) => count + paperAliases(item).length, 0), output: output.pathname }, null, 2));
if (sourceFailures) process.exitCode = 1;
