import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { enrichItems, selectBibliography } from "../../src/enrich.ts";
import { europePmcRecord, publicBibliographyRecord, sourceAbstract } from "../../scripts/bibliography-source.ts";
import { publicHttpsUrl } from "../../src/sourceMetadata.ts";
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

const checkedAt = "2026-10-20T01:00:00Z";
const core = { id: "12345678", source: "MED", pmid: "12345678", pmcid: "PMC123456", title: item.title, doi: "10.1234/review", pubYear: "2025" };

test("PMCID and OA flags alone never verify full text; actual source-listed URLs do", () => {
  const candidate = europePmcRecord({ ...core, isOpenAccess: "Y", hasPDF: "Y" }, checkedAt);
  assert.equal(candidate.fullText?.status, "unknown");
  assert.equal(enrichItems([item], {}, {}, [candidate])[0].free, false);
  const record = europePmcRecord({ ...core, license: "cc by", fullTextUrlList: { fullTextUrl: [
    { availabilityCode: "OA", documentStyle: "html", url: "https://europepmc.org/articles/PMC123456" },
    { availabilityCode: "OA", documentStyle: "pdf", url: "https://europepmc.org/articles/PMC123456?pdf=render" },
  ] } }, checkedAt);
  const enriched = enrichItems([item], {}, {}, [record])[0];
  assert.equal(enriched.free, true);
  assert.equal(enriched.freeUrl, "https://europepmc.org/articles/PMC123456");
  assert.equal(enriched.fullText?.pdfUrl, "https://europepmc.org/articles/PMC123456?pdf=render");
  assert.equal(enriched.fullText?.license, "cc by");
  assert.equal(enriched.fullText?.verifiedAt, checkedAt);
  const freeWithoutLicense = europePmcRecord({ ...core, fullTextUrlList: { fullTextUrl: [{ availabilityCode: "F", url: "https://publisher.org/article/free" }] } }, checkedAt);
  assert.equal(freeWithoutLicense.fullText?.status, "verified");
  assert.equal(freeWithoutLicense.fullText?.license, undefined);
});

test("unsafe links, subscription links and mismatched PMCID links cannot claim verified access", () => {
  for (const url of ["javascript:alert(1)", "http://publisher.org/paper", "https://localhost/a", "https://127.0.0.1/a", "https://user:secret@publisher.org/a", "https://publisher.local/a", "https://publisher.org:8443/a"]) assert.equal(publicHttpsUrl(url), undefined);
  const links = ["https://europepmc.org/articles/PMC999", "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/", "https://doi.org/10.9999/wrong", "javascript:alert(1)"];
  for (const url of links) {
    assert.equal(europePmcRecord({ ...core, fullTextUrlList: { fullTextUrl: [{ availabilityCode: "OA", url }] } }, checkedAt).fullText?.status, "unknown");
  }
  assert.equal(europePmcRecord({ ...core, fullTextUrlList: { fullTextUrl: [{ availabilityCode: "S", url: "https://publisher.org/paper" }] } }, checkedAt).fullText?.status, "unknown");
});

test("upstream free heuristics retain their inferred status and never acquire a license", () => {
  const [inferred, unknown] = enrichItems([{ ...item, free: true, freeUrl: "https://publisher.org/paper" }, item], {}, {});
  assert.equal(inferred.fullText?.status, "inferred");
  assert.equal(inferred.free, true);
  assert.equal(inferred.fullText?.license, undefined);
  assert.equal(unknown.fullText?.status, "unknown");
});

test("source abstracts preserve only source sections and do not invent limitations or population", () => {
  const sourceUrl = "https://europepmc.org/article/MED/12345678";
  const abstract = sourceAbstract("<h4>Methods</h4>Included 12 trials.<h4>Results</h4>Evidence &amp; certainty were low.", sourceUrl, checkedAt);
  assert.deepEqual(abstract?.sections, [{ label: "Methods", text: "Included 12 trials." }, { label: "Results", text: "Evidence & certainty were low." }]);
  assert.equal(abstract?.sourceUrl, sourceUrl);
  assert.equal(abstract?.verifiedAt, checkedAt);
  assert.equal(sourceAbstract("No structured sections.", sourceUrl, checkedAt)?.sections, undefined);
  assert.equal(sourceAbstract(undefined, sourceUrl, checkedAt), null);
  const comparison = sourceAbstract("<h4>Results</h4>p < .001; 12 trials, with P > .05 for harms.<h4>Conclusion</h4>Uncertain benefit.", sourceUrl, checkedAt);
  assert.match(comparison!.text, /p < \.001; 12 trials, with P > \.05 for harms/);
});

test("identity conflicts block both abstract and full-text enrichment", () => {
  const record = europePmcRecord({ ...core, abstractText: "This is the verified source abstract.", fullTextUrlList: { fullTextUrl: [{ availabilityCode: "OA", url: "https://europepmc.org/articles/PMC123456" }] } }, checkedAt);
  const enriched = enrichItems([{ ...item, pmid: "99999999" }], {}, {}, [record])[0];
  assert.equal(enriched.abstract, undefined);
  assert.equal(enriched.fullText?.status, "unknown");
  assert.equal(enriched.free, false);
  const injected = { ...item, abstract: { text: "Unmatched upstream abstract", source: "Europe PMC" as const, sourceUrl: "https://europepmc.org/article/MED/99999999", verifiedAt: checkedAt } };
  assert.equal(enrichItems([injected], {}, {}, [])[0].abstract, undefined);
});

test("persisted overlay fields are rechecked for URL safety and source identity", () => {
  const record = europePmcRecord({ ...core, abstractText: "Verified abstract.", fullTextUrlList: { fullTextUrl: [{ availabilityCode: "OA", url: "https://europepmc.org/articles/PMC123456" }] } }, checkedAt);
  const changed = { ...record, fullText: { ...record.fullText!, url: "https://europepmc.org/articles/PMC999999" },
    abstract: { ...record.abstract!, sourceUrl: "https://europepmc.org/article/MED/99999999" } };
  const enriched = enrichItems([item], {}, {}, [changed])[0];
  assert.equal(enriched.fullText?.status, "unknown");
  assert.equal(enriched.abstract, undefined);
  assert.equal(enriched.free, false);
});

test("public source abstracts require a permissive source license; otherwise only a bounded attributed excerpt is emitted", () => {
  const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
  const record = europePmcRecord({ ...core, abstractText: `<h4>Results</h4>${text}`, license: "cc by-nc-nd" }, checkedAt);
  const excerpt = publicBibliographyRecord(record).abstract!;
  assert.equal(excerpt.excerptOnly, true);
  assert.equal(excerpt.text.split(/\s+/).length, 25);
  assert.equal(excerpt.sections, undefined);
  assert.equal(excerpt.sourceUrl, record.sourceUrl);
  assert.equal(record.abstract?.text.includes("word79"), true, "local full source remains available for faithful generation");
  const licensed = publicBibliographyRecord({ ...record, fullText: { ...record.fullText!, license: "cc by" } }).abstract!;
  assert.equal(licensed.excerptOnly, false);
  assert.equal(licensed.license, "cc by");
  assert.equal(licensed.text, record.abstract?.text);
  assert.equal(licensed.sections?.length, 1);
});
