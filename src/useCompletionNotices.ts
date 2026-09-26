import { useEffect, useRef, useState } from "react";
import type { Job, JobStatus } from "../shared/contracts";
import { DONE_LABELS, finishedJobs, titleWithCount } from "./completion";

const supported = () => typeof window !== "undefined" && "Notification" in window;

/** Tracks jobs that finish while the workbench is open: a banner, a tab-title count and, if allowed, a desktop notification. */
export function useCompletionNotices(jobs: Job[], enabled: boolean) {
  const statuses = useRef<Map<string, JobStatus> | null>(null);
  const [finished, setFinished] = useState<Job[]>([]);
  const [permission, setPermission] = useState(() => supported() ? Notification.permission : "denied");
  useEffect(() => {
    if (!enabled) { statuses.current = null; setFinished([]); return; }
    if (!jobs.length) return;
    const previous = statuses.current;
    statuses.current = new Map(jobs.map(job => [job.id, job.status]));
    if (!previous) return; // The first list is a baseline, not news.
    const done = finishedJobs(previous, jobs);
    if (!done.length) return;
    setFinished(current => [...done.filter(job => !current.some(item => item.id === job.id)), ...current].slice(0, 5));
    if (supported() && Notification.permission === "granted" && document.hidden) {
      for (const job of done) new Notification(DONE_LABELS[job.status] ?? "任務已更新", { body: job.title || job.input, tag: job.id });
    }
  }, [jobs, enabled]);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = titleWithCount(base, finished.length);
  }, [finished]);
  const request = async () => { if (supported()) setPermission(await Notification.requestPermission()); };
  const dismiss = (id?: string) => setFinished(current => id ? current.filter(job => job.id !== id) : []);
  return { finished, dismiss, permission, request };
}
