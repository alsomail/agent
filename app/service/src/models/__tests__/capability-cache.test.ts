import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTestDb } from "../../db/index.js";
import { runMigrations } from "../../db/migrate.js";
import * as schema from "../../db/schema.js";
import {
  MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
  buildUnknownModelCapabilities,
  createCapabilityResult,
  createCapabilityToolState,
  downgradeModelCapabilitiesToUnstable,
  getCachedModelCapabilities,
  isModelCapabilityCacheValid,
  saveModelCapabilities,
} from "../capability-cache.js";

const baseIdentity = {
  provider: "ollama" as const,
  name: "qwen3:8b",
  model: "qwen3:8b",
  digest: "sha256:abc",
  modifiedAt: "2026-06-12T00:00:00.000Z",
  templateHash: "template-1",
  modelfileHash: "modelfile-1",
  detailsHash: "details-1",
};

describe("capability-cache", () => {
  beforeEach(() => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    setTestDb(db);
    runMigrations(db);
  });

  afterEach(() => {
    setTestDb(null as unknown as ReturnType<typeof drizzle>);
  });

  it("缓存命中时直接返回 cache source", async () => {
    const capabilities = createCapabilityResult(
      baseIdentity,
      createCapabilityToolState({
        status: "supported",
        source: "runtime_probe",
        confidence: 1,
        now: new Date("2026-06-12T00:00:00.000Z"),
      }),
    );

    await saveModelCapabilities({ capabilities });

    const cached = await getCachedModelCapabilities(baseIdentity, {
      now: new Date("2026-06-12T12:00:00.000Z"),
    });

    expect(cached?.tools.status).toBe("supported");
    expect(cached?.tools.source).toBe("cache");
  });

  it("digest 变化时缓存失效", async () => {
    const capabilities = createCapabilityResult(
      baseIdentity,
      createCapabilityToolState({
        status: "supported",
        source: "runtime_probe",
        confidence: 1,
        now: new Date("2026-06-12T00:00:00.000Z"),
      }),
    );

    await saveModelCapabilities({ capabilities });

    const cached = await getCachedModelCapabilities(
      {
        ...baseIdentity,
        digest: "sha256:def",
      },
      {
        now: new Date("2026-06-12T12:00:00.000Z"),
      },
    );

    expect(cached).toBeNull();
  });

  it("prompt version 变化时缓存失效", () => {
    const cached = createCapabilityResult(
      baseIdentity,
      createCapabilityToolState({
        status: "unsupported",
        source: "runtime_probe",
        confidence: 0.8,
        now: new Date("2026-06-12T00:00:00.000Z"),
      }),
    );

    expect(
      isModelCapabilityCacheValid(cached, baseIdentity, {
        now: new Date("2026-06-12T01:00:00.000Z"),
        probePromptVersion: "phase-03-tools-v2",
        cachedProbePromptVersion: MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
      }),
    ).toBe(false);
  });

  it("同名不同身份的缓存可并存，读取时命中当前身份", async () => {
    await saveModelCapabilities({
      capabilities: createCapabilityResult(
        baseIdentity,
        createCapabilityToolState({
          status: "supported",
          source: "runtime_probe",
          confidence: 1,
          now: new Date("2026-06-12T00:00:00.000Z"),
        }),
      ),
    });
    await saveModelCapabilities({
      capabilities: createCapabilityResult(
        {
          ...baseIdentity,
          digest: "sha256:def",
          modifiedAt: "2026-06-13T00:00:00.000Z",
          templateHash: "template-2",
          modelfileHash: "modelfile-2",
          detailsHash: "details-2",
        },
        createCapabilityToolState({
          status: "unsupported",
          source: "runtime_probe",
          confidence: 0.8,
          now: new Date("2026-06-13T00:00:00.000Z"),
        }),
      ),
    });

    const cached = await getCachedModelCapabilities(baseIdentity, {
      now: new Date("2026-06-13T12:00:00.000Z"),
    });

    expect(cached?.tools.status).toBe("supported");
    expect(cached?.identity.digest).toBe("sha256:abc");
  });

  it("支持状态可按当前身份降级为 unstable", async () => {
    await saveModelCapabilities({
      capabilities: createCapabilityResult(
        baseIdentity,
        createCapabilityToolState({
          status: "supported",
          source: "runtime_probe",
          confidence: 1,
          now: new Date("2026-06-12T00:00:00.000Z"),
        }),
      ),
    });

    await downgradeModelCapabilitiesToUnstable({
      identity: baseIdentity,
      now: new Date("2026-06-12T12:00:00.000Z"),
      reason: "tool intent without tool_use",
    });

    const cached = await getCachedModelCapabilities(baseIdentity, {
      now: new Date("2026-06-12T12:01:00.000Z"),
    });

    expect(cached?.tools.status).toBe("unstable");
    expect(cached?.tools.reason).toBe("tool intent without tool_use");
  });

  it("unknown 构造结果不包含伪造时间字段", () => {
    const unknown = buildUnknownModelCapabilities(baseIdentity);

    expect(unknown.tools.status).toBe("unknown");
    expect(unknown.tools.detectedAt).toBeUndefined();
    expect(unknown.tools.expiresAt).toBeUndefined();
  });
});
