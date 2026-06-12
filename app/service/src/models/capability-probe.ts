import { createHash } from "node:crypto";
import type {
  ModelCapabilityProbeRequest,
  ModelCapabilityResponse,
  ModelIdentity,
} from "@myagent/protocol";
import { config } from "../config.js";
import { listOllamaModels, showOllamaModel } from "../llm/providers/ollama/client.js";
import { createOllamaProvider } from "../llm/providers/ollama/index.js";
import { createCurrentTimeTool } from "../tools/built-in/current-time.js";
import { toToolDefinition } from "../tools/types.js";
import { logger } from "../utils/logger.js";
import {
  MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
  buildProbingModelCapabilities,
  buildUnknownModelCapabilities,
  createCapabilityResult,
  createCapabilityToolState,
  getCachedModelCapabilities,
  saveModelCapabilities,
} from "./capability-cache.js";

interface CapabilityProbeDeps {
  baseUrl?: string;
  now?: () => Date;
  listModels?: typeof listOllamaModels;
  showModel?: typeof showOllamaModel;
  runRuntimeProbe?: (params: {
    model: string;
    baseUrl: string;
    signal?: AbortSignal;
  }) => Promise<RuntimeProbeObservation>;
}

interface RuntimeProbeObservation {
  hasStructuredToolCall: boolean;
  text: string;
}

const inFlightProbes = new Map<string, Promise<ModelCapabilityResponse>>();

export async function getModelCapabilities(
  input: ModelCapabilityProbeRequest,
  deps?: CapabilityProbeDeps,
): Promise<ModelCapabilityResponse> {
  const identity = await resolveOllamaIdentity(input.model, deps);
  const cached = await getCachedModelCapabilities(identity, {
    now: deps?.now?.(),
    probePromptVersion: MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
  });

  if (cached) {
    return { capabilities: cached, cacheHit: true };
  }

  if (inFlightProbes.has(getProbeKey(identity))) {
    return {
      capabilities: buildProbingModelCapabilities(identity),
      cacheHit: false,
    };
  }

  return {
    capabilities: buildUnknownModelCapabilities(identity),
    cacheHit: false,
  };
}

export async function probeModelCapabilities(
  input: ModelCapabilityProbeRequest,
  deps?: CapabilityProbeDeps,
): Promise<ModelCapabilityResponse> {
  const identity = await resolveOllamaIdentity(input.model, deps);
  const key = getProbeKey(identity);
  const activeProbe = inFlightProbes.get(key);
  if (activeProbe) {
    return activeProbe;
  }

  const probePromise = runCapabilityProbe(input, identity, deps).finally(() => {
    inFlightProbes.delete(key);
  });

  inFlightProbes.set(key, probePromise);
  return probePromise;
}

