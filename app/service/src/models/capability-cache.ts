import type {
  ModelCapabilities,
  ModelCapabilitySource,
  ModelIdentity,
  ModelToolCapability,
  ModelToolSupportStatus,
} from "@myagent/protocol";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { modelCapabilityCache } from "../db/schema.js";

const SUPPORTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SHORT_TTL_MS = 24 * 60 * 60 * 1000;
export const MODEL_CAPABILITY_PROBE_PROMPT_VERSION = "phase-03-tools-v1";

interface SaveModelCapabilitiesParams {
  capabilities: ModelCapabilities;
  probePromptVersion?: string;
}

interface ModelCapabilityLookupOptions {
  now?: Date;
  probePromptVersion?: string;
}

export function buildUnknownModelCapabilities(identity: ModelIdentity): ModelCapabilities {
  return {
    identity,
    tools: {
      status: "unknown",
      source: "none",
      confidence: 0,
    },
  };
}

export function buildProbingModelCapabilities(identity: ModelIdentity): ModelCapabilities {
  return {
    identity,
    tools: {
      status: "probing",
      source: "none",
      confidence: 0,
    },
  };
}

export function isModelCapabilityCacheValid(
  cached: ModelCapabilities,
  current: ModelIdentity,
  options?: {
    now?: Date;
    probePromptVersion?: string;
    cachedProbePromptVersion?: string | null;
  },
): boolean {
  const now = options?.now ?? new Date();
  const expectedPromptVersion =
    options?.probePromptVersion ?? MODEL_CAPABILITY_PROBE_PROMPT_VERSION;

  if (cached.identity.provider !== current.provider || cached.identity.name !== current.name) {
    return false;
  }

  if (
    options?.cachedProbePromptVersion &&
    options.cachedProbePromptVersion !== expectedPromptVersion
  ) {
    return false;
  }

  if (cached.tools.expiresAt && new Date(cached.tools.expiresAt).getTime() <= now.getTime()) {
    return false;
  }

  if (cached.identity.digest && current.digest && cached.identity.digest !== current.digest) {
    return false;
  }

  if (
    cached.identity.modifiedAt &&
    current.modifiedAt &&
    cached.identity.modifiedAt !== current.modifiedAt
  ) {
    return false;
  }

  if (hasChanged(cached.identity.templateHash, current.templateHash)) {
    return false;
  }

  if (hasChanged(cached.identity.modelfileHash, current.modelfileHash)) {
    return false;
  }

  if (hasChanged(cached.identity.detailsHash, current.detailsHash)) {
    return false;
  }

  return true;
}

export async function getCachedModelCapabilities(
  identity: ModelIdentity,
  options?: ModelCapabilityLookupOptions,
): Promise<ModelCapabilities | null> {
  const db = getDb();
  const rows = db
    .select()
    .from(modelCapabilityCache)
    .where(
      and(
        eq(modelCapabilityCache.provider, identity.provider),
        eq(modelCapabilityCache.name, identity.name),
      ),
    )
    .orderBy(desc(modelCapabilityCache.detectedAt))
    .all();

  for (const row of rows) {
    const capabilities = rowToCapabilities(row);
    if (
      isModelCapabilityCacheValid(capabilities, identity, {
        now: options?.now,
        probePromptVersion: options?.probePromptVersion,
        cachedProbePromptVersion: row.probePromptVersion,
      })
    ) {
      return {
        identity,
        tools: {
          ...capabilities.tools,
          source: "cache",
        },
      };
    }
  }

  return null;
}

export async function saveModelCapabilities(params: SaveModelCapabilitiesParams): Promise<void> {
  const db = getDb();
  const { capabilities } = params;

  db.delete(modelCapabilityCache)
    .where(buildIdentityWhereClause(capabilities.identity, params.probePromptVersion))
    .run();

  db.insert(modelCapabilityCache)
    .values({
      id: crypto.randomUUID(),
      provider: capabilities.identity.provider,
      name: capabilities.identity.name,
      model: capabilities.identity.model ?? null,
      digest: capabilities.identity.digest ?? null,
      modifiedAt: capabilities.identity.modifiedAt ?? null,
      templateHash: capabilities.identity.templateHash ?? null,
      modelfileHash: capabilities.identity.modelfileHash ?? null,
      detailsHash: capabilities.identity.detailsHash ?? null,
      toolsStatus: capabilities.tools.status,
      toolsConfidence: capabilities.tools.confidence,
      toolsReason: capabilities.tools.reason ?? null,
      source: capabilities.tools.source,
      probePromptVersion: params.probePromptVersion ?? MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
      detectedAt: capabilities.tools.detectedAt ?? null,
      expiresAt: capabilities.tools.expiresAt ?? null,
      lastProbeError: capabilities.tools.lastProbeError ?? null,
    })
    .run();
}

