import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ─── sessions 表 ───

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  systemPrompt: text("system_prompt"),
  state: text("state").notNull().default("idle"),
  messageCount: integer("message_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─── messages 表 ───

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(), // JSON 序列化的 ContentBlock[]
  tokenCount: integer("token_count"),
  createdAt: text("created_at").notNull(),
});

// ─── summaries 表 ───

export const summaries = sqliteTable("summaries", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  tokenCount: integer("token_count"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
