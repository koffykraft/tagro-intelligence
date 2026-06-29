-- TAGRO OS — D1 Database Schema
-- Run: npx wrangler d1 execute tagro-db --file=schema.sql

CREATE TABLE IF NOT EXISTS service_jobs (
  id              TEXT PRIMARY KEY,
  work_order      TEXT NOT NULL,
  branch          TEXT NOT NULL,
  customer_name   TEXT,
  customer_phone  TEXT,
  machine_model   TEXT,
  machine_serial  TEXT,
  machine_category TEXT,
  complaint       TEXT,
  status          TEXT,     -- derived from last timeline event, stored for indexing only
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  timeline_json   TEXT      -- full timeline as JSON
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_branch    ON service_jobs(branch);
CREATE INDEX IF NOT EXISTS idx_jobs_serial    ON service_jobs(machine_serial);
CREATE INDEX IF NOT EXISTS idx_jobs_phone     ON service_jobs(customer_phone);
CREATE INDEX IF NOT EXISTS idx_jobs_status    ON service_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_updated   ON service_jobs(updated_at);

-- Work order counter table (alternative to KV for truly atomic counters)
CREATE TABLE IF NOT EXISTS wo_counters (
  branch_month  TEXT PRIMARY KEY,  -- e.g. "KVR_2606"
  counter       INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT
);
