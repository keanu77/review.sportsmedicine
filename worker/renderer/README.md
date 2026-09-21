# fb-renew renderer adapter

Vendored from the user's installed `fb-renew/scripts/render-hybrid.mjs`, version `fb-renew-hybrid-v1`, on 2026-09-21. This copy makes the worker portable to Mac Studio without editing a global skill. It preserves manifest input, local-image path checks, geometry validation, staged writes, and backup behavior, and adds `portrait` (1080×1350) alongside `square` (1080×1080).

The upstream workflow requires an existing finalized post. `worker/render.mjs` provides the first-paper adapter, prepares a new version directory and exact source footer, and exports only the current validated version. It does not invoke upstream publishing, messaging, or remote synchronization actions.
