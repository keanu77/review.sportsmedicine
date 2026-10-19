import { canonicalPaperId, compatibleIdentifiers, identifiersOf, paperAliases } from "./identity";
import type { BibliographyEntry, FullTextMetadata, Item, SourceAbstract } from "./types";

export const LIBRARY_KEY = "review.library.v1";
export const LIBRARY_MAX_BYTES = 4 * 1024 * 1024;
export const LIBRARY_MAX_ENTRIES = 2000;
export const RECENT_MAX = 20;
export type ReadStatus = "pending" | "read";
export type LibraryStorageStatus = "loading" | "saved" | "memory-only";
export interface LibraryEntry {
  id: string;
  aliases: string[];
  starred: boolean;
  readStatus: ReadStatus;
  statusUpdatedAt: number;
  savedAt: number;
  updatedAt: number;
  snapshot: Item | null;
}
export interface LibraryData { version: 1; entries: LibraryEntry[]; recent: string[] }
export interface LibraryBackup extends LibraryData { format: "review-library"; exportedAt: string }
export interface LibraryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface StorageResult { status: LibraryStorageStatus; message: string | null }
export const emptyLibrary = (): LibraryData => ({ version: 1, entries: [], recent: [] });
const unique = (values: string[]) => [...new Set(values)];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new Error("備份包含不正確或過長的文字欄位。");
  return value;
}
function strings(value: unknown, maxCount = 100, maxLength = 1000): string[] {
  if (!Array.isArray(value) || value.length > maxCount) throw new Error("備份的清單格式或筆數不正確。");
  return unique(value.map(v => text(v, maxLength, true)));
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) throw new Error("備份的時間格式不正確。");
  return value;
}
export function safeLibraryUrl(value: unknown): string {
  const raw = text(value, 4096, true);
  if (raw !== raw.trim() || /\s/.test(raw)) throw new Error("備份包含不安全的連結。");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("備份包含無效的連結。"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("備份只接受 HTTP 或 HTTPS 文獻連結。");
  return raw;
}
function snapshotFullText(value: unknown): FullTextMetadata {
  if (!object(value) || !["verified", "inferred", "unknown"].includes(String(value.status))) throw new Error("備份的全文來源格式不正確。");
  const fullText: FullTextMetadata = { status: value.status as FullTextMetadata["status"] };
  for (const key of ["url", "pdfUrl", "sourceUrl", "licenseUrl"] as const) if (value[key] != null) fullText[key] = safeLibraryUrl(value[key]);
  for (const key of ["verifiedAt", "license", "reason"] as const) if (value[key] != null) fullText[key] = text(value[key], 2000);
  if (fullText.verifiedAt && !Number.isFinite(Date.parse(fullText.verifiedAt))) throw new Error("備份的全文查核日期不正確。");
  return fullText;
}
function snapshotAbstract(value: unknown): SourceAbstract {
  if (!object(value) || (value.source !== "Europe PMC" && value.source !== "PubMed")) throw new Error("備份的摘要來源格式不正確。");
  const result: SourceAbstract = { text: text(value.text, 60000, true), source: value.source, sourceUrl: safeLibraryUrl(value.sourceUrl), verifiedAt: text(value.verifiedAt, 100, true) };
  if (!Number.isFinite(Date.parse(result.verifiedAt))) throw new Error("備份的摘要查核日期不正確。");
  if (value.excerptOnly != null) {
    if (typeof value.excerptOnly !== "boolean") throw new Error("備份的摘要節錄標記不正確。");
    result.excerptOnly = value.excerptOnly;
  }
  if (value.license != null) result.license = text(value.license, 2000);
  if (result.excerptOnly && (result.text.trim().split(/\s+/).length > 25 || value.sections != null)) throw new Error("摘要節錄最多 25 個字詞，且不能包含完整段落資料。");
  if (value.sections != null) {
    if (!Array.isArray(value.sections) || value.sections.length > 100) throw new Error("備份的摘要段落格式不正確。");
    result.sections = value.sections.map(section => {
      if (!object(section)) throw new Error("備份的摘要段落格式不正確。");
      return { label: text(section.label, 1000), text: text(section.text, 60000) };
    });
  }
  return result;
}
/** Project onto known fields; untrusted imported objects never become rendered props verbatim. */
export function snapshotItem(value: unknown): Item {
  if (!object(value)) throw new Error("備份缺少文獻資料。");
  const year = value.year;
  if (year !== null && (typeof year !== "number" || !Number.isInteger(year) || year < 1000 || year > 9999)) throw new Error("備份的發表年份不正確。");
  if (typeof value.free !== "boolean") throw new Error("備份的全文狀態不正確。");
  const item: Item = { title: text(value.title, 4000, true), year, url: safeLibraryUrl(value.url), source: text(value.source, 1000),
    tldr: value.tldr == null ? null : text(value.tldr, 30000), free: value.free, region: text(value.region, 1000), disease: text(value.disease, 1000),
    themes: strings(value.themes), populations: strings(value.populations) };
  for (const key of ["journal", "doi", "pmid", "pmcid", "volume", "issue", "pages", "firstPublicationDate", "tldrSource"] as const) {
    if (value[key] != null) item[key] = text(value[key], key === "doi" ? 2000 : 1000);
  }
  if (value.freeUrl) item.freeUrl = safeLibraryUrl(value.freeUrl);
  if (value.authors != null) item.authors = strings(value.authors, 500, 1000);
  if (value.diseases != null) item.diseases = strings(value.diseases);
  if (value.identityAliases != null) item.identityAliases = strings(value.identityAliases);
  if (value.origin === "kb" || value.origin === "pubmed") item.origin = value.origin;
  if (typeof value.impactFactor === "number" && Number.isFinite(value.impactFactor) && value.impactFactor >= 0) item.impactFactor = value.impactFactor;
  if (value.fullText != null) item.fullText = snapshotFullText(value.fullText);
  if (value.abstract != null) item.abstract = snapshotAbstract(value.abstract);
  if (value.bibliography != null) {
    const b = value.bibliography;
    if (!object(b) || !["Europe PMC", "Crossref"].includes(String(b.source)) || !["identifier", "exact-title-year"].includes(String(b.matchMethod))) throw new Error("備份的書目來源格式不正確。");
    const sourceUrl = safeLibraryUrl(b.sourceUrl);
    const verifiedAt = text(b.verifiedAt, 100, true);
    if (!Number.isFinite(Date.parse(verifiedAt))) throw new Error("備份的書目查核日期不正確。");
    // Reuse field validation without recursively admitting an embedded bibliography.
    const metadata = snapshotItem({ ...b, bibliography: undefined, url: sourceUrl, free: false, tldr: null, region: "", disease: "", themes: [], populations: [] });
    item.bibliography = { title: metadata.title, year: metadata.year, authors: metadata.authors ?? [], source: b.source as BibliographyEntry["source"], sourceUrl, verifiedAt, matchMethod: b.matchMethod as BibliographyEntry["matchMethod"] };
    if (metadata.fullText) item.bibliography.fullText = metadata.fullText;
    if (metadata.abstract) item.bibliography.abstract = metadata.abstract;
    for (const key of ["firstPublicationDate", "doi", "pmid", "pmcid", "journal", "volume", "issue", "pages"] as const) {
      if (metadata[key] != null) item.bibliography[key] = metadata[key];
    }
  }
  return item;
}
function validateEntry(value: unknown): LibraryEntry {
  if (!object(value) || typeof value.starred !== "boolean" || (value.readStatus !== "pending" && value.readStatus !== "read")) throw new Error("備份的閱讀紀錄格式不正確。");
  const snapshot = value.snapshot == null ? null : snapshotItem(value.snapshot);
  const originalId = text(value.id, 1000, true);
  return { id: snapshot ? canonicalPaperId(snapshot) : originalId, aliases: unique([...strings(value.aliases), originalId, ...(snapshot ? paperAliases(snapshot) : [])]),
    starred: value.starred, readStatus: value.readStatus, statusUpdatedAt: timestamp(value.statusUpdatedAt), savedAt: timestamp(value.savedAt), updatedAt: timestamp(value.updatedAt), snapshot };
}
function validateData(value: unknown): LibraryData {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > LIBRARY_MAX_ENTRIES) throw new Error("無法讀取備份版本，或文獻超過 2,000 筆上限。");
  return { version: 1, entries: mergeEntries([], value.entries.map(validateEntry)), recent: strings(value.recent, RECENT_MAX) };
}
export function parseLibraryBackup(raw: string): LibraryData {
  if (new TextEncoder().encode(raw).length > LIBRARY_MAX_BYTES) throw new Error("備份超過 4 MB 上限。");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("這不是有效的 JSON 備份檔。"); }
  if (!object(parsed) || parsed.format !== "review-library" || typeof parsed.exportedAt !== "string" || !Number.isFinite(Date.parse(parsed.exportedAt))) throw new Error("請選擇本站匯出的文獻庫備份。");
  return validateData(parsed);
}
export function serializeLibraryBackup(data: LibraryData, now = new Date()): string {
  return JSON.stringify({ format: "review-library", version: 1, exportedAt: now.toISOString(), entries: data.entries, recent: data.recent } satisfies LibraryBackup);
}
function fitsBackup(data: LibraryData): boolean {
  return new TextEncoder().encode(serializeLibraryBackup(data)).length <= LIBRARY_MAX_BYTES;
}
function checkSize(data: LibraryData): LibraryData {
  if (!fitsBackup(data)) throw new Error("文獻庫超過 4 MB 上限，請先備份並移除部分收藏。");
  return data;
}
function matchingEntries(entries: LibraryEntry[], incoming: LibraryEntry): LibraryEntry[] {
  const sameId = entries.filter(entry => entry.id === incoming.id && compatibleEntries(entry, incoming));
  if (sameId.length) return sameId;
  const aliases = new Set([incoming.id, ...incoming.aliases]);
  const matches = entries.filter(entry => compatibleEntries(entry, incoming) && [entry.id, ...entry.aliases].some(alias => aliases.has(alias)));
  // A shared title alone must not bridge distinct DOI / PMID records.
  return matches.every((entry, i) => matches.slice(i + 1).every(other => compatibleEntries(entry, other))) ? matches : [];
}
function compatibleEntries(a: LibraryEntry, b: LibraryEntry): boolean {
  return !a.snapshot || !b.snapshot || compatibleIdentifiers(identifiersOf(a.snapshot), identifiersOf(b.snapshot));
}
export function mergeEntries(existing: LibraryEntry[], incoming: LibraryEntry[]): LibraryEntry[] {
  let result = [...existing];
  for (const entry of incoming) {
    const matches = matchingEntries(result, entry);
    let merged = entry;
    for (const previous of matches) {
      const status = previous.statusUpdatedAt > merged.statusUpdatedAt ? previous : merged;
      const metadata = previous.snapshot && (!merged.snapshot || previous.updatedAt > merged.updatedAt) ? previous : merged;
      merged = { ...metadata, id: metadata.snapshot ? canonicalPaperId(metadata.snapshot) : merged.id,
        aliases: unique([merged.id, previous.id, ...previous.aliases, ...merged.aliases]), starred: previous.starred || merged.starred,
        readStatus: status.readStatus, statusUpdatedAt: status.statusUpdatedAt, savedAt: Math.min(previous.savedAt, merged.savedAt), updatedAt: Math.max(previous.updatedAt, merged.updatedAt) };
    }
    result = result.filter(value => !matches.includes(value));
    result.push(merged);
  }
  if (result.length > LIBRARY_MAX_ENTRIES) throw new Error("文獻庫超過 2,000 筆上限，請先匯出備份並移除部分收藏。");
  return result;
}
export function mergeLibrary(data: LibraryData, incoming: LibraryData): LibraryData {
  const entries = mergeEntries(data.entries, incoming.entries);
  return checkSize({ version: 1, entries, recent: unique([...incoming.recent, ...data.recent]).slice(0, RECENT_MAX) });
}
function legacyList(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.length > LIBRARY_MAX_BYTES) throw new Error("legacy size");
  const parsed: unknown = JSON.parse(raw);
  return strings(parsed, LIBRARY_MAX_ENTRIES);
}
export function loadLibrary(storage: LibraryStorage | null): { data: LibraryData } & StorageResult {
  if (!storage) return { data: emptyLibrary(), status: "memory-only", message: "瀏覽器不允許儲存；這次的變更只保留到頁面關閉，請匯出備份。" };
  try {
    const raw = storage.getItem(LIBRARY_KEY);
    if (raw) {
      if (new TextEncoder().encode(raw).length > LIBRARY_MAX_BYTES) throw new Error("size");
      return { data: validateData(JSON.parse(raw)), status: "saved", message: null };
    }
    const stars = legacyList(storage.getItem("review.stars"));
    const recent = legacyList(storage.getItem("review.recent")).slice(0, RECENT_MAX);
    return { data: { version: 1, recent, entries: unique([...stars, ...recent]).slice(0, LIBRARY_MAX_ENTRIES).map(id => ({ id, aliases: [id], starred: stars.includes(id), readStatus: "pending", statusUpdatedAt: 0, savedAt: 0, updatedAt: 0, snapshot: null })) }, status: "saved", message: null };
  } catch {
    return { data: emptyLibrary(), status: "memory-only", message: "無法讀取瀏覽器中的文獻庫；資料可能受損或儲存遭封鎖。請匯入先前備份，新的變更請另存備份。" };
  }
}
export function saveLibrary(storage: LibraryStorage | null, data: LibraryData): StorageResult {
  try {
    if (!storage) throw new Error("unavailable");
    const serialized = JSON.stringify(data);
    if (new TextEncoder().encode(serialized).length > LIBRARY_MAX_BYTES) throw new Error("size");
    storage.setItem(LIBRARY_KEY, serialized);
  } catch {
    return { status: "memory-only", message: "儲存失敗（空間不足或瀏覽器限制）；本次變更僅在這個分頁中，請立即匯出備份。" };
  }
  try {
    storage!.setItem("review.stars", JSON.stringify(data.entries.filter(entry => entry.starred).map(entry => entry.id)));
    storage!.setItem("review.recent", JSON.stringify(data.recent));
  } catch {
    return { status: "saved", message: "文獻庫已儲存，但舊版收藏格式未能同步。請匯出備份以便移轉。" };
  }
  return { status: "saved", message: null };
}
export function refreshLibrarySnapshots(data: LibraryData, catalog: Item[], now = Date.now()): LibraryData {
  const byAlias = new Map<string, Item[]>();
  for (const item of catalog) for (const alias of paperAliases(item)) byAlias.set(alias, [...(byAlias.get(alias) ?? []), item]);
  let changed = false;
  const entries = data.entries.map(entry => {
    const exact = (byAlias.get(entry.id) ?? []).filter(item => canonicalPaperId(item) === entry.id);
    const candidates = uniqueItems(exact.length ? exact : [entry.id, ...entry.aliases].flatMap(alias => byAlias.get(alias) ?? []))
      .filter(item => !entry.snapshot || compatibleIdentifiers(identifiersOf(entry.snapshot), identifiersOf(item)));
    if (candidates.length !== 1) return entry;
    let snapshot: Item;
    try { snapshot = snapshotItem(candidates[0]); } catch { return entry; }
    const id = canonicalPaperId(snapshot), aliases = unique([entry.id, ...entry.aliases, ...paperAliases(snapshot)]);
    if (id === entry.id && JSON.stringify(snapshot) === JSON.stringify(entry.snapshot) && JSON.stringify(aliases) === JSON.stringify(entry.aliases)) return entry;
    changed = true;
    return { ...entry, id, aliases, snapshot, updatedAt: now };
  });
  if (!changed) return data;
  const merged = mergeEntries([], entries);
  const refreshed: LibraryData = { version: 1, entries: merged, recent: unique(data.recent.map(key => merged.find(entry => entry.id === key || entry.aliases.includes(key))?.id ?? key)).slice(0, RECENT_MAX) };
  // Preserve the last usable snapshots when catalog expansion would make the backup unimportable.
  return fitsBackup(refreshed) ? refreshed : data;
}
function uniqueItems(items: Item[]): Item[] { return [...new Set(items)]; }
export function libraryReadStatus(data: LibraryData, key: string, aliases: string[] = [key]): ReadStatus {
  const direct = data.entries.find(entry => entry.id === key);
  if (direct) return direct.readStatus;
  const requested = new Set([key, ...aliases]);
  const strong = /^(?:doi:|pmid:|pmc\d)/i;
  const matches = data.entries.filter(entry => {
    if (!entry.aliases.some(alias => requested.has(alias))) return false;
    if (!strong.test(key) || !entry.snapshot) return true;
    // Only actual source identifiers can establish a cross-identifier status match.
    const ids = identifiersOf(entry.snapshot);
    const explicit = [ids.doi && `doi:${ids.doi}`, ids.pmid && `pmid:${ids.pmid}`, ids.pmcid?.toLowerCase()].filter((id): id is string => Boolean(id));
    return !explicit.length || explicit.some(id => requested.has(id));
  });
  return matches.length === 1 ? matches[0].readStatus : "pending";
}
export function updateLibraryEntry(data: LibraryData, key: string, aliases: string[], item: Item | undefined, change: "toggle-star" | "visit" | ReadStatus, now = Date.now()): LibraryData {
  const snapshot = item ? snapshotItem(item) : null;
  const candidate: LibraryEntry = { id: snapshot ? canonicalPaperId(snapshot) : key, aliases: unique([key, ...aliases, ...(snapshot ? paperAliases(snapshot) : [])]), starred: false, readStatus: "pending", statusUpdatedAt: 0, savedAt: now, updatedAt: now, snapshot };
  const matches = matchingEntries(data.entries, candidate);
  const merged = mergeEntries(matches, [candidate])[0];
  if (change === "toggle-star") merged.starred = !matches.some(entry => entry.starred);
  if (change === "pending" || change === "read") { merged.readStatus = change; merged.statusUpdatedAt = now; merged.starred = true; }
  const recent = change === "visit" ? [merged.id, ...data.recent.filter(value => !merged.aliases.includes(value) && value !== merged.id)].slice(0, RECENT_MAX) : data.recent;
  const entries = [merged, ...data.entries.filter(entry => !matches.includes(entry))]
    .filter(entry => entry.starred || entry.readStatus === "read" || recent.some(id => id === entry.id || entry.aliases.includes(id)));
  if (entries.length > LIBRARY_MAX_ENTRIES) throw new Error("文獻庫已達 2,000 筆上限，請先備份並移除部分收藏。");
  return checkSize({ version: 1, entries, recent });
}
