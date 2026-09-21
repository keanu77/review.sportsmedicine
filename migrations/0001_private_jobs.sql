CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  input TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('queued','running','needs_review','completed','failed','cancelled')),
  phase TEXT NOT NULL CHECK(phase IN ('research','render')),
  stage TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  draft TEXT,
  design TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  attempt_id TEXT,
  lease_hash TEXT,
  lease_expires_at INTEGER,
  worker_id TEXT
);
CREATE INDEX jobs_queue ON jobs(status, created_at);
-- The database enforces one running job even when claim requests race.
CREATE UNIQUE INDEX one_running_job ON jobs((1)) WHERE status = 'running';
CREATE TABLE artifacts (
  job_id TEXT NOT NULL REFERENCES jobs(id),
  id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  committed INTEGER NOT NULL DEFAULT 0 CHECK(committed IN (0,1)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(job_id, id)
);
CREATE INDEX artifact_attempt ON artifacts(job_id, attempt_id, committed);
CREATE TABLE worker_presence (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  worker_id TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  capabilities TEXT NOT NULL
);
