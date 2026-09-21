# Personal Paper Social Implementation Plan

> **For agentic workers:** Use subagent-driven-development for bounded implementation tasks and independent reviews. Implementation is authorized by the user's request to continue and complete the selected personal website + Mac design.

**Goal:** Ship a working personal OA-paper-to-FB/IG workbench with a private job API, Mac worker, and reproducible downloads.

**Architecture:** Keep the React/Vite public search. Add same-origin Cloudflare Pages Functions, D1 job state and private R2 artifacts; verify Cloudflare Access JWT plus the single configured owner email. A credentialed Mac worker polls outbound, prepares research drafts, then renders an explicitly selected draft revision using a vendored fb-renew renderer.

**Tech Stack:** React/TypeScript, Node ESM, Cloudflare Pages Functions/D1/R2, jose, fast-xml-parser, existing Codex/Claude CLI, pdftotext, Playwright.

## Shared integration contract

API JSON errors: `{error:{code,message}}`. Owner API prefix `/api/private`; worker API prefix `/api/worker`. Every private response uses `Cache-Control: no-store`.

Job: `id,input,title,status,phase,stage,revision,draft,design,metadata,artifacts,error,createdAt,updatedAt`; phase is `research|render`. Status is `queued|running|needs_review|completed|failed|cancelled`. Draft fields: `post,igCaption,notes,pages` (page `id,layout,title,subtitle?,cards?` with `{title,body}`), `claims` (claim `text,locator,quote`). Design: `palette,style,imageStyle,format`; defaults `blue,clinical,photo,portrait`; imageStyle includes `none`, format `square|portrait`.

Owner endpoints:
- `GET /session` -> `{email,worker:{lastSeen,capabilities}|null}`.
- `GET /jobs`, `POST /jobs {input,title?,design?}` -> `{jobs}` / `{job}`.
- `GET /jobs/:id`, `PATCH /jobs/:id/draft {revision,draft}`, `POST /jobs/:id/render {revision,design}`, `POST /jobs/:id/cancel`, `POST /jobs/:id/retry` -> `{job}`.
- `GET /jobs/:id/files/:fileId` streams a private validated artifact.

Worker endpoints (Bearer credential required):
- `POST /claim {workerId,capabilities}` -> `{job:null}` or `{job,leaseToken}`.
- `POST /jobs/:id/heartbeat {leaseToken,stage}`.
- `PUT /jobs/:id/files/:fileId`: binary, `X-Lease-Token`, `X-File-Name` (URI encoded); returns `{artifact}`; server computes byte size/hash, validates type and enforces size limits.
- `POST /jobs/:id/complete {leaseToken,draft?,metadata?,artifacts:[fileId]}`.
- `POST /jobs/:id/fail {leaseToken,code,message}`.

All mutations validate state, revision and active lease. Expired attempts cannot commit. Claim is atomic. Ambiguous model completion must not automatically consume more model usage. A render snapshots draft and design; editing never mutates an in-flight revision.

## Tasks

- [x] Backend: `server/`, `functions/`, `migrations/`, `shared/`, deployment config. Test invalid JWT/owner, anonymous downloads, CSRF, atomic claim, stale lease, cancelled result, revision conflicts and artifact integrity with real local D1/R2 where practical.
- [x] Worker: `worker/` resolver, bounded safe HTTP, download identity validation, PDF extraction, structured draft via local CLI, photo adapter, renderer adapter, ZIP export, claim/heartbeat/upload client. Tests exercise wrong-paper downloads, private addresses, HTML-as-PDF, invalid draft evidence, cancellation and retries.
- [x] Renderer: vendor existing fb-renew renderer under `worker/renderer/`; preserve original credits and interface, add portrait support and deterministic overflow checks. Render actual Traditional Chinese fixtures and inspect images.
- [x] Frontend: `src/workbench/` owner session, task list, new job, editable draft/cards, settings, progress, private preview and download; direct action from public rows. Fix favorite-empty trap, new-item enrichment and title-type priority. Meaningful browser tests at desktop and 360px.
- [ ] Integration: same-origin dev API bridge, local Cloudflare setup, production configuration guide, Mac doctor and foreground/startup commands, `.gitignore` for secrets/workspaces. Run build, unit/integration tests, current smoke tests and real single-paper workflow.
- [x] Independent reviews: first requirements/security boundary review, then code-quality review; resolve findings and rerun affected checks.

## Verification commands

`npm run build`, `npm test`, `npm run test:smoke`, `npm run worker:doctor`, and documented real `worker prepare/draft/render/run` commands. Each command must distinguish fixtures from real network/model execution. Deployment/owner login cannot be reported completed until actual cloud resources, Access settings and owner email are verified.

## Delivery constraints

No original PDF/notes in public assets or Git. Keep generated photos separate from typeset medical text. Full-text absence never becomes an unlabelled abstract-based draft. Work from a feature worktree and integrate reviewed changes into the user's folder. Do not publish to FB/IG or send messages. Provision/deploy only within established authorization; record any missing external configuration exactly.

## Implementation status, 2026-09-21

Implemented and locally verified: private API, worker, renderer, public-index fixes, workbench, startup template and multi-model review records. Integration has separate proofs for signed-JWT API, real workerd D1/R2, actual worker-to-render-to-private-ZIP, browser fixtures, and one real OA paper with Codex generation plus Claude/Grok review. Gemini was unavailable, not counted as a reviewer.

Production is deployed: commit `ba2879a`, Cloudflare deployment `5055f8b0-85cb-4e22-8790-3a3f90ab4a52`, D1/private R2 bindings, owner Access variables and production-only worker secret verified. The owner-only Access application uses the existing team `sportsmedicine-tw.cloudflareaccess.com`. To work around the broken dashboard email-policy editor, the user explicitly approved a temporary Access-only API token; after configuration it was revoked, verified invalid, and its local secret file removed. Existing applications were not changed. Owner email-code login succeeded; the UI reports Mac connected. The Mac LaunchAgent is running after successful foreground verification. The production paper-to-ZIP acceptance run is in progress; its results will be recorded in `docs/verification-2026-09-21.md`.

JATS XML parsing, table context, `xml:ID` evidence and independent PDF acquisition are implemented. CLI resume verifies original-file and extracted-text hashes, reparses XML rather than trusting derived JSON, and supports XML-only directories. After crash recovery, 66 unit tests, 41 browser tests, 2 renderer tests, worker/API integration, local workerd smoke and production build passed. The legacy real-paper PDF directory was also read and verified again without model calls.

First-release limits: scans and image-only tables require manual handling, 160k-character full-text limit, ambiguous PMC versions require manual selection, no automatic re-review of owner edits, and private object retention requires operator policy. The UI identifies stale review records and prior output versions.
