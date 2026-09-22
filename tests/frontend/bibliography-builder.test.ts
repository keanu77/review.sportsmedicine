import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { selectBibliography } from "../../src/enrich.ts";
import type { Item } from "../../src/types.ts";

const item: Item = { title: "Resistance training: a systematic review", year: 2025, url: "https://doi.org/10.1234/review", source: "", free: false, tldr: null, region: "", disease: "", themes: [], populations: [] };

test("public metadata builder maps only source bibliographic fields and keeps absent values honest", async () => {
  assert.ok(existsSync(new URL("../../scripts/bibliography-source.ts", import.meta.url)));
  const { europePmcRecord } = await import("../../scripts/bibliography-source.ts");
  const record = europePmcRecord({ id: "12345678", source: "MED", pmid: "12345678", title: item.title, doi: "10.1234/review", pubYear: "2025", authorList: { author: [{ fullName: "Wu YC" }] }, journalInfo: { volume: "4", issue: "2", journal: { title: "Journal of Reviews" } }, pageInfo: "e12", isOpenAccess: "Y", hasPDF: "Y" }, "2026-09-21T00:00:00Z");
  assert.equal(record.authors[0], "Wu YC");
  assert.equal(record.volume, "4");
  assert.equal(record.pmcid, null);
  assert.equal(record.sourceUrl, "https://europepmc.org/article/MED/12345678");
  assert.equal("free" in record, false);
  assert.equal("hasPDF" in record, false);
  assert.equal(selectBibliography(item, [record])?.pmid, "12345678");
});

test("title matching requires compatible year and does not accept a result that conflicts with known PMID", async () => {
  assert.ok(existsSync(new URL("../../scripts/bibliography-source.ts", import.meta.url)));
  const { resolveCandidates } = await import("../../scripts/bibliography-source.ts");
  const raw = { id: "12345678", source: "MED", pmid: "12345678", title: item.title, doi: "10.1234/review", pubYear: "2025" };
  assert.equal(resolveCandidates({ ...item, pmid: "99999999" }, [raw], "2026-09-21").reason, "identity-or-title-conflict");
  assert.equal(resolveCandidates(item, [{ ...raw, title: "Another paper" }], "2026-09-21").record, undefined);
  assert.equal(resolveCandidates(item, [raw], "2026-09-21").record.matchMethod, "identifier");
  assert.equal(resolveCandidates({ ...item, url: "https://publisher.test/paper" }, [raw], "2026-09-21").record.matchMethod, "exact-title-year");
  assert.equal(resolveCandidates({ ...item, url: "https://publisher.test/paper", year: null }, [raw], "2026-09-21").record, undefined);
});

test("equivalent numeric HTML title entities match without broad fuzzy title matching", async () => {
  const { resolveCandidates } = await import("../../scripts/bibliography-source.ts");
  const encoded = { ...item, title: "&#x3b2; activity&#160;and recovery &amp; health" };
  const raw = { id: "12345678", source: "MED", pmid: "12345678", title: "β activity and recovery & health", doi: "10.1234/review", pubYear: "2025" };
  assert.ok(resolveCandidates(encoded, [raw], "2026-09-21").record);
});
