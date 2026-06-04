import type { ModelInfo, ProviderInfo } from "@myagent/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSession, fetchProviders, streamChat } from "../api/client.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Provider/Model 选择状态
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("ollama");
  const [selectedModel, setSelectedModel] = useState<string>("");

  const controllerRef = useRef<AbortController | null>(null);

  // 拉取 Provider 列表并自动选择第一个可用的
  const fetchProvidersAndModels = useCallback(async () => {
    try {
      const list = await fetchProviders();
      setProviders(list);
      const firstAvailable = list.find((p) => p.available);
      if (firstAvailable) {
        setSelectedProvider(firstAvailable.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取 Provider 列表失败");
    }
  }, []);

  // Provider 切换时重置模型选择
  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedProvider(providerId);
    setSelectedModel("");
  }, []);

  const ensureSession = useCallback(async (): Promise<string> => {
    const provider = selectedProvider || "ollama";
    const model = selectedModel || "llama3.2";

    const id = await createSession(provider, model);
    setSessionId(id);
    return id;
  }, [selectedProvider, selectedModel]);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      controllerRef.current?.abort();

      const controller = new AbortController();
      controllerRef.current = controller;

      const msgId = crypto.randomUUID();
      const userMsg: ChatMessage = {
        id: msgId,
        role: "user",
        content: content.trim(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setCurrentText("");
      setError(null);

      let accumulated = "";

      try {
        const sid = await ensureSession();

        for await (const event of streamChat(sid, content.trim(), controller.signal)) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case "text_delta":
              accumulated += event.text;
              setCurrentText(accumulated);
              break;

            case "error":
              setError(event.message);
              setIsStreaming(false);
              break;

            case "done":
              setMessages((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: accumulated,
                },
              ]);
              setCurrentText("");
              break;
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const message = err instanceof Error ? err.message : "请求失败";
        setError(message);
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming, ensureSession],
  );

  return {
    messages,
    isStreaming,
    currentText,
    error,
    send,
    dismissError: () => setError(null),
    // Provider/Model 选择
    providers,
    selectedProvider,
    selectedModel,
    setSelectedModel,
    fetchProvidersAndModels,
    handleProviderChange,
  };
}
