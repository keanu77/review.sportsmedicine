import test from "node:test";
import assert from "node:assert/strict";
import { precision } from "../../src/ReviewerStats";

test("seat precision uses only findings the owner settled", () => {
  const base = { month: "2026-09", provider: "codex", runs: 2, ran: 2, findings: 10, averageSeconds: 300 };
  assert.equal(precision({ ...base, resolved: 0, rejected: 0 }), null);
  assert.equal(precision({ ...base, resolved: 3, rejected: 1 }), 75);
});
