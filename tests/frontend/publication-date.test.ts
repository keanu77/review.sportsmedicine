import test from "node:test";
import assert from "node:assert/strict";
import { matchesPublicationWindow, publicationDate, publicationWindow } from "../../src/publicationDate.ts";
import { europePmcRecord } from "../../scripts/bibliography-source.ts";
import { enrichItem } from "../../src/enrich.ts";
import type { Item } from "../../src/types.ts";

test("recent publication periods include boundaries and today, exclude future and unknown dates", () => {
  const now = new Date(2026, 8, 22, 15);
  for (const [period, start] of [["1m", "2026-08-22"], ["6m", "2026-03-22"], ["1y", "2025-09-22"]] as const) {
    const window = publicationWindow(period, now);
    assert.deepEqual(window, { from: start, to: "2026-09-22" });
    assert.equal(matchesPublicationWindow(start, window), true);
    assert.equal(matchesPublicationWindow("2026-09-22", window), true);
    const previousDay = new Date(`${start}T00:00:00Z`); previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    for (const date of [previousDay.toISOString().slice(0, 10), "2026-09-23", null, undefined, "2026", "2026-08"]) {
      assert.equal(matchesPublicationWindow(date, window), false, `${period}: ${date}`);
    }
  }
  assert.equal(matchesPublicationWindow(null, publicationWindow("", now)), true);
});

test("calendar subtraction clamps month ends and leap days instead of overflowing", () => {
  assert.equal(publicationWindow("1m", new Date(2026, 2, 31))?.from, "2026-02-28");
  assert.equal(publicationWindow("1m", new Date(2024, 2, 31))?.from, "2024-02-29");
  assert.equal(publicationWindow("1y", new Date(2024, 1, 29))?.from, "2023-02-28");
  assert.equal(publicationDate("2026-02-29"), null);
  assert.equal(publicationDate("2026-04-31"), null);
  assert.equal(publicationDate("2024-02-29"), "2024-02-29");
});

test("source publication date survives enrichment without substituting index or verification dates", () => {
  const item: Item = { title: "Date filter review", year: 2026, url: "https://doi.org/10.1234/dates", source: "Journal", tldr: null, free: false, region: "膝", disease: "膝痛", themes: [], populations: [] };
  const raw = { id: "12345678", source: "MED", title: item.title, doi: "10.1234/dates", pubYear: "2026" };
  const record = europePmcRecord({ ...raw, firstPublicationDate: "2026-03-22" }, "2026-09-22");
  assert.equal(enrichItem(item, {}, {}, [record]).firstPublicationDate, "2026-03-22");
  assert.equal(europePmcRecord(raw, "2026-09-22").firstPublicationDate, null);
  assert.equal(europePmcRecord({ ...raw, firstPublicationDate: "2026" }, "2026-09-22").firstPublicationDate, null);
});