export async function downgradeModelCapabilitiesToUnstable(params: {
  identity: ModelIdentity;
  now?: Date;
  source?: ModelCapabilitySource;
  reason?: string;
}): Promise<void> {
  const cached = await getCachedModelCapabilities(params.identity, {
    now: params.now,
    probePromptVersion: MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
  });

  if (!cached || cached.tools.status !== "supported") {
    return;
  }

  await saveModelCapabilities({
    capabilities: createCapabilityResult(
      params.identity,
      createCapabilityToolState({
        status: "unstable",
        source: params.source ?? "runtime_probe",
        confidence: 0.35,
        reason:
          params.reason ??
          "Model mentioned tool usage in text during chat but returned no structured tool_calls.",
        now: params.now,
      }),
    ),
    probePromptVersion: MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
  });
}

export function createCapabilityResult(identity: ModelIdentity, tools: ModelToolCapability) {
  return {
    identity,
    tools,
  } satisfies ModelCapabilities;
}

export function createCapabilityToolState(params: {
  status: ModelToolSupportStatus;
  source: ModelCapabilitySource;
  confidence: number;
  now?: Date;
  reason?: string;
  lastProbeError?: string;
}): ModelToolCapability {
  const now = params.now ?? new Date();

  return {
    status: params.status,
    source: params.source,
    confidence: params.confidence,
    reason: params.reason,
    detectedAt:
      params.status === "unknown" || params.status === "probing" ? undefined : now.toISOString(),
    expiresAt:
      params.status === "unknown" || params.status === "probing"
        ? undefined
        : new Date(now.getTime() + getTtlMs(params.status)).toISOString(),
    lastProbeError: params.lastProbeError,
  };
}

function getTtlMs(status: ModelToolSupportStatus): number {
  return status === "supported" || status === "unsupported" ? SUPPORTED_TTL_MS : SHORT_TTL_MS;
}

function buildIdentityWhereClause(
  identity: ModelIdentity,
  probePromptVersion = MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
) {
  return and(
    eq(modelCapabilityCache.provider, identity.provider),
    eq(modelCapabilityCache.name, identity.name),
    matchNullableIdentityField(modelCapabilityCache.model, identity.model),
    matchNullableIdentityField(modelCapabilityCache.digest, identity.digest),
    matchNullableIdentityField(modelCapabilityCache.modifiedAt, identity.modifiedAt),
    matchNullableIdentityField(modelCapabilityCache.templateHash, identity.templateHash),
    matchNullableIdentityField(modelCapabilityCache.modelfileHash, identity.modelfileHash),
    matchNullableIdentityField(modelCapabilityCache.detailsHash, identity.detailsHash),
    eq(modelCapabilityCache.probePromptVersion, probePromptVersion),
  );
}

function matchNullableIdentityField(
  column:
    | typeof modelCapabilityCache.model
    | typeof modelCapabilityCache.digest
    | typeof modelCapabilityCache.modifiedAt
    | typeof modelCapabilityCache.templateHash
    | typeof modelCapabilityCache.modelfileHash
    | typeof modelCapabilityCache.detailsHash,
  value: string | undefined,
) {
  return value === undefined ? isNull(column) : eq(column, value);
}

function hasChanged(previous?: string, next?: string): boolean {
  return Boolean(previous && next && previous !== next);
}

function rowToCapabilities(row: typeof modelCapabilityCache.$inferSelect): ModelCapabilities {
  return {
    identity: {
      provider: row.provider as ModelIdentity["provider"],
      name: row.name,
      model: row.model ?? undefined,
      digest: row.digest ?? undefined,
      modifiedAt: row.modifiedAt ?? undefined,
      templateHash: row.templateHash ?? undefined,
      modelfileHash: row.modelfileHash ?? undefined,
      detailsHash: row.detailsHash ?? undefined,
    },
    tools: {
      status: row.toolsStatus as ModelToolSupportStatus,
      source: row.source as ModelCapabilitySource,
      confidence: row.toolsConfidence,
      reason: row.toolsReason ?? undefined,
      detectedAt: row.detectedAt ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      lastProbeError: row.lastProbeError ?? undefined,
    },
  };
}
