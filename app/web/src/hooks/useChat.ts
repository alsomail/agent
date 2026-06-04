import { useCallback, useRef, useState } from "react";
import { createSession, streamChat } from "../api/client.js";

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

  const controllerRef = useRef<AbortController | null>(null);

  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const id = await createSession();
    setSessionId(id);
    return id;
  }, [sessionId]);

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
  };
}
