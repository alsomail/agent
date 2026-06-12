import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

// ─── model_capability_cache 表 ───

export const modelCapabilityCache = sqliteTable("model_capability_cache", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  model: text("model"),
  digest: text("digest"),
  modifiedAt: text("modified_at"),
  templateHash: text("template_hash"),
  modelfileHash: text("modelfile_hash"),
  detailsHash: text("details_hash"),
  toolsStatus: text("tools_status").notNull(),
  toolsConfidence: real("tools_confidence").notNull(),
  toolsReason: text("tools_reason"),
  source: text("source").notNull(),
  probePromptVersion: text("probe_prompt_version").notNull(),
  detectedAt: text("detected_at"),
  expiresAt: text("expires_at"),
  lastProbeError: text("last_probe_error"),
});
