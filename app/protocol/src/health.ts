import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  uptime: z.number(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
