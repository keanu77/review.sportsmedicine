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
