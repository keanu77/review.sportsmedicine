# Review reliability and monthly maintenance

User approved recommendations 1–4 and monthly website maintenance, with literature updates on day 1. Implement in this isolated checkout, then verify and integrate. Preserve existing private jobs, Access and worker secrets.

## Accepted design

- Search recognizes exact DOI/PMID/PMCID and their canonical URLs, plus authors. Offer relevance/latest sorting.
- Bibliographic enrichment is a separate durable overlay, validated against exact identifiers or unambiguous normalized title/year; never invent authors, identifiers or full-text verification. Preserve historical title bookmarks.
- Save drafts automatically after a short idle interval using revision CAS. Persist bounded owner-scoped recovery copies for browser crashes; display storage failures. Keep immutable server draft snapshots; compare and restore by creating a new version.
- Explicit re-review locks a saved draft snapshot, reuses verified full text, and runs reviewers without regenerating the draft/images. Record review run, draft version and individual dispositions with reasons. Edits invalidate old review applicability.
- Monthly day-1 data sync validates incoming data, enriches metadata and runs checks before publishing. Monthly maintenance runs reproducible checks and applies compatible dependency improvements only after regression checks pass; no automatic medical rewriting.

## Implementation and acceptance

- [x] Public identifiers and citations: regression tests for DOI URLs/PMID/PMCID, author search, conflicting metadata, publication fields; run `npm run test:frontend`.
- [x] Metadata refresh: checked API fixtures and real public source refresh; record matched/unresolved counts and source timestamps; rerun must retain overlay.
- [x] Draft history: migration seeds existing drafts, SQL snapshots atomically with edits; API tests assert conflicts never add phantom versions, restore is non-destructive and owner-only.
- [x] Autosave/recovery: browser tests cover crash/reload, login failure, newer remote revision, switching projects and edits during save.
- [x] Review queue: capability-gated worker phase without rebuilding existing jobs table; API/worker tests cover current-version snapshot, retries, failures and no draft replacement. UI persists findings dispositions.
- [x] Monthly workflows: day-1 sync and monthly maintenance, explicit failed checks, durable reports and no duplicate schedule.
- [x] Integration: typecheck/build, frontend/server/worker suites, browser tests and real local D1/R2 smoke; inspect final diff.
- [x] Rollout: additive migration before API deployment, update Mac worker only while idle; production anonymous/private checks and verify schedules on default branch. Do not create a production research task or consume model/image credits merely to smoke-test.

## Boundaries

No SEO/URL restructure, collection sync, broad UI redesign or unrelated refactor. No changes to original untracked `.claude/` and `skill-updates/`. No social publication or messages.
