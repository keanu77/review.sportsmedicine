import { join } from "node:path";
import { tmpdir } from "node:os";

/** Public source data is cached outside the publishable repository. Never contains credentials. */
export const bibliographyCacheDir = process.env.BIBLIOGRAPHY_CACHE_DIR || join(tmpdir(), "review-public-bibliography-cache-v1");
export const fullSourceCachePath = join(bibliographyCacheDir, "source-abstracts.json");
