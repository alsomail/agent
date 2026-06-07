import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

let dbInstance: ReturnType<typeof drizzle> | null = null;

function getDbPath(): string {
  const projectRoot = path.resolve(process.cwd(), "../..");
  return path.join(projectRoot, ".data", "myagent.db");
}

function ensureDbDir(): void {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function initDb(): ReturnType<typeof drizzle> {
  if (dbInstance) {
    return dbInstance;
  }

  ensureDbDir();
  const sqlite = new Database(getDbPath());
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  dbInstance = drizzle(sqlite, { schema });
  return dbInstance;
}

// 测试专用：注入内存数据库
export function setTestDb(testDb: ReturnType<typeof drizzle>): void {
  dbInstance = testDb;
}

export function getDb(): ReturnType<typeof drizzle> {
  if (!dbInstance) {
    throw new Error("数据库未初始化，请先调用 initDb()");
  }
  return dbInstance;
}

export type DrizzleDB = ReturnType<typeof initDb>;
