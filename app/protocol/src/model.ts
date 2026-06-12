import { z } from "zod";

export const ModelProviderEnum = z.enum(["ollama", "anthropic"]);

export const ModelInfoSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  size: z.number().optional(),
  provider: ModelProviderEnum,
  model: z.string().optional(),
  digest: z.string().optional(),
  modifiedAt: z.string().datetime().optional(),
});

export const ModelListQuerySchema = z.object({
  provider: z.enum(["ollama"]),
});

export const ModelListResponseSchema = z.object({
  models: z.array(ModelInfoSchema),
});

export const ModelIdentitySchema = z.object({
  provider: ModelProviderEnum,
  name: z.string().min(1),
  model: z.string().optional(),
  digest: z.string().optional(),
  modifiedAt: z.string().datetime().optional(),
  templateHash: z.string().optional(),
  modelfileHash: z.string().optional(),
  detailsHash: z.string().optional(),
});

export const ModelToolSupportStatusEnum = z.enum([
  "unknown",
  "probing",
  "supported",
  "unsupported",
  "unstable",
  "error",
]);

export const ModelCapabilitySourceEnum = z.enum([
  "none",
  "cache",
  "static_analysis",
  "runtime_probe",
  "manual_refresh",
]);

export const ModelToolCapabilitySchema = z.object({
  status: ModelToolSupportStatusEnum,
  source: ModelCapabilitySourceEnum,
  confidence: z.number().min(0).max(1),
  reason: z.string().optional(),
  detectedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  lastProbeError: z.string().optional(),
});

export const ModelCapabilitiesSchema = z.object({
  identity: ModelIdentitySchema,
  tools: ModelToolCapabilitySchema,
});

export const ModelCapabilityProbeRequestSchema = z.object({
  provider: z.enum(["ollama"]),
  model: z.string().min(1),
  forceRefresh: z.boolean().default(false),
});

export const ModelCapabilityResponseSchema = z.object({
  capabilities: ModelCapabilitiesSchema,
  cacheHit: z.boolean(),
});

export type ModelProvider = z.infer<typeof ModelProviderEnum>;
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type ModelIdentity = z.infer<typeof ModelIdentitySchema>;
export type ModelToolSupportStatus = z.infer<typeof ModelToolSupportStatusEnum>;
export type ModelCapabilitySource = z.infer<typeof ModelCapabilitySourceEnum>;
export type ModelToolCapability = z.infer<typeof ModelToolCapabilitySchema>;
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export type ModelCapabilityProbeRequest = z.infer<typeof ModelCapabilityProbeRequestSchema>;
export type ModelCapabilityResponse = z.infer<typeof ModelCapabilityResponseSchema>;
