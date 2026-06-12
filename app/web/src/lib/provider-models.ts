import type { ModelInfo } from "@myagent/protocol";

export const ANTHROPIC_MODELS: ModelInfo[] = [
  { name: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4", provider: "anthropic" },
  { name: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", provider: "anthropic" },
];

export function getDefaultAnthropicModel(): string {
  return ANTHROPIC_MODELS[0].name;
}
