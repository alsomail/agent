const provider = (process.env.LLM_PROVIDER ?? "ollama") as "ollama" | "anthropic";
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const isAnthropicConfigured = Boolean(anthropicApiKey);

// 仅当 provider=anthropic 时要求 API Key
if (provider === "anthropic" && !anthropicApiKey) {
  console.error("[Config] LLM_PROVIDER=anthropic 但未配置 ANTHROPIC_API_KEY");
  process.exit(1);
}

export const config = {
  provider,
  anthropicApiKey: anthropicApiKey ?? "",
  isAnthropicConfigured,
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  defaultModel:
    process.env.DEFAULT_MODEL ?? (provider === "ollama" ? "llama3.2" : "claude-sonnet-4-20250514"),
  port: Number.parseInt(process.env.PORT ?? "3001", 10),
} as const;
