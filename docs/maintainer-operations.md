# Maintainer operations

[Public quickstart](../README.md#run-locally) · [Data sources](data-sources.md) · [Security](../SECURITY.md)

This document keeps data-generation and owner-workbench operations separate from the public contributor setup. Commands below describe repository workflows; they do not assert that a deployment, scheduled run, model provider, or private service is currently healthy. Use dated verification records and direct checks for those claims.

## Public index and data updates

The public React/Vite application consumes checked-in JSON. The complete upstream catalog-generation pipeline is maintained outside this repository. Do not put a durable correction only in `reviews-index.json`: a subsequent upstream sync can replace it.

[Monthly data sync](../.github/workflows/sync-data.yml) is scheduled for day 1 at 03:00 Asia/Taipei, with catch-up attempts at 12:00 on day 1 and 01:00 on day 2. It accepts the expected monthly batch, preserves the current data if that batch is unavailable, validates a proposed update, and publishes through a separate constrained job. Manual runs default to verification without publication (`apply_updates=false`).

[Monthly website maintenance](../.github/workflows/monthly-maintenance.yml) runs on day 2 at 03:00 Asia/Taipei. It tests compatible dependency changes and records a separate maintenance report. Check the actual workflow and [dated maintenance reports](maintenance/) before interpreting a scheduled outcome. A configured schedule alone is not evidence of a successful run.

To produce the new-items comparison, keep the previous snapshot before replacing the index:

```sh
node scripts/build-new-items.mjs <previous-index.json> public/data/reviews-index.json public/data/new-items.json
```

The comparison identifies additions to a rolling catalog, not publication dates. Do not overwrite a useful previous comparison with an empty “new” batch when the source has not changed.

## Bibliography, summaries, tags, and feed

These are maintainer commands, not requirements for running the public site:

```sh
node --import tsx scripts/build-bibliography.ts --limit 25
node --import tsx scripts/build-readiness.ts
```

The bibliography builder queries Europe PMC, preserves matched source provenance, and records unresolved items. `--refresh` bypasses its response cache; `--reprocess` reapplies the current parser to cached responses. The source cache is outside the repository; `BIBLIOGRAPHY_CACHE_DIR` can select another external cache location. Do not commit raw source-response caches or locally retained full abstract text merely because it was accessible through an API.

Chinese summary generation requires a running local Ollama-compatible service. Set `OLLAMA_HOST` if it is not at the script's default local address; select an installed model with `--model`:

```sh
node --import tsx scripts/build-summaries.mjs --limit 25 --model <installed-model>
node --import tsx scripts/build-readiness.ts
npm run feed
```

The full-source cache from the bibliography step supports generation when the public overlay contains only an excerpt. The generator requires matched source material, records missing/failed attempts, and applies mechanical checks before saving. These checks do not constitute clinical review. `--all` rebuilds into a candidate and replaces the existing summary file only after the required run conditions pass; inspect the candidate and reported failures.

The separate new-items and tag workflows remain available:

```sh
npm run summarize
npm run tags
npm run tags -- --tag pediatric
npm run audit:summaries
```

`npm run summarize` generates new-item summaries using a local model and then updates the feed. Tags are an overlay on the upstream categories; review their source criteria and false matches. Generate the feed after the relevant summary update so it carries the intended text. Inspect every generated-data diff and preserve source/license boundaries described in [data sources](data-sources.md).

## Validation

```sh
npm run typecheck
npm run test:frontend
npm run build
npm run preview
```

For the broader application checks, install Chromium and make `ffmpeg` available first:

```sh
npx playwright install chromium
npm test
npm run test:renderer
npm run test:integration
npm run test:smoke -- --workers=2
npm run test:local-api
```

`test:smoke` builds a fresh `dist/` and starts its own preview server on port 4180; it does not reuse an existing preview. The other suites cover different boundaries: worker/API fixtures, real browser rendering, local workerd/D1/R2, and worker-to-API integration. None alone establishes production access, real provider behavior, clinical quality, or a natural scheduled run. The current full CI command set is in [verify.yml](../.github/workflows/verify.yml).

The public site is deployed through the repository's Cloudflare Pages integration. Verify the intended commit and build, then check the public UI and relevant routes after a deployment. Cloning the repository does not grant access to the existing Cloudflare resources.

## Owner-only workbench

The repository includes the private literature-to-social-draft workflow, but the hosted `/workbench` and its private APIs are restricted to the configured owner. Public use of the index does not grant workbench access or access to a model subscription, source document, draft, or storage bucket.

- [Worker setup and activation](worker-setup.md): local CLI prerequisites, background worker, cloud bindings, and service checks.
- [Worker credential management](worker-credentials.md): credential setup, rotation, rollback, and local file requirements.
- [Security boundaries](../SECURITY.md): owner authentication, worker authorization, and secret handling.
- [Initial verification](verification-2026-09-21.md), [follow-up improvements](verification-improvements-2026-09-22.md), and [review-version gate verification](verification-2026-09-26-review-gate.md): dated historical evidence, not claims of current health.

```sh
npm run worker:doctor
```

The doctor checks local prerequisites; it does not prove the production queue or every configured provider works. The Mac worker must be awake, connected, and running for queued work to progress. Its private artifacts and originals stay separate from publicly exported social assets. Drafting, review, rendering, and downloading do not automatically publish to social networks.

Do not place real credentials in the checkout, commands, frontend bundle, screenshots, or issue reports. Keep private setup outside public quickstart instructions, and follow the linked setup documentation rather than treating deployment-specific configuration as portable defaults.
