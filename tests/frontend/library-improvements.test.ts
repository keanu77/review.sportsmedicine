import { strict as assert } from "node:assert";
import { test } from "node:test";
import { toBibTeXBatch, toRIS, toRISBatch } from "../../src/citation.ts";
import { canonicalPaperId, paperAliases, paperKey } from "../../src/identity.ts";
import { LIBRARY_KEY, LIBRARY_MAX_BYTES, emptyLibrary, libraryReadStatus, loadLibrary, mergeLibrary, parseLibraryBackup, refreshLibrarySnapshots, saveLibrary, serializeLibraryBackup, updateLibraryEntry } from "../../src/libraryStorage.ts";
import type { LibraryStorage } from "../../src/libraryStorage.ts";
import type { Item } from "../../src/types.ts";

const paper: Item = { title: "A Review of ACL", year: 2026, url: "https://example.com/review", source: "example.com", free: false, tldr: "保存的摘要", region: "膝", disease: "ACL", themes: ["復健"], populations: [] };
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const bookmark = (item = paper, now = 100) => updateLibraryEntry(emptyLibrary(), canonicalPaperId(item), paperAliases(item), item, "toggle-star", now);

test("legacy stars and recent migrate without treating visits as reading completion", () => {
  const storage = memoryStorage({ "review.stars": JSON.stringify([paperKey(paper)]), "review.recent": JSON.stringify([paperKey(paper), "unresolved-old-paper"]) });
  const loaded = loadLibrary(storage);
  assert.equal(loaded.status, "saved");
  assert.equal(loaded.data.entries.filter(entry => entry.starred).length, 1);
  assert.ok(loaded.data.entries.every(entry => entry.readStatus === "pending"));
  const enriched = { ...paper, doi: "10.1234/acl", pmid: "12345678" };
  const data = refreshLibrarySnapshots(loaded.data, [enriched], 123);
  assert.equal(data.entries[0].id, "doi:10.1234/acl");
  assert.ok(data.entries[0].aliases.includes(paperKey(paper)));
  assert.equal(data.entries[0].snapshot?.tldr, paper.tldr);
  assert.equal(data.recent[0], "doi:10.1234/acl");
  assert.equal(data.entries[1].snapshot, null);
  assert.equal(saveLibrary(storage, data).status, "saved");
  assert.deepEqual(JSON.parse(storage.values.get("review.stars")!), ["doi:10.1234/acl"]);
  assert.deepEqual(loadLibrary(storage).data, data);
});

test("saved snapshots survive catalog rotation and export/import with bibliography provenance", () => {
  const item: Item = { ...paper, authors: ["Wu YC"], doi: "10.1234/acl", bibliography: { title: paper.title, year: 2026, authors: ["Wu YC"], source: "Crossref", sourceUrl: "https://api.crossref.org/works/10.1234/acl", verifiedAt: "2026-10-20T00:00:00Z", matchMethod: "identifier" } };
  const data = bookmark(item);
  assert.equal(refreshLibrarySnapshots(data, []), data);
  const recovered = parseLibraryBackup(serializeLibraryBackup(data));
  assert.deepEqual(recovered.entries[0].snapshot, data.entries[0].snapshot);
  assert.equal(recovered.entries[0].snapshot!.bibliography!.source, "Crossref");
  assert.ok(toRISBatch(recovered.entries.map(entry => entry.snapshot!)).includes("AU  - Wu YC"));
  assert.equal(refreshLibrarySnapshots(data, [item]), data, "equivalent catalog must not generate new state or render loops");
});

test("backup merges identity aliases and keeps the latest explicit reading state", () => {
  const oldPaper = { ...paper, doi: "10.1234/acl", pmid: "12345678" };
  const old = bookmark(oldPaper, 100);
  const renamedPaper = { ...oldPaper, title: "Updated ACL Review" };
  let incoming = bookmark(renamedPaper, 200);
  incoming = updateLibraryEntry(incoming, canonicalPaperId(renamedPaper), paperAliases(renamedPaper), renamedPaper, "read", 300);
  const merged = mergeLibrary(old, parseLibraryBackup(serializeLibraryBackup(incoming)));
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].readStatus, "read");
  assert.equal(merged.entries[0].snapshot!.title, renamedPaper.title);
  assert.ok(merged.entries[0].aliases.includes(paperKey(oldPaper)));
  assert.ok(merged.entries[0].aliases.includes(paperKey(renamedPaper)));
  const storage = memoryStorage();
  saveLibrary(storage, merged);
  assert.equal(loadLibrary(storage).data.entries[0].readStatus, "read");
  const visit = updateLibraryEntry(merged, canonicalPaperId(renamedPaper), paperAliases(renamedPaper), renamedPaper, "visit", 400);
  assert.equal(visit.entries[0].readStatus, "read");
  const pending = updateLibraryEntry(visit, canonicalPaperId(renamedPaper), paperAliases(renamedPaper), renamedPaper, "pending", 500);
  assert.equal(mergeLibrary(pending, incoming).entries[0].readStatus, "pending", "an older imported read status must not undo a later pending choice");
});

