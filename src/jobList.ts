import type { JobSummary } from "../shared/contracts";
import { mergeJobList } from "./privateApi";

/**
 * Applies a fresh first page of the job list. Merging alone never removes anything, so a job
 * deleted in another tab or device would stay forever; a job is dropped when the page covers
 * its position (`complete`, or not older than the page's oldest job) and no longer lists it.
 * Jobs this tab created while the poll was in flight are in `keep`.
 */
export function reconcileFirstPage<T extends JobSummary>(current: T[], page: T[], complete: boolean, keep: ReadonlySet<string>): T[] {
  const listed = new Set(page.map(job => job.id));
  const oldest = page.length ? Math.min(...page.map(job => Date.parse(job.createdAt))) : Infinity;
  const survives = (job: T) => listed.has(job.id) || keep.has(job.id) || (!complete && Date.parse(job.createdAt) < oldest);
  return mergeJobList(current.filter(survives), page);
}
