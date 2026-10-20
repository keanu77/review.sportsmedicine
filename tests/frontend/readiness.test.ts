import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReadiness } from "../../scripts/build-readiness.ts";
import { europePmcRecord } from "../../scripts/bibliography-source.ts";
import { paperKey } from "../../src/identity.ts";
import type { Item, ReviewsData } from "../../src/types.ts";

test("readiness retains source gaps, safe summary backlog and unresolved failure reasons", () => {
  const item: Item = { title: "Source paper", year: 2025, url: "https://doi.org/10.1234/source", source: "", free: false, tldr: null, region: "", disease: "", themes: [], populations: [] };
  const missing = { ...item, title: "Missing paper", url: "https://publisher.org/missing", year: null };
  const record = europePmcRecord({ id: "123", pmid: "123", source: "MED", title: item.title, doi: "10.1234/source", pubYear: "2025", abstractText: "Source findings only." }, "2026-10-20");
  const data = buildReadiness({ meta: { updated: "2026-10-02" }, items: [item, missing] } as ReviewsData,
    { version: 1, generatedAt: "2026-10-20", records: [record], unresolved: [{ key: `title:${paperKey(missing)}`, title: missing.title, reason: "title-match-requires-year", checkedAt: "2026-10-20" }] },
    { generatedAt: null, model: "none", count: 0, summaries: {}, attempts: { [paperKey(item)]: { status: "failed", reason: "model-output-failed-validation", checkedAt: "2026-10-20" } } }, "2026-10-20");
  assert.equal(data.counts.total, 2);
  assert.equal(data.counts.summaryReady, 1);
  assert.equal(data.counts.summaryBlocked, 1);
  assert.equal(data.counts.missingAuthors, 2);
  assert.equal(data.counts.missingIdentifiers, 1);
  assert.ok(data.papers[0].reasons.includes("model-output-failed-validation"));
  assert.ok(data.papers[1].reasons.includes("title-match-requires-year"));
  assert.equal(data.papers[1].abstract, "missing");
});
