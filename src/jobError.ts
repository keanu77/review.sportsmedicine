import type { Job } from "../shared/contracts";

type JobError = Pick<NonNullable<Job["error"]>, "code" | "message">;
export type DescribedJobError = { title: string; message: string; hint: string | null };

const TITLES: Record<string, string> = {
  FULLTEXT_NOT_OPEN: "未找到公開全文",
  FULLTEXT_BOT_CHECK: "公開全文需在瀏覽器下載",
  FULLTEXT_ACCESS_DENIED: "全文來源拒絕自動下載",
  FULLTEXT_IDENTITY: "取得的檔案不是這篇文獻",
  FULLTEXT_TEMPORARY: "全文來源暫時無法連線",
  FULLTEXT_SOURCE_UNAVAILABLE: "公開全文來源失效",
  FULLTEXT_MANUAL_MISMATCH: "上傳的 PDF 不是這篇文獻",
  WORKER_INTERRUPTED: "處理中斷",
};
const LEGACY_FULLTEXT = "未取得可驗證全文";
const ACCESS_HINT = "出版社拒絕自動下載，多半需要機構訂閱；重試通常不會改變結果。請改用圖書館連結或館際互借取得全文。";

// Worker messages for classified failures already carry the next step. Jobs
// failed before classification only have the raw downloader message.
export function describeJobError(error: JobError): DescribedJobError {
  const title = TITLES[error.code];
  if (title) return { title, message: error.message, hint: null };
  if (error.code === "PROCESSING_FAILED" && error.message.startsWith(LEGACY_FULLTEXT)) {
    const denied = /HTTP (401|403|429)/.test(error.message);
    return { title: denied ? TITLES.FULLTEXT_ACCESS_DENIED : "未取得全文", message: error.message,
      hint: denied ? ACCESS_HINT : "可稍後重試；若持續失敗，請改用圖書館連結取得全文。" };
  }
  return { title: "處理失敗", message: error.message, hint: null };
}
