import type { ModelInfo, ProviderInfo, StreamEvent } from "@myagent/protocol";

export async function* streamChat(
  sessionId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const response = await fetch(`/api/session/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      (error as { error?: { message?: string } })?.error?.message ??
        `Chat request failed: ${response.status}`,
    );
  }

  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n\n")) {
        const idx = buffer.indexOf("\n\n");
        const block = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 2);

        const dataMatch = block.match(/^data:\s*(.+)$/m);
        if (dataMatch) {
          const event = JSON.parse(dataMatch[1]) as StreamEvent;
          yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function fetchProviders(): Promise<ProviderInfo[]> {
  const response = await fetch("/api/providers");
  if (!response.ok) throw new Error("Failed to fetch providers");
  const body = await response.json();
  return (body as { providers: ProviderInfo[] }).providers;
}

export async function fetchModels(provider: string): Promise<ModelInfo[]> {
  const response = await fetch(`/api/models?provider=${encodeURIComponent(provider)}`);
  if (!response.ok) throw new Error("Failed to fetch models");
  const body = await response.json();
  return (body as { models: ModelInfo[] }).models;
}

export async function createSession(provider = "ollama", model = "llama3.2"): Promise<string> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }

  const body = await response.json();
  return (body as { data: { id: string } }).data.id;
}
