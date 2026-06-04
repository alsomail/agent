import { z } from "zod";

export const TextDeltaEventSchema = z.object({
  type: z.literal("text_delta"),
  text: z.string(),
});

export const ToolCallStartEventSchema = z.object({
  type: z.literal("tool_call_start"),
  toolCallId: z.string(),
  toolName: z.string(),
});

export const ToolCallDeltaEventSchema = z.object({
  type: z.literal("tool_call_delta"),
  toolCallId: z.string(),
  partialJson: z.string(),
});

export const ToolResultEventSchema = z.object({
  type: z.literal("tool_result"),
  toolCallId: z.string(),
  toolName: z.string(),
  result: z.string(),
  isError: z.boolean(),
});

export const StateChangeEventSchema = z.object({
  type: z.literal("state_change"),
  state: z.enum(["streaming", "tool_executing", "completed", "error", "aborted"]),
});

export const ErrorEventSchema = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
});

export const DoneEventSchema = z.object({
  type: z.literal("done"),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
});

export const StreamEventSchema = z.discriminatedUnion("type", [
  TextDeltaEventSchema,
  ToolCallStartEventSchema,
  ToolCallDeltaEventSchema,
  ToolResultEventSchema,
  StateChangeEventSchema,
  ErrorEventSchema,
  DoneEventSchema,
]);

export type TextDeltaEvent = z.infer<typeof TextDeltaEventSchema>;
export type ToolCallStartEvent = z.infer<typeof ToolCallStartEventSchema>;
export type ToolCallDeltaEvent = z.infer<typeof ToolCallDeltaEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type DoneEvent = z.infer<typeof DoneEventSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
