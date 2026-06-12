import { sql } from "drizzle-orm";
import type { DrizzleDB } from "./index.js";

export function runMigrations(db: DrizzleDB): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      system_prompt TEXT,
      state TEXT NOT NULL DEFAULT 'idle',
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS model_capability_cache (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      model TEXT,
      digest TEXT,
      modified_at TEXT,
      template_hash TEXT,
      modelfile_hash TEXT,
      details_hash TEXT,
      tools_status TEXT NOT NULL,
      tools_confidence REAL NOT NULL,
      tools_reason TEXT,
      source TEXT NOT NULL,
      probe_prompt_version TEXT NOT NULL,
      detected_at TEXT,
      expires_at TEXT,
      last_probe_error TEXT
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_model_capability_cache_provider_name
    ON model_capability_cache(provider, name)
  `);
}
