import type { LLMProvider, Session, SessionListItem, StoredMessage } from "@myagent/protocol";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { messages, sessions, summaries } from "../db/schema.js";

// ─── 会话 CRUD ───

export async function createSession(params: {
  model: string;
  provider: LLMProvider;
  systemPrompt?: string;
}): Promise<Session> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.insert(sessions)
    .values({
      id,
      model: params.model,
      provider: params.provider,
      systemPrompt: params.systemPrompt ?? null,
      state: "idle",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    id,
    model: params.model,
    provider: params.provider,
    messageCount: 0,
    state: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSession(
  id: string,
): Promise<(Session & { systemPrompt?: string }) | null> {
  const db = getDb();
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) return null;
  return {
    id: row.id,
    model: row.model,
    provider: row.provider as LLMProvider,
    state: row.state as Session["state"],
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    systemPrompt: row.systemPrompt ?? undefined,
  };
}

export async function deleteSession(id: string): Promise<void> {
  const db = getDb();
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export async function updateSessionConfig(
  id: string,
  params: {
    model?: string;
    provider?: LLMProvider;
    systemPrompt?: string;
  },
): Promise<(Session & { systemPrompt?: string }) | null> {
  const db = getDb();
  const existing = db.select().from(sessions).where(eq(sessions.id, id)).get();

  if (!existing) {
    return null;
  }

  const nextModel = params.model ?? existing.model;
  const nextProvider = params.provider ?? existing.provider;
  const nextSystemPrompt = params.systemPrompt ?? existing.systemPrompt ?? null;
  const updatedAt = new Date().toISOString();

  db.update(sessions)
    .set({
      model: nextModel,
      provider: nextProvider,
      systemPrompt: nextSystemPrompt,
      updatedAt,
    })
    .where(eq(sessions.id, id))
    .run();

  return {
    id: existing.id,
    model: nextModel,
    provider: nextProvider as LLMProvider,
    state: existing.state as Session["state"],
    messageCount: existing.messageCount,
    createdAt: existing.createdAt,
    updatedAt,
    systemPrompt: nextSystemPrompt ?? undefined,
  };
}

export async function listSessions(): Promise<SessionListItem[]> {
  const db = getDb();
  const allSessions = db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();

  const result: SessionListItem[] = [];
  for (const s of allSessions) {
    const firstMsg = db
      .select()
      .from(messages)
      .where(and(eq(messages.sessionId, s.id), eq(messages.role, "user")))
      .orderBy(messages.createdAt)
      .limit(1)
      .get();

    let title: string | undefined;
    if (firstMsg) {
      try {
        const blocks = JSON.parse(firstMsg.content) as Array<{ type: string; text?: string }>;
        const firstText = blocks.find((b) => b.type === "text")?.text ?? "";
        title = firstText.slice(0, 30);
      } catch {
        title = firstMsg.content.slice(0, 30);
      }
    }

    result.push({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      model: s.model,
      provider: s.provider as LLMProvider,
      messageCount: s.messageCount,
      title,
    });
  }
  return result;
}

export async function updateSessionState(id: string, state: Session["state"]): Promise<void> {
  const db = getDb();
  db.update(sessions)
    .set({ state, updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, id))
    .run();
}

export async function incrementMessageCount(id: string): Promise<void> {
  const db = getDb();
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (row) {
    db.update(sessions)
      .set({
        messageCount: row.messageCount + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, id))
      .run();
  }
}

// ─── 消息 CRUD ───

export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  tokenCount?: number,
): Promise<StoredMessage> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.insert(messages)
    .values({
      id,
      sessionId,
      role,
      content,
      tokenCount: tokenCount ?? null,
      createdAt: now,
    })
    .run();

  return { id, sessionId, role, content, tokenCount, createdAt: now };
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const db = getDb();
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all();

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    role: r.role,
    content: r.content,
    tokenCount: r.tokenCount ?? undefined,
    createdAt: r.createdAt,
  }));
}

// ─── 摘要 CRUD ───

export async function upsertSummary(
  sessionId: string,
  content: string,
  tokenCount?: number,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.select().from(summaries).where(eq(summaries.sessionId, sessionId)).get();

  if (existing) {
    db.update(summaries)
      .set({ content, tokenCount: tokenCount ?? null, updatedAt: now })
      .where(eq(summaries.sessionId, sessionId))
      .run();
  } else {
    db.insert(summaries)
      .values({
        id: crypto.randomUUID(),
        sessionId,
        content,
        tokenCount: tokenCount ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

export async function getSummary(
  sessionId: string,
): Promise<{ content: string; tokenCount?: number } | null> {
  const db = getDb();
  const row = db.select().from(summaries).where(eq(summaries.sessionId, sessionId)).get();
  if (!row) return null;
  return { content: row.content, tokenCount: row.tokenCount ?? undefined };
}