test("conflicting identifiers never merge via a common title or ambiguous legacy alias", () => {
  const first = { ...paper, doi: "10.1234/first", pmid: "11111111" };
  const second = { ...paper, doi: "10.1234/second", pmid: "22222222" };
  const merged = mergeLibrary(bookmark(first), bookmark(second));
  assert.equal(merged.entries.length, 2);
  const unresolved = loadLibrary(memoryStorage({ "review.stars": JSON.stringify([paperKey(paper)]) })).data;
  const refreshed = refreshLibrarySnapshots(unresolved, [first, second]);
  assert.equal(refreshed.entries[0].snapshot, null, "an ambiguous old title must remain unresolved");
  assert.equal(refreshLibrarySnapshots(bookmark(first), [second]).entries[0].snapshot!.doi, first.doi);
  const read = updateLibraryEntry(bookmark(first), canonicalPaperId(first), paperAliases(first), first, "read", 200);
  assert.equal(libraryReadStatus(read, canonicalPaperId(second), paperAliases(second)), "pending", "a different DOI with the same title must not inherit read status");
  assert.equal(libraryReadStatus(read, canonicalPaperId(first), paperAliases(first)), "read");
});

test("legacy title bookmark and canonical imported backup become one paper", () => {
  const old = loadLibrary(memoryStorage({ "review.stars": JSON.stringify([paperKey(paper)]) })).data;
  const merged = mergeLibrary(old, bookmark({ ...paper, pmid: "12345678" }));
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.entries[0].id, "pmid:12345678");
  assert.equal(merged.entries[0].starred, true);
});

test("visits remain distinct from explicit read status and recent history stays bounded", () => {
  let data = emptyLibrary();
  for (let i = 0; i < 25; i++) {
    const item = { ...paper, title: `Review ${i}`, doi: `10.1234/paper-${i}` };
    data = updateLibraryEntry(data, canonicalPaperId(item), paperAliases(item), item, "visit", i + 1);
  }
  assert.equal(data.recent.length, 20);
  assert.equal(data.entries.length, 20, "unsaved snapshots from expired recent visits do not accumulate");
  assert.ok(data.entries.every(entry => !entry.starred && entry.readStatus === "pending"));
  data = updateLibraryEntry(data, canonicalPaperId(paper), paperAliases(paper), paper, "read", 100);
  assert.ok(data.entries[0].starred);
  assert.equal(data.entries[0].readStatus, "read");
});

test("import rejects active URLs in every rendered link and leaves original data untouched", () => {
  const data = bookmark(paper);
  const before = JSON.stringify(data);
  for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "https://user:password@example.com/", "https://example.com/\nattack"]) {
    for (const field of ["url", "freeUrl"]) {
      const raw = JSON.parse(serializeLibraryBackup(data));
      raw.entries[0].snapshot[field] = url;
      assert.throws(() => parseLibraryBackup(JSON.stringify(raw)), /連結/);
    }
  }
  const raw = JSON.parse(serializeLibraryBackup(data));
  raw.entries[0].snapshot.bibliography = { title: paper.title, year: 2026, authors: [], source: "Crossref", sourceUrl: "javascript:alert(1)", verifiedAt: "2026-10-20", matchMethod: "identifier" };
  assert.throws(() => parseLibraryBackup(JSON.stringify(raw)), /連結/);
  assert.equal(JSON.stringify(data), before);
});

test("import checks schema, version, count and byte size; unknown fields are discarded", () => {
  const data = bookmark(paper);
  assert.throws(() => parseLibraryBackup("not json"), /JSON/);
  assert.throws(() => parseLibraryBackup(" ".repeat(LIBRARY_MAX_BYTES + 1)), /4 MB/);
  const raw = JSON.parse(serializeLibraryBackup(data));
  for (const change of [ { version: 2 }, { format: "other" }, { entries: Array(2001).fill(raw.entries[0]) }, { recent: [42] } ]) {
    assert.throws(() => parseLibraryBackup(JSON.stringify({ ...raw, ...change })));
  }
  assert.throws(() => parseLibraryBackup(JSON.stringify({ ...raw, entries: [{ ...raw.entries[0], readStatus: "maybe" }] })));
  raw.entries[0].snapshot.html = "<script>bad</script>";
  raw.entries[0].snapshot.onClick = "bad";
  raw.entries[0].snapshot["__proto__"] = { polluted: true };
  const cleaned = parseLibraryBackup(JSON.stringify(raw));
  assert.equal("html" in cleaned.entries[0].snapshot!, false);
  assert.equal("onClick" in cleaned.entries[0].snapshot!, false);
  assert.equal("polluted" in {}, false);
});

