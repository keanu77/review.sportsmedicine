# Temporary dependency audit exception

Proposed on 2026-11-18; expires after 2026-12-18 (UTC).

The full npm audit remains enabled through `npm run audit:security`. Unknown moderate, high, and critical findings, audit errors, and production dependency paths block publication. The raw report is retained as `dependency-audit.json` in workflow artifacts, and every use of an exception emits a warning and a job summary.

## GHSA-fc5q-39xc-vjpf

- [Advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf): picomatch repeated-extglob regular-expression denial of service. On 2026-11-18 the advisory lists no patched version and npm's latest version is 4.0.7.
- Scope: exactly picomatch 4.0.7, this advisory's high-severity `<=4.0.7` range, and audit findings caused exclusively by that advisory. Every affected node must be marked development-only in the lockfile. Additional advisories, production paths, version changes, critical severity, and expiry are rejected.
- Exposure assessment: picomatch is in the Vite build-tool dependency tree. The public deployment serves compiled static assets and Pages Functions; it does not run the Vite development server. Current application code does not accept user-controlled glob patterns. A malicious build input can still affect build availability; this is a temporary risk acceptance, not a vulnerability fix.
- Follow-up: monthly dependency maintenance continues; replace the exception with an upstream fix when released. Review it before expiry. After expiry, affected updates fail visibly and daily sync continues retrying without replacing existing data. Do not extend automatically.

`fast-xml-parser` is updated within its existing major range to an available patched version; it has no exception.
