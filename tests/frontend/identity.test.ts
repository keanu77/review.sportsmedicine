import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canonicalPaperId, doiOf, paperAliases, paperKey, sourceInput, uniquePapers, workbenchUrl } from "../../src/identity.ts";
import { toBibTeX, toVancouver } from "../../src/citation.ts";
import { enrichItem } from "../../src/enrich.ts";
import { studyTypeOf } from "../../src/studyType.ts";
import type { Item } from "../../src/types.ts";

const item: Item = { title: "A Review of ACL", year: 2026, url: "https://example.com/article", source: "example.com", free: true, tldr: null, region: "膝", disease: "ACL", themes: [], populations: [] };

test("identifier selection never sends an arbitrary publisher URL; legacy title aliases remain stable", () => {
  assert.equal(sourceInput(item), null);
  assert.equal(paperKey(item), "areviewofacl");
  const enriched = { ...item, doi: "https://doi.org/10.1234/ACL(2026)", pmid: "12345678" };
  assert.equal(canonicalPaperId(enriched), "doi:10.1234/acl(2026)");
  assert.ok(paperAliases(enriched).includes(paperKey(item)));
  assert.ok(paperAliases(enriched).includes("pmid:12345678"));
  assert.equal(new URL(workbenchUrl(item), "https://review.test").searchParams.has("input"), false);
  assert.equal(new URL(workbenchUrl(enriched), "https://review.test").searchParams.get("input"), "10.1234/acl(2026)");
});

test("DOI parsing preserves valid parentheses, omits tracking query, tolerates malformed percent encoding", () => {
  assert.equal(doiOf({ ...item, url: "https://journals.example.com/doi/full/10.1234/ACL(2026)?via=ref" }), "10.1234/acl(2026)");
  assert.equal(doiOf({ ...item, url: "https://doi.org/10.1234/BAD%XX" }), "10.1234/bad%xx");
  assert.equal(sourceInput({ ...item, url: "https://pubmed.ncbi.nlm.nih.gov/12345678/" }), "PMID:12345678");
  assert.equal(sourceInput({ ...item, freeUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/" }), "PMC1234567");
});

test("canonical deduplication bridges identifier aliases and retains historical title identities", () => {
  const variants = [
    { ...item, title: "First title", doi: "10.1234/example", disease: "膝痛" },
    { ...item, title: "Another title", pmid: "12345678", disease: "運動傷害" },
    { ...item, title: "First title", pmid: "12345678" },
  ];
  const papers = uniquePapers(variants);
  assert.equal(papers.length, 1);
  assert.ok(paperAliases(papers[0]).includes("title:anothertitle"));
  assert.ok(paperAliases(papers[0]).includes("doi:10.1234/example"));
  assert.ok(papers[0].diseases?.includes("膝痛"));
  assert.ok(papers[0].diseases?.includes("運動傷害"));
});

test("same-title papers with different explicit identifiers never mix source metadata", () => {
  const first = { ...item, doi: "10.1234/first", pmid: "12345671", year: 2025, freeUrl: "https://example.com/first.pdf" };
  const second = { ...item, doi: "10.1234/second", pmid: "12345672", year: 2026, freeUrl: "https://example.com/second.pdf" };
  const papers = uniquePapers([first, second]);
  assert.equal(papers.length, 2);
  for (const original of [first, second]) {
    const found = papers.find(paper => sourceInput(paper) === original.doi)!;
    assert.equal(found.pmid, original.pmid);
    assert.equal(found.year, original.year);
    assert.equal(found.freeUrl, original.freeUrl);
  }
  assert.equal(uniquePapers([{ ...item, pmid: "12345671" }, { ...item, pmid: "12345672" }]).length, 2);
  assert.equal(uniquePapers([{ ...item, pmcid: "PMC1234561" }, { ...item, pmcid: "PMC1234562" }]).length, 2);
});

test("ambiguous title-only metadata cannot bridge conflicting DOI groups", () => {
  const papers = uniquePapers([{ ...item, doi: "10.1234/first" }, { ...item, doi: "10.1234/second" }, { ...item, pmid: "12345678" }]);
  assert.equal(papers.length, 3);
  assert.equal(papers.find(paper => paper.doi === "10.1234/first")!.pmid, undefined);
  assert.equal(papers.find(paper => paper.doi === "10.1234/second")!.pmid, undefined);
});

test("explicit review type wins over a referenced reporting guideline", () => {
  assert.equal(studyTypeOf("An Umbrella Review Following PRIOR Guideline"), "傘狀回顧");
  assert.equal(studyTypeOf("Systematic review of clinical practice guidelines"), "系統性回顧");
  assert.equal(studyTypeOf("Clinical Practice Guideline for Achilles Pain"), "指引");
});

test("citation uses supplied authors and DOI, omits domain-only journal, escapes BibTeX", () => {
  const withAuthors = { ...item, authors: ["Wu YC", "Smith A"], doi: "10.1234/ACL_2026" };
  assert.ok(toVancouver(withAuthors).startsWith("Wu YC, Smith A. A Review of ACL."));
  assert.ok(!toVancouver(withAuthors).includes("example.com"));
  assert.ok(toBibTeX(withAuthors).includes("author = {Wu YC and Smith A}"));
  assert.ok(toBibTeX(withAuthors).includes("10.1234/acl\\_2026"));
  assert.ok(!toVancouver(item).startsWith("Wu"));
});

test("new item and main list enrichment share summary and union tag semantics", () => {
  const enriched = enrichItem({ ...item, themes: ["舊標籤", "保留"] }, { areviewofacl: "疊加摘要" }, { updated: { label: "復健", axis: "themes", absorbs: ["舊標籤"], keys: ["areviewofacl"] } });
  assert.equal(enriched.tldr, "疊加摘要");
  assert.equal(enriched.tldrSource, "local-llm");
  assert.deepEqual(enriched.themes, ["復健", "保留"]);
});
