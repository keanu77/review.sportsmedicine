-- Additive migration: old worker operations and existing jobs remain valid.
ALTER TABLE jobs ADD COLUMN review_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN restored_from INTEGER;
CREATE TABLE draft_versions (
  job_id TEXT NOT NULL REFERENCES jobs(id),
  revision INTEGER NOT NULL,
  draft TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored_from INTEGER,
  PRIMARY KEY(job_id, revision)
);
INSERT INTO draft_versions(job_id, revision, draft, created_at)
  SELECT id, revision, draft, updated_at FROM jobs WHERE draft IS NOT NULL;
CREATE TRIGGER snapshot_draft AFTER UPDATE OF draft ON jobs
WHEN NEW.draft IS NOT NULL AND (OLD.draft IS NULL OR NEW.draft <> OLD.draft)
BEGIN
  INSERT INTO draft_versions(job_id, revision, draft, created_at, restored_from)
  VALUES(NEW.id, NEW.revision, NEW.draft, NEW.updated_at, NEW.restored_from);
END;
CREATE TABLE review_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  draft_revision INTEGER,
  reviews TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX review_runs_job ON review_runs(job_id, created_at);
-- Old reviews may predate manual edits; their draft version is deliberately unknown.
INSERT INTO review_runs(id, job_id, reviews, created_at)
  SELECT 'legacy-' || id, id, json_extract(metadata,'$.reviews'), updated_at FROM jobs
  WHERE json_type(metadata,'$.reviews')='array';
CREATE TABLE review_dispositions (
  run_id TEXT NOT NULL REFERENCES review_runs(id),
  provider TEXT NOT NULL,
  finding_index INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','resolved','rejected')),
  reason TEXT NOT NULL DEFAULT '',
  draft_revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, provider, finding_index)
);
-- A completed legacy render corresponds to the saved draft at migration time.
UPDATE jobs SET metadata=json_set(metadata,'$.render.draftRevision',revision)
  WHERE status='completed' AND draft IS NOT NULL AND json_type(metadata,'$.render')='object';
