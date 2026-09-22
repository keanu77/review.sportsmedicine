# Publication period filter

User requested recent one-month, six-month and one-year literature search filters.

Use a publication-time select beside the existing year filter, with an unrestricted default. Combine filters with AND semantics and persist `period=1m|6m|1y` in the URL. Calendar-month subtraction is inclusive through the reader's local current date and clamps month-end/leap-day boundaries. Reject future, missing, partial and invalid dates from active time ranges; unrestricted browsing retains them.

The old index only provides years. Map Europe PMC `firstPublicationDate` into the durable bibliography overlay and backfill existing records from verified source responses. Explicit null prevents repeatedly refetching date-less records. The [source API documentation](https://europepmc.org/RestfulWebService) notes that this field may infer dates from partial source dates; disclose this in the filter and paper details. Do not treat metadata verification or website update dates as publication dates.

- [x] Add date validation/calendar windows in `src/publicationDate.ts`; source mapping, one-time backfill and enrichment.
- [x] Add URL state, search/browse filter, reset and source-date display.
- [x] Verify calendar boundaries, unknown/future dates, enrichment, URL reload, combined filters and 320px layout.
- [x] Backfill 811 dates; confirm no other bibliographic field changed. Repeat refresh uses cached unresolved lookups and makes no new source requests.

Validation: 31 frontend tests, production build and 21 browser checks passed, including 320px layout and all three time ranges. On 2026-09-22 the bundled data matches 6 / 361 / 565 papers for one / six / twelve months.

Release procedure: commit and push the scoped changes, then verify the Cloudflare canonical commit and all three live filter options.

No private API, worker, database, Access or existing raw index changes are required.
