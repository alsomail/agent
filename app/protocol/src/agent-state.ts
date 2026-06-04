import { z } from "zod";

export const AgentStateEnum = z.enum([
  "idle",
  "streaming",
  "tool_executing",
  "completed",
  "error",
  "aborted",
]);

export type AgentState = z.infer<typeof AgentStateEnum>;
