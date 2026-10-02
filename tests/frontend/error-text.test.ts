import { strict as assert } from "node:assert";
import { test } from "node:test";
import { errorText, PrivateApiError } from "../../src/privateApi.ts";

test("a version conflict keeps the generic 409 guidance", () => {
  assert.match(errorText(new PrivateApiError("STATE_CONFLICT", "The job changed", 409)), /任務狀態或版本已改變/);
});

test("other 409 answers show their own reason instead of a version conflict", () => {
  const gate = errorText(new PrivateApiError("QUALITY_GATE", "製作前檢查未通過：主張未鎖定", 409));
  assert.match(gate, /製作前檢查未通過：主張未鎖定/);
  assert.doesNotMatch(gate, /版本已改變/);
  assert.match(errorText(new PrivateApiError("UPLOAD_CONFLICT", "file id reused", 409)), /file id reused/);
});
