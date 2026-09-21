import { strict as assert } from "node:assert";
import { test } from "node:test";
import { latestJob, mergeJobList } from "../../src/privateApi.ts";
import type { Job } from "../../shared/contracts.ts";

const job = { id: "first", revision: 2, stage: "research", status: "running", createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:30Z" } as Job;
test("stale polls cannot roll back an edit or an equal-revision heartbeat", () => {
  assert.equal(latestJob(job, { ...job, revision: 1 }), job);
  assert.equal(latestJob(job, { ...job, updatedAt: "2026-09-21T00:00:00Z", stage: "queued" }), job);
  assert.equal(latestJob(job, { ...job, revision: 3 }).revision, 3);
});
test("a list fetched before creation cannot remove the just-created job", () => {
  const created = { ...job, id: "second", createdAt: "2026-09-21T01:00:00Z" };
  const merged = mergeJobList([job, created], [{ ...job, revision: 1 }]);
  assert.deepEqual(merged.map(item => item.id), ["second", "first"]);
  assert.equal(merged[1].revision, 2);
});
