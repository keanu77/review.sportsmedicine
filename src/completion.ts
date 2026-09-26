import type { Job, JobStatus } from "../shared/contracts";

const ACTIVE: JobStatus[] = ["queued", "running"];
const DONE: JobStatus[] = ["needs_review", "completed", "failed"];
export const DONE_LABELS: Partial<Record<JobStatus, string>> = { needs_review: "草稿完成，等你審閱", completed: "圖文製作完成", failed: "執行失敗" };

/** Jobs that were queued or running at the last poll and have now finished. */
export function finishedJobs(previous: ReadonlyMap<string, JobStatus>, jobs: Job[]): Job[] {
  return jobs.filter(job => ACTIVE.includes(previous.get(job.id) as JobStatus) && DONE.includes(job.status));
}

export const titleWithCount = (base: string, count: number) => count > 0 ? `(${count}) ${base}` : base;
