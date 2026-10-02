import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { JobSummary } from "../../shared/contracts";
import { reconcileFirstPage } from "../../src/jobList.ts";

const job = (id: string, createdAt: string): JobSummary => ({ id, input: id, title: "", status: "queued", phase: "research", stage: "queued", revision: 1, artifacts: [], createdAt, updatedAt: createdAt });
const a = job("a", "2026-09-03T00:00:00Z"), b = job("b", "2026-09-02T00:00:00Z"), c = job("c", "2026-09-01T00:00:00Z");

test("a job deleted elsewhere disappears when the first page no longer lists it", () => {
  assert.deepEqual(reconcileFirstPage([a, b, c], [a, c], true, new Set()).map(item => item.id), ["a", "c"]);
});

test("older pages loaded with 載入更多 survive a partial first page", () => {
  // The first page holds a and b; c came from an older page and must stay.
  assert.deepEqual(reconcileFirstPage([a, b, c], [a, b], false, new Set()).map(item => item.id), ["a", "b", "c"]);
  // b vanished from within the first page's range (a…c); d is older than the page and stays.
  const d = job("d", "2026-08-31T00:00:00Z");
  assert.deepEqual(reconcileFirstPage([a, b, c, d], [a, c], false, new Set()).map(item => item.id), ["a", "c", "d"]);
});

test("a job created after the poll started is kept", () => {
  const created = job("new", "2026-09-04T00:00:00Z");
  assert.deepEqual(reconcileFirstPage([created, a], [a], true, new Set(["new"])).map(item => item.id), ["new", "a"]);
});
