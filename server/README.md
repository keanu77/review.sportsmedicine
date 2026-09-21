# Private API

The public Vite site stays public. The two Pages Functions routes authenticate independently: `/api/private/*` verifies a Cloudflare Access RS256 JWT and the single owner's email; `/api/worker/*` accepts only a separate random bearer credential. There is no development authentication bypass. All responses, including errors and private downloads, use `Cache-Control: no-store`.

## Configuration

`wrangler.jsonc` binds `DB` to D1 and `ARTIFACTS` to a private R2 bucket. Its zero UUID is a local placeholder; replace it with the provisioned D1 ID before deploying. Do not enable public R2 access. Apply `migrations/0001_private_jobs.sql` through Wrangler.

Configure these Pages variables/secrets for each environment:

- `ACCESS_TEAM_DOMAIN`: `your-team.cloudflareaccess.com`.
- `ACCESS_AUD`: the Access application's audience tag.
- `OWNER_EMAIL`: the exact permitted owner's email (compared case-insensitively).
- `WORKER_TOKEN`: a random credential at least 32 characters long, shared only with the Mac worker.
- `APP_ORIGIN` (optional): exact origin such as `https://review.example.com`; when set, pins the allowed owner mutation Origin. Without it, the request URL origin is required.

Configure Access to protect the workbench and `/api/private/*`; allow the single owner's identity. Worker API paths need to reach the bearer-authenticated Functions endpoint without a browser Access login. Protect preview deployments consistently; the application verifies JWTs even if Access routing is misconfigured. A client must send owner mutations with same-origin `Origin` and JSON requests with `Content-Type: application/json`.

For local development, put variables in an ignored `.dev.vars` file. A real valid Access JWT is still required for owner calls. The worker API works with the local bearer credential.

```sh
npx wrangler d1 migrations apply DB --local
npx wrangler pages dev dist
node --test tests/server/api.test.mjs
node tests/server/wrangler-smoke.mjs
```

The smoke script creates an isolated temporary local database/bucket, seeds one fixture job, and runs actual Pages Functions with workerd/D1/R2. It verifies competing claims, uploads and hashes, heartbeat, completion, rejection of stale leases, and anonymous private-route denial. It does not provision, deploy, or exercise a production Access login. The signed-JWT test suite checks owner success, wrong owner, invalid signatures, issuer, audience and expiry.

## State and artifact guarantees

SQL compare-and-swap guards draft revisions. Queuing a render freezes its draft/design until that attempt completes. Editing a completed draft returns it to `needs_review`. The database's unique partial index permits one running job. An atomic claim supplies an opaque 120-second lease; the worker should renew it every 30 seconds. Every heartbeat/upload/complete/fail checks the active, unexpired lease. Cancellation clears the lease. Expiry marks the job `failed` with `LEASE_EXPIRED` and requires an explicit retry, because the interrupted model work may already have consumed usage.

For photo or illustration rendering, claim requires `capabilities.imageGeneration.available` to be the boolean `true`, based on the worker's verified image-tool availability. Missing, false or incorrectly typed capability leaves that job queued with its design unchanged. The same worker can still claim later research jobs and `imageStyle: none` renders; one running job remains the global limit. Merely installing a CLI is not proof of image-generation availability.

Artifact IDs must be unique across a job's attempts; use UUIDs for IDs and ordinary safe filenames for names. Retrying an upload within the same live lease/attempt is idempotent when the file ID, filename, type, byte length and SHA-256 all match; a retry returns the existing artifact with HTTP 200 (first creation uses 201). Concurrent identical uploads also converge on one artifact, and the losing unique R2 object is deleted. Different contents or an earlier attempt's file ID return 409. An upload first validates filename, extension, declared type, magic bytes/UTF-8/JSON, bounded byte length and optional `X-Content-SHA256`. The server computes the actual SHA-256 and sends it to R2 for integrity checking. Registration is conditional on the same live lease and attempt quotas. Completion accepts only uploaded file IDs from the active attempt. Uncommitted files cannot be downloaded. Research artifacts stay visible after rendering; a successful rerender replaces the visible render artifact set. Keys and lease internals are never serialized to clients.

Limits: 32 files and 128 MiB per attempt; individual PDF 32 MiB, ZIP 64 MiB, PNG/JPEG 16 MiB, text/Markdown/JSON 2 MiB. Preview is inline only for authenticated image requests with `?inline=1`; other downloads use attachment disposition and all use `nosniff` plus a restrictive CSP.

Abandoned/previous attempt objects remain private for recovery and currently require an operator retention policy. No scheduled cleanup or automatic model retry is included. Storage validation checks basic file signatures, not PDF/ZIP semantic contents; source identity and evidence validation belong to the worker.

Cloudflare references: [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/), [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
