# Review improvements verification — 2026-09-22

## Implemented scope

Exact DOI/PMID/PMCID and canonical-URL lookup, author search, relevance/latest sorting; verified citation overlay; draft autosave, crash recovery, immutable history and restore; explicit review of the saved draft against the original verified source, archived review batches and finding dispositions.

The raw upstream index remains unchanged. Of 857 unique papers, 811 have matched bibliographic records and 805 have authors. Missing identifiers decreased from 194 to 42. The remaining 46 unmatched papers are retained without invented metadata: 34 lack a usable year for safe title matching and 12 lack an exact source match.

## Local verification

- Node 24: 93 server, frontend and worker tests passed before final review.
- Production-build browser suite: 62 tests passed, including autosave failures, recovery, polling conflicts, history, re-review and ZIP contents.
- Real local Cloudflare Pages / D1 / R2 smoke passed, including migrations and authentication rejection.
- Worker integration and two renderer tests passed. Model responses in integration tests are fixtures; these checks did not create a production research task or consume model/image credits.
- Production dependency audit reported zero vulnerabilities.
- Final review fixes: retrying an already completed review creates a new batch bound to the current draft; migrated review batches retain an unknown version when selected. All 8 history/API tests and the added browser regression passed after these fixes.
- Specification and correctness reviews covered recovery edge cases, migration compatibility, source matching and monthly workflow dependencies.

## Monthly operation

- Literature sync: day 1 at 03:17 UTC (11:17 Taipei / 12:17 Tokyo). Validate upstream date, schema and count before replacing data; enrich citations; publish only after tests and build pass.
- Maintenance: day 3 at 03:37 UTC (11:37 Taipei / 12:37 Tokyo). Apply compatible dependency updates only after data validation, unit/browser/local API/integration checks and dependency audit. No automated rewriting of medical conclusions.
- Manual maintenance runs default to report-only (`apply_updates=false`). Both workflows retain reports and failure evidence for 90 days and serialize publishing.

## Deployment order and recovery

Back up the production D1 database privately, apply additive migration 0002, then publish the application. Preserve existing jobs and R2 files. Restart the existing Mac worker only while no job is running, then verify its review capability and the deployed commit.

Migration 0002 seeds current drafts and old reviews without inventing old review versions. Rolling back application code does not require dropping the added tables/columns. Keep the private database backup outside Git; never commit credentials or private job text.

Browser recovery copies are scoped to owner/job/document, expire after seven days and are size bounded. Server history remains authoritative. Re-review requires the original verified full-text cache; an unavailable cache produces an explicit failure instead of silently substituting another source.

Production deployment and hosted Linux workflow execution are separate release checks; local success alone does not establish either.
