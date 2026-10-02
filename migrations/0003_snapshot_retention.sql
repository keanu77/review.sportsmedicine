-- Owner saves may merge with the previous owner save of the same two-minute window
-- (server/store.mjs edit()). Additive only: existing snapshots stay 0 and are never merged.
ALTER TABLE draft_versions ADD COLUMN mergeable INTEGER NOT NULL DEFAULT 0;
