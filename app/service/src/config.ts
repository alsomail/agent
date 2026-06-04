const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error("[Config] 缺少 ANTHROPIC_API_KEY，请在 .env 中配置");
  process.exit(1);
}

export const config = {
  anthropicApiKey: ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-20250514",
  port: Number.parseInt(process.env.PORT ?? "3001", 10),
} as const;
