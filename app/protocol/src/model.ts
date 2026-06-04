import { z } from "zod";

export const ModelInfoSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  size: z.number().optional(),
  provider: z.enum(["ollama", "anthropic"]),
});

export const ModelListQuerySchema = z.object({
  provider: z.enum(["ollama"]),
});

export const ModelListResponseSchema = z.object({
  models: z.array(ModelInfoSchema),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;
