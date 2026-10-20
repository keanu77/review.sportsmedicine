# Contributing

English and Traditional Chinese contributions are welcome. The public index helps readers find literature and inspect its sources; the hosted private workbench remains owner-only.

## Good places to start

| Contribution | What makes it reviewable | Relevant files |
| --- | --- | --- |
| Clinical search terms | A query, its intended meaning, matching examples, and terms that must remain distinct | `src/aliases.ts`, `src/search.ts`, `tests/frontend/search-improvements.test.ts` |
| Metadata or access corrections | DOI/PMID, the incorrect field, the proposed value, and a publisher or source-database link | `scripts/bibliography-source.ts`, `src/enrich.ts`, `tests/frontend/bibliography-builder.test.ts` |
| Accessibility or responsive layout | Reproduction steps, browser/viewport, keyboard or assistive-technology behavior, and a screenshot when useful | `src/`, `tests/smoke/` |
| Local library behavior | A minimal example that reproduces import, identity, storage, or citation behavior | `src/libraryStorage.ts`, `src/citation.ts`, `tests/frontend/library-improvements.test.ts` |
| Documentation or translation | The confusing instruction and a concrete replacement | `README.md`, `README.zh-TW.md`, `docs/` |

For a search change, keep symptoms distinct from diagnoses and related treatments distinct from synonyms. For example, a broad query can suggest a narrower topic without declaring the two clinically equivalent. Add a regression example for both a desired match and a likely false match.

For a data correction, cite the original source rather than supplying an unsupported clinical conclusion. Do not upload patient information, copyrighted full-text PDFs, private drafts, credentials, or personal library backups. A reduced synthetic example is usually sufficient.

## Development

Use Node.js 24, matching `.node-version`.

```sh
npm ci
npm run dev
```

The public application runs from the checked-in data with no secrets or model setup. Keep a change focused and run the relevant checks:

```sh
npm run typecheck
npm run test:frontend
npm run build
```

For public UI changes, install the browser once and run the smoke suite:

```sh
npx playwright install chromium
npm run test:smoke -- --workers=2
```

The smoke configuration builds the app and starts its own preview server on port 4180. Close an existing server on that port before running it. Test keyboard use, narrow screens, and light/dark appearance when the change affects them.

`npm test` also runs backend and worker tests. The wider CI suite requires Chromium and `ffmpeg`; service and worker changes may additionally need `test:renderer`, `test:integration`, and `test:local-api`. See [maintainer operations](docs/maintainer-operations.md) and the actual [CI workflow](.github/workflows/verify.yml) for scope. Do not run production jobs or use real provider credentials just to reproduce a public UI issue.

## Data changes

The upstream rolling index is generated outside this repository. Hand-editing `public/data/reviews-index.json` alone will not create a durable correction: the next sync can overwrite it. Report the source record and update the relevant overlay/builder with a regression test where possible. Coordinate upstream-only corrections with the maintainer.

Preserve DOI/PMID/PMCID identity checks and source verification dates. Missing authors, dates, full text, or summaries should remain missing until supported by a source. A title-derived study type or an access heuristic must not become a verified claim. Keep the public abstract/excerpt boundary and each source's reuse terms intact; see [data sources](docs/data-sources.md).

Generated data should have a reproducible command and a bounded explanation of the changed records. Inspect the diff and exclude unrelated generated files, local source caches, and private workbench data.

## Pull requests and reports

Use the issue templates for bugs or feature proposals. Include the smallest reproducible query or paper identifier, expected behavior, actual behavior, and environment. The issue tracker is for the project, not personal medical advice.

In a pull request, explain the problem and resulting behavior, identify any data/source changes, and list the checks actually run. For UI changes, add a screenshot without private information. State any remaining validation limits; passing unit tests does not establish production behavior or clinical accuracy.

Project code contributions follow the existing [MIT license](LICENSE). Third-party material keeps its own applicable terms. Read [SECURITY.md](SECURITY.md) before reporting a security issue; never publish a live secret or private document in an issue.