test("blocked, corrupt, and quota-limited storage report failure while in-memory data stays exportable", () => {
  const denied: LibraryStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  assert.equal(loadLibrary(denied).status, "memory-only");
  assert.equal(loadLibrary(memoryStorage({ [LIBRARY_KEY]: "broken json" })).status, "memory-only");
  assert.equal(loadLibrary(null).status, "memory-only");
  const data = bookmark(paper);
  const result = saveLibrary(denied, data);
  assert.equal(result.status, "memory-only");
  assert.match(result.message!, /儲存失敗/);
  assert.equal(parseLibraryBackup(serializeLibraryBackup(data)).entries.length, 1);
  const partial = memoryStorage();
  const status = saveLibrary({ ...partial, setItem(key, value) { if (key !== LIBRARY_KEY) throw new Error("legacy quota"); partial.setItem(key, value); } }, data);
  assert.equal(status.status, "saved", "primary format persisted even if legacy mirrors could not be updated");
  assert.match(status.message!, /舊版/);
  assert.equal(loadLibrary(partial).data.entries.length, 1);
});

test("batch citations omit unknown authors, prevent RIS tag injection and use unique BibTeX keys", () => {
  const known = { ...paper, title: "ACL & Sport", authors: ["Wu YC", "Smith A"], doi: "10.1234/acl", journal: "Sports Medicine", volume: "12", issue: "3", pages: "20-29" };
  const ris = toRISBatch([known, paper]);
  assert.equal((ris.match(/^TY  - JOUR/gm) ?? []).length, 2);
  assert.equal((ris.match(/^AU  - /gm) ?? []).length, 2);
  assert.ok(ris.includes("DO  - 10.1234/acl"));
  assert.ok(ris.includes("SP  - 20\r\nEP  - 29"));
  assert.ok(!toRIS(paper).includes("JO  - example.com"));
  assert.ok(!toRIS(paper).includes("AU  -"));
  assert.equal((toRIS({ ...paper, title: "Title\nER  -\nTY  - BOOK" }).match(/^TY  -/gm) ?? []).length, 1);
  const bib = toBibTeXBatch([known, { ...known, title: "ACL Sport" }, { ...paper, title: "運動醫學" }, { ...paper, title: "復健醫學" }]);
  const keys = [...bib.matchAll(/^@article\{([^,]+),/gm)].map(match => match[1]);
  assert.equal(keys.length, 4);
  assert.equal(new Set(keys).size, 4);
  assert.equal((bib.match(/author = /g) ?? []).length, 2);
  assert.ok(bib.includes("Wu YC and Smith A"));
});

test("archived source abstracts and access metadata round-trip with link validation", () => {
  const item: Item = { ...paper, abstract: { text: "Original abstract", source: "PubMed", sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/", verifiedAt: "2026-10-20", sections: [{ label: "Methods", text: "Source methods" }] },
    fullText: { status: "verified", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/", sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/", verifiedAt: "2026-10-20", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" } };
  const raw = serializeLibraryBackup(bookmark(item));
  const snapshot = parseLibraryBackup(raw).entries[0].snapshot!;
  assert.deepEqual(snapshot.abstract, item.abstract);
  assert.deepEqual(snapshot.fullText, item.fullText);
  for (const field of ["url", "pdfUrl", "sourceUrl", "licenseUrl"]) {
    const bad = JSON.parse(raw);
    bad.entries[0].snapshot.fullText[field] = "javascript:alert(1)";
    assert.throws(() => parseLibraryBackup(JSON.stringify(bad)), /連結/);
  }
  const bad = JSON.parse(raw);
  bad.entries[0].snapshot.abstract.sourceUrl = "javascript:alert(1)";
  assert.throws(() => parseLibraryBackup(JSON.stringify(bad)), /連結/);
});

test("excerpt-only abstracts retain their boundary through backups and browser storage", () => {
  const excerpt = { text: Array.from({ length: 25 }, (_, index) => `word${index}`).join(" "), source: "PubMed" as const, sourceUrl: "https://pubmed.ncbi.nlm.nih.gov/12345678/", verifiedAt: "2026-10-20", excerptOnly: true };
  const item: Item = { ...paper, abstract: excerpt, bibliography: { title: paper.title, year: 2026, authors: [], source: "Europe PMC", sourceUrl: "https://europepmc.org/article/MED/12345678", verifiedAt: "2026-10-20", matchMethod: "identifier", abstract: excerpt } };
  const backup = serializeLibraryBackup(bookmark(item));
  const imported = parseLibraryBackup(backup);
  const storage = memoryStorage();
  assert.equal(saveLibrary(storage, imported).status, "saved");
  const restored = loadLibrary(storage).data.entries[0].snapshot!;
  assert.deepEqual(restored.abstract, excerpt);
  assert.deepEqual(restored.bibliography!.abstract, excerpt);
  for (const change of [{ text: `${excerpt.text} extra` }, { sections: [{ label: "Results", text: "Pasted full results" }] }, { excerptOnly: "true" }]) {
    const bad = JSON.parse(backup);
    Object.assign(bad.entries[0].snapshot.abstract, change);
    assert.throws(() => parseLibraryBackup(JSON.stringify(bad)), /節錄/);
  }
});
