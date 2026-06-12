import type { OllamaChatRequest, OllamaShowResponse, OllamaTagsResponse } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

// POST /api/chat (stream)
export async function callOllamaChatStream(
  params: OllamaChatRequest,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<ReadableStream<Uint8Array>> {
  const url = `${baseUrl ?? DEFAULT_BASE_URL}/api/chat`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, stream: true }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Ollama API error: ${response.status} ${errorBody}`);
  }

  if (!response.body) {
    throw new Error("Ollama response body is null");
  }

  return response.body;
}

// GET /api/tags (list models)
export async function listOllamaModels(baseUrl?: string): Promise<OllamaTagsResponse> {
  const url = `${baseUrl ?? DEFAULT_BASE_URL}/api/tags`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Ollama tags error: ${response.status}`);
  }

  return response.json() as Promise<OllamaTagsResponse>;
}

export async function showOllamaModel(
  model: string,
  baseUrl?: string,
): Promise<OllamaShowResponse> {
  const url = `${baseUrl ?? DEFAULT_BASE_URL}/api/show`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Ollama show error: ${response.status} ${errorBody}`);
  }

  return response.json() as Promise<OllamaShowResponse>;
}

export async function hasOllamaModel(model: string, baseUrl?: string): Promise<boolean> {
  const tags = await listOllamaModels(baseUrl);
  return tags.models.some((item) => item.name === model);
}
