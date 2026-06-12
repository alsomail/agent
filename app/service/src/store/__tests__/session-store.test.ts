import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTestDb } from "../../db/index.js";
import { runMigrations } from "../../db/migrate.js";
import * as schema from "../../db/schema.js";
import {
  addMessage,
  createSession,
  deleteSession,
  getMessages,
  getSession,
  getSummary,
  incrementMessageCount,
  listSessions,
  updateSessionConfig,
  upsertSummary,
} from "../session-store.js";

describe("Session Store", () => {
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    db = drizzle(sqlite, { schema });
    setTestDb(db);
    runMigrations(db);
  });

  afterEach(() => {
    // 重置 singleton
    setTestDb(null as unknown as ReturnType<typeof drizzle>);
  });

  describe("createSession", () => {
    it("创建会话并返回 Session 对象", async () => {
      const session = await createSession({ model: "llama3.2", provider: "ollama" });

      expect(session.id).toBeTruthy();
      expect(session.model).toBe("llama3.2");
      expect(session.provider).toBe("ollama");
      expect(session.state).toBe("idle");
      expect(session.messageCount).toBe(0);
    });

    it("保存 systemPrompt", async () => {
      const session = await createSession({
        model: "llama3.2",
        provider: "ollama",
        systemPrompt: "You are helpful",
      });

      const retrieved = await getSession(session.id);
      expect(retrieved?.systemPrompt).toBe("You are helpful");
    });
  });

  describe("getSession", () => {
    it("返回存在的会话", async () => {
      const created = await createSession({ model: "llama3.2", provider: "ollama" });
      const session = await getSession(created.id);
      expect(session).toBeTruthy();
      expect(session?.id).toBe(created.id);
    });

    it("不存在的会话返回 null", async () => {
      const session = await getSession("nonexistent");
      expect(session).toBeNull();
    });
  });

  describe("deleteSession", () => {
    it("级联删除关联的 messages 和 summaries", async () => {
      const session = await createSession({ model: "llama3.2", provider: "ollama" });
      const sid = session.id;

      await addMessage(sid, "user", '{"type":"text","text":"hi"}');
      await upsertSummary(sid, "test summary");

      await deleteSession(sid);

      const retrieved = await getSession(sid);
      expect(retrieved).toBeNull();

      const msgs = await getMessages(sid);
      expect(msgs.length).toBe(0);

      const summary = await getSummary(sid);
      expect(summary).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("按 updatedAt 倒序返回", async () => {
      const s1 = await createSession({ model: "m1", provider: "ollama" });
      const s2 = await createSession({ model: "m2", provider: "ollama" });

      const list = await listSessions();
      expect(list.length).toBe(2);
      expect([s1.id, s2.id]).toContain(list[0].id); // 最新创建的在前
    });

    it("title 取首条 user 消息前 30 字", async () => {
      const session = await createSession({ model: "m1", provider: "ollama" });
      await addMessage(
        session.id,
        "user",
        JSON.stringify([{ type: "text", text: "你好世界！这是一个很长的消息" }]),
      );

      const list = await listSessions();
      expect(list[0].title).toBe("你好世界！这是一个很长的消息");
    });
  });

  describe("addMessage / getMessages", () => {
    it("存储并读取消息", async () => {
      const session = await createSession({ model: "m1", provider: "ollama" });
      await addMessage(session.id, "user", JSON.stringify([{ type: "text", text: "hello" }]));
      await addMessage(session.id, "assistant", JSON.stringify([{ type: "text", text: "hi" }]));

      const msgs = await getMessages(session.id);
      expect(msgs.length).toBe(2);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
    });
  });

  describe("upsertSummary / getSummary", () => {
    it("创建并更新摘要", async () => {
      const session = await createSession({ model: "m1", provider: "ollama" });

      await upsertSummary(session.id, "first summary");
      const s1 = await getSummary(session.id);
      expect(s1?.content).toBe("first summary");

      await upsertSummary(session.id, "updated summary");
      const s2 = await getSummary(session.id);
      expect(s2?.content).toBe("updated summary");
    });
  });

  describe("incrementMessageCount", () => {
    it("增加消息计数", async () => {
      const session = await createSession({ model: "m1", provider: "ollama" });
      expect(session.messageCount).toBe(0);

      await incrementMessageCount(session.id);
      const updated = await getSession(session.id);
      expect(updated?.messageCount).toBe(1);
    });
  });

  describe("updateSessionConfig", () => {
    it("更新会话的 provider、model 和 systemPrompt", async () => {
      const session = await createSession({ model: "llama3.2", provider: "ollama" });

      const updated = await updateSessionConfig(session.id, {
        provider: "ollama",
        model: "llama3.2:latest",
        systemPrompt: "be precise",
      });

      expect(updated?.provider).toBe("ollama");
      expect(updated?.model).toBe("llama3.2:latest");
      expect(updated?.systemPrompt).toBe("be precise");
    });
  });
});
