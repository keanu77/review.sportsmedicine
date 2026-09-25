import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeJobError } from "../../src/jobError.ts";

test("classified full-text failures get a heading and keep the worker's next step", () => {
  const described = describeJobError({ code: "FULLTEXT_ACCESS_DENIED", message: "公開來源拒絕自動下載。已嘗試 2 個來源：onlinelibrary.wiley.com（HTTP 403）。" });
  assert.equal(described.title, "全文來源拒絕自動下載");
  assert.match(described.message, /wiley/);
  assert.equal(described.hint, null);
  assert.equal(describeJobError({ code: "FULLTEXT_TEMPORARY", message: "x" }).title, "全文來源暫時無法連線");
  assert.equal(describeJobError({ code: "FULLTEXT_BOT_CHECK", message: "x" }).title, "公開全文需在瀏覽器下載");
  assert.equal(describeJobError({ code: "FULLTEXT_MANUAL_MISMATCH", message: "x" }).title, "上傳的 PDF 不是這篇文獻");
});

test("legacy publisher 403 failures get an explanation instead of a retry promise", () => {
  const described = describeJobError({ code: "PROCESSING_FAILED", message: "未取得可驗證全文。XML：來源沒有提供 XML 全文；PDF：來源回應 HTTP 403" });
  assert.equal(described.title, "全文來源拒絕自動下載");
  assert.match(described.hint ?? "", /圖書館|館際互借/);
  assert.match(describeJobError({ code: "PROCESSING_FAILED", message: "未取得可驗證全文。XML：無；PDF：來源連線逾時" }).title, /未取得全文/);
});

test("model or other processing errors are not mislabelled as publisher failures", () => {
  const described = describeJobError({ code: "PROCESSING_FAILED", message: "模型 API 回應 HTTP 403" });
  assert.equal(described.title, "處理失敗");
  assert.equal(described.hint, null);
  assert.equal(describeJobError({ code: "WORKER_INTERRUPTED", message: "中斷" }).title, "處理中斷");
});
