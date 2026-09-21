import type { Artifact, Job } from "../shared/contracts";

/** A delayed poll must not rewind a mutation, heartbeat or newly created list item. */
export function latestJob(current: Job | null | undefined, incoming: Job): Job {
  if (!current || current.id !== incoming.id) return incoming;
  if (current.revision > incoming.revision || (current.revision === incoming.revision && Date.parse(current.updatedAt) > Date.parse(incoming.updatedAt))) return current;
  return incoming;
}
export function mergeJobList(current: Job[], incoming: Job[]): Job[] {
  const known = new Map(current.map(job => [job.id, job]));
  for (const job of incoming) known.set(job.id, latestJob(known.get(job.id), job));
  return [...known.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export class PrivateApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); }
}

export async function privateApi<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(abort, 20000);
  try {
    const response = await fetch(`/api/private${path}`, {
      method: options.method ?? "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json", ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new PrivateApiError("API_UNAVAILABLE", "私人服務尚未可用，或登入已失效。純靜態預覽無法建立任務；請開啟已設定私人服務的工作台。", response.status);
    }
    const data = await response.json();
    if (!response.ok) throw new PrivateApiError(data?.error?.code ?? "REQUEST_FAILED", data?.error?.message ?? `請求失敗（${response.status}）`, response.status);
    return data as T;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) throw new PrivateApiError("TIMEOUT", "連線等候逾時。若剛送出操作，請重新整理任務確認結果。");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function errorText(error: unknown): string {
  if (error instanceof PrivateApiError) {
    if (error.status === 401) return "登入尚未完成或已過期。請重新登入工作台。";
    if (error.status === 403) return "目前帳號無權存取私人工作台。";
    if (error.status === 409) return "任務狀態或版本已改變。你的文字仍保留，請先比較最新版本再操作。";
    return `${error.message}（${error.code}）`;
  }
  return error instanceof Error ? error.message : "連線失敗，請稍後再試。";
}

export function fileUrl(jobId: string, artifact: Pick<Artifact, "id">, inline = false): string {
  return `/api/private/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(artifact.id)}${inline ? "?inline=1" : ""}`;
}

/** Fetch within the owner session so HTTP/auth failures stay visible in the editor. */
export async function fetchArtifact(jobId: string, artifact: Artifact, signal?: AbortSignal): Promise<Blob> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 60000);
  try {
    const response = await fetch(fileUrl(jobId, artifact), { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      throw new PrivateApiError("DOWNLOAD_FAILED", response.status === 404 ? "檔案已更新或不存在，請重新整理工作台後再下載。" : `伺服器無法提供檔案（HTTP ${response.status}）。請稍後再試。`, response.status);
    }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (response.redirected || contentType === "text/html") throw new PrivateApiError("DOWNLOAD_LOGIN", "登入可能已過期，請重新登入工作台後再下載。");
    if (contentType !== artifact.contentType) throw new PrivateApiError("DOWNLOAD_TYPE", "伺服器回傳的檔案格式不符，請重新整理工作台後再試。");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== artifact.size) throw new PrivateApiError("DOWNLOAD_INCOMPLETE", "收到的檔案不完整，請重新下載。");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    if (hash !== artifact.sha256) throw new PrivateApiError("DOWNLOAD_CHECKSUM", "檔案完整性檢查未通過，請重新下載。");
    return new Blob([bytes], { type: artifact.contentType });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (controller.signal.aborted) throw new PrivateApiError("DOWNLOAD_TIMEOUT", "下載等候逾時，請檢查連線後再試。");
    if (error instanceof TypeError) throw new PrivateApiError("DOWNLOAD_NETWORK", "下載連線失敗，請檢查網路或重新登入工作台後再試。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
