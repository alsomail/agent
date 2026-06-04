import { z } from "zod";

export const ProviderInfoSchema = z.object({
  id: z.enum(["ollama", "anthropic"]),
  name: z.string(),
  available: z.boolean(),
  description: z.string().optional(),
});

export const ProviderListResponseSchema = z.object({
  providers: z.array(ProviderInfoSchema),
});

export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;
