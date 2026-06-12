import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../migrate.js";
import * as schema from "../schema.js";

describe("runMigrations", () => {
  it("创建 sessions/messages/summaries/model_capability_cache 四张表", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema });

    runMigrations(db);

    const result = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableNames = result.map((r) => r.name);

    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("summaries");
    expect(tableNames).toContain("model_capability_cache");
  });

  it("重复执行不会报错", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite, { schema });

    runMigrations(db);
    runMigrations(db);

    const result = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(result.length).toBe(4);
  });
});