async function runCapabilityProbe(
  input: ModelCapabilityProbeRequest,
  identity: ModelIdentity,
  deps?: CapabilityProbeDeps,
): Promise<ModelCapabilityResponse> {
  const now = deps?.now?.() ?? new Date();

  try {
    const observation = await (deps?.runRuntimeProbe ?? runOllamaRuntimeProbe)({
      model: input.model,
      baseUrl: deps?.baseUrl ?? config.ollamaBaseUrl,
    });
    const toolNames = [createCurrentTimeTool().name];
    const toolIntent = detectToolIntentWithoutCall(observation.text, toolNames);

    if (toolIntent.detected) {
      logger.warn("Tool intent detected without actual tool call", {
        model: input.model,
        provider: input.provider,
        matchedTools: toolIntent.matchedTools,
        preview: observation.text.slice(0, 200),
      });
    }

    const tools = observation.hasStructuredToolCall
      ? createCapabilityToolState({
          status: "supported",
          source: input.forceRefresh ? "manual_refresh" : "runtime_probe",
          confidence: 1,
          reason: "Runtime probe returned structured tool_calls.",
          now,
        })
      : toolIntent.detected
        ? createCapabilityToolState({
            status: "unstable",
            source: input.forceRefresh ? "manual_refresh" : "runtime_probe",
            confidence: 0.35,
            reason: "Model mentioned tool usage in text but returned no structured tool_calls.",
            now,
          })
        : createCapabilityToolState({
            status: "unsupported",
            source: input.forceRefresh ? "manual_refresh" : "runtime_probe",
            confidence: 0.8,
            reason: "Runtime probe returned plain text without tool_calls.",
            now,
          });

    const capabilities = createCapabilityResult(identity, tools);
    await saveModelCapabilities({
      capabilities,
      probePromptVersion: MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
    });
    return { capabilities, cacheHit: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model capability probe failed";
    const capabilities = createCapabilityResult(
      identity,
      createCapabilityToolState({
        status: "error",
        source: input.forceRefresh ? "manual_refresh" : "runtime_probe",
        confidence: 0,
        reason: "Model capability probe failed.",
        lastProbeError: message,
        now,
      }),
    );

    await saveModelCapabilities({
      capabilities,
      probePromptVersion: MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
    });
    return { capabilities, cacheHit: false };
  }
}

async function resolveOllamaIdentity(
  modelName: string,
  deps?: CapabilityProbeDeps,
): Promise<ModelIdentity> {
  const listModels = deps?.listModels ?? listOllamaModels;
  const showModel = deps?.showModel ?? showOllamaModel;
  const baseUrl = deps?.baseUrl ?? config.ollamaBaseUrl;

  const tags = await listModels(baseUrl);
  const matched = tags.models.find((model) => model.name === modelName);
  if (!matched) {
    throw new Error(`Ollama 模型不存在: ${modelName}`);
  }

  const details = await showModel(modelName, baseUrl);

  return {
    provider: "ollama",
    name: matched.name,
    model: matched.model || details.model || undefined,
    digest: matched.digest || undefined,
    modifiedAt: matched.modified_at || details.modified_at || undefined,
    templateHash: hashText(details.template),
    modelfileHash: hashText(details.modelfile),
    detailsHash: hashStableValue({
      parameters: details.parameters,
      details: details.details,
      modelInfo: details.model_info,
      tagDetails: matched.details,
    }),
  };
}

async function runOllamaRuntimeProbe(params: {
  model: string;
  baseUrl: string;
  signal?: AbortSignal;
}): Promise<RuntimeProbeObservation> {
  const provider = createOllamaProvider({ baseUrl: params.baseUrl });
  const tools = [toToolDefinition(createCurrentTimeTool())];
  let hasStructuredToolCall = false;
  let text = "";

  for await (const event of provider.stream({
    model: params.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "If tool use is available, call current_time exactly once. Do not answer before the tool call.",
          },
        ],
      },
    ],
    maxTokens: 128,
    system:
      "You are being tested for tool calling support. Call the provided current_time tool if you can.",
    tools,
    signal: params.signal,
  })) {
    if (event.type === "content_block_start" && event.blockType === "tool_use") {
      hasStructuredToolCall = true;
    }

    if (event.type === "text_delta") {
      text = `${text}${event.text}`;
    }
  }

  return {
    hasStructuredToolCall,
    text,
  };
}

function detectToolIntentWithoutCall(text: string, toolNames: string[]) {
  const normalizedText = text.toLowerCase();
  const matchedTools = toolNames.filter((toolName) =>
    normalizedText.includes(toolName.toLowerCase()),
  );
  const mentionsIntent =
    /应该使用|我会使用|我将使用|需要使用|应该调用|我会调用|我将调用|需要调用|use tool|call tool|i should use|i should call/i.test(
      text,
    );

  return {
    detected: matchedTools.length > 0 && mentionsIntent,
    matchedTools,
  };
}

function getProbeKey(identity: ModelIdentity) {
  return [
    identity.provider,
    identity.name,
    identity.model ?? "",
    identity.digest ?? "",
    identity.modifiedAt ?? "",
    identity.templateHash ?? "",
    identity.modelfileHash ?? "",
    identity.detailsHash ?? "",
    MODEL_CAPABILITY_PROBE_PROMPT_VERSION,
  ].join(":");
}

function hashText(value?: string) {
  if (!value) {
    return undefined;
  }

  return createHash("sha256").update(value).digest("hex");
}

function hashStableValue(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = stableStringify(value);
  if (!normalized || normalized === "{}") {
    return undefined;
  }

  return createHash("sha256").update(normalized).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`);

  return `{${entries.join(",")}}`;
}
