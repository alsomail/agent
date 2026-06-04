import type { AnthropicMessageRequest } from "./types.js";
import { AnthropicApiError } from "./types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";

export async function callAnthropicStream(
  params: AnthropicMessageRequest,
  apiKey: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ReadableStream<Uint8Array>> {
  const url = `${baseUrl ?? DEFAULT_BASE_URL}/v1/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new AnthropicApiError(response.status, errorBody);
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  return response.body;
}
