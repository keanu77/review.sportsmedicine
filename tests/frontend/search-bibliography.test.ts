import { strict as assert } from "node:assert";
import { test } from "node:test";
import { matchesQuery, tokenize } from "../../src/search.ts";
import * as search from "../../src/search.ts";
import { enrichItem } from "../../src/enrich.ts";
import * as enrichment from "../../src/enrich.ts";
import { paperAliases, paperKey } from "../../src/identity.ts";
import { toBibTeX, toVancouver } from "../../src/citation.ts";
import type { Item } from "../../src/types.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PaperDetails from "../../src/PaperDetails.tsx";

const item: Item = { title: "Optimal resistance training prescriptions", year: 2025, url: "https://doi.org/10.1007/s40520-025-03235-w", source: "Aging Clinical and Experimental Research", free: false, tldr: null, region: "", disease: "", themes: [], populations: [] };
const metadata = { title: item.title, year: 2025, doi: "10.1007/s40520-025-03235-w", pmid: "40234567", pmcid: "PMC1234567", authors: ["Smith AB", "Wu YC"], journal: "Aging Clin Exp Res", volume: "37", issue: "1", pages: "118", source: "Europe PMC", sourceUrl: "https://europepmc.org/article/MED/40234567", verifiedAt: "2026-09-21T00:00:00.000Z", matchMethod: "identifier" };

test("DOI and canonical publisher URLs match exactly without partial DOI false positives", () => {
  for (const query of ["10.1007/s40520-025-03235-w", "DOI:10.1007/S40520-025-03235-W", "https://doi.org/10.1007/s40520-025-03235-w?utm_source=ref"]) {
    assert.equal(matchesQuery(item, tokenize(query)), true, query);
  }
  assert.equal(matchesQuery(item, tokenize("10.1007/s40520-025-03235")), false);
  assert.equal(matchesQuery({ ...item, url: "https://publisher.test/article/a" }, tokenize("https://publisher.test/article/a?utm_source=ref")), true);
  assert.equal(matchesQuery({ ...item, url: "https://publisher.test/article?id=1" }, tokenize("https://publisher.test/article?id=2")), false);
});

test("PMID, PMCID, canonical URLs and author queries use all identifier sources", () => {
  const full = { ...item, ...metadata };
  for (const query of ["PMID:40234567", "PMID: 40234567", "40234567", "PMC1234567", "https://pubmed.ncbi.nlm.nih.gov/40234567/", "https://pmc.ncbi.nlm.nih.gov/articles/PMC1234567/", "Smith AB"]) {
    assert.equal(matchesQuery(full, tokenize(query)), true, query);
  }
  assert.equal(matchesQuery(full, tokenize("4023456")), false);
  assert.equal(matchesQuery({ ...item, pmid: undefined, url: "https://pubmed.ncbi.nlm.nih.gov/40234567/" }, tokenize("PMID:40234567")), true);
  assert.equal(matchesQuery(full, tokenize("https://example.test/pubmed.ncbi.nlm.nih.gov/40234567/")), false);
});

test("relevance favors title over summary, while latest uses publication year", () => {
  assert.equal(typeof search.rankResults, "function");
  const oldTitle = { ...item, title: "ACL rehabilitation", year: 2020 };
  const newSummary = { ...item, title: "Other review", tldr: "ACL rehabilitation", year: 2026 };
  assert.equal(search.rankResults([newSummary, oldTitle], tokenize("ACL rehabilitation"), "relevance")[0], oldTitle);
  assert.equal(search.rankResults([oldTitle, newSummary], tokenize("ACL rehabilitation"), "latest")[0], newSummary);
});

test("the search result explanation describes the selected sort", () => {
  assert.equal(typeof search.searchSortLabel, "function");
  assert.equal(search.searchSortLabel("relevance"), "依相關度");
  assert.equal(search.searchSortLabel("latest"), "依年份新到舊");
});

test("durable bibliography enriches metadata without changing summary keys or free-full-text claims", () => {
  const enriched = enrichItem(item, { [paperKey(item)]: "保留摘要" }, {}, [metadata]);
  assert.deepEqual(enriched.authors, metadata.authors);
  assert.equal(enriched.pmid, metadata.pmid);
  assert.equal(enriched.volume, "37");
  assert.equal(enriched.bibliography?.verifiedAt, metadata.verifiedAt);
  assert.equal(enriched.tldr, "保留摘要");
  assert.equal(enriched.free, false);
  assert.equal(enriched.title, item.title);
  assert.ok(paperAliases(enriched).includes(paperKey(item)));
  assert.equal(enrichItem({ ...item }, {}, {}, [metadata]).authors?.[0], "Smith AB");
  assert.equal(enrichItem({ ...item, year: 2024 }, {}, {}, [metadata]).year, 2025);
});

test("overlay rejects wrong title, conflicting PMID and ambiguous exact titles", () => {
  assert.equal(enrichItem(item, {}, {}, [{ ...metadata, title: "A different paper" }]).authors, undefined);
  assert.equal(enrichItem({ ...item, pmid: "99999999" }, {}, {}, [metadata]).authors, undefined);
  const titleOnly = { ...item, url: "https://publisher.test/article" };
  assert.equal(enrichItem(titleOnly, {}, {}, [metadata, { ...metadata, doi: "10.1234/other", pmid: "12345678" }]).authors, undefined);
  assert.equal(enrichItem({ ...titleOnly, year: 2020 }, {}, {}, [metadata]).authors, undefined);
});

test("explicit bibliography indexes preserve conflict checks and refresh after same-length replacements", () => {
  assert.equal(typeof enrichment.createBibliographyIndex, "function");
  const records = [{ ...metadata, authors: ["Original A"] }];
  const first = enrichment.createBibliographyIndex(records);
  assert.equal(enrichItem(item, {}, {}, first).authors?.[0], "Original A");
  records[0] = { ...metadata, authors: ["Updated B"] };
  const updated = enrichment.createBibliographyIndex(records);
  assert.equal(enrichItem(item, {}, {}, updated).authors?.[0], "Updated B");
  assert.equal(enrichItem(item, {}, {}, first).authors?.[0], "Original A");
  assert.equal(enrichItem({ ...item, pmid: "99999999" }, {}, {}, updated).authors, undefined);
  const ambiguous = enrichment.createBibliographyIndex([metadata, { ...metadata, doi: "10.1234/other", pmid: "12345678" }]);
  assert.equal(enrichItem({ ...item, url: "https://publisher.test/article" }, {}, {}, ambiguous).authors, undefined);
});

test("citations include retrieved volume issue pages and PMCID without inventing missing fields", () => {
  const full = enrichItem(item, {}, {}, [metadata]);
  assert.match(toVancouver(full), /2025;37\(1\):118/);
  assert.match(toVancouver(full), /PMCID: PMC1234567/);
  assert.match(toBibTeX(full), /volume = \{37\}/);
  assert.match(toBibTeX(full), /number = \{1\}/);
  assert.match(toBibTeX(full), /pages = \{118\}/);
  assert.doesNotMatch(toVancouver(item), /undefined|null/);
});

test("paper details show source verification date and distinguish missing bibliography", () => {
  const html = renderToStaticMarkup(createElement(PaperDetails, { item: enrichItem(item, {}, {}, [metadata]) }));
  assert.match(html, /Europe PMC/);
  assert.match(html, /2026-09-21/);
  assert.match(html, /卷／期／頁碼/);
  assert.match(html, /書目欄位/);
  const missing = renderToStaticMarkup(createElement(PaperDetails, { item }));
  assert.match(missing, /書目資料尚未取得可核對來源/);
});
