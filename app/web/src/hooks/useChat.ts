import type { ModelInfo, ProviderInfo, SessionListItem } from "@myagent/protocol";
import { useCallback, useRef, useState } from "react";
import {
  deleteSession as apiDeleteSession,
  createSession,
  fetchMessages,
  fetchModels,
  fetchProviders,
  fetchSessions,
  streamChat,
} from "../api/client.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function storedMessagesToChatMessages(
  messages: Array<{ id: string; role: string; content: string }>,
): ChatMessage[] {
  return messages.map((m) => {
    let text = "";
    try {
      const blocks = JSON.parse(m.content) as Array<{ type: string; text?: string }>;
      text = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    } catch {
      text = m.content;
    }
    return {
      id: m.id,
      role: m.role as "user" | "assistant",
      content: text,
    };
  });
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentText, setCurrentText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // 会话列表状态
  const [sessions, setSessions] = useState<SessionListItem[]>([]);

  // Provider/Model 选择状态
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("ollama");
  const [selectedModel, setSelectedModel] = useState<string>("");

  const controllerRef = useRef<AbortController | null>(null);

  // 拉取 Provider 列表
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

  const handleProviderChange = useCallback((providerId: string) => {
    setSelectedProvider(providerId);
    setSelectedModel("");
  }, []);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // 切换会话
  const switchSession = useCallback(async (id: string) => {
    try {
      const msgs = await fetchMessages(id);
      setMessages(storedMessagesToChatMessages(msgs));
      setSessionId(id);
      setCurrentText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载消息失败");
    }
  }, []);

  // 新建会话（接受明确的 model 参数，不使用硬编码 fallback）
  const createNewSession = useCallback(
    async (explicitModel?: string) => {
      try {
        const model = explicitModel || selectedModel;
        if (!model) {
          setError("请先选择一个模型");
          return;
        }
        const session = await createSession(selectedProvider, model);
        setSessionId(session.id);
        setMessages([]);
        setCurrentText("");
        setError(null);
        // 更新列表
        const list = await loadSessions();
        if (!list.find((s) => s.id === session.id)) {
          setSessions((prev) => [
            {
              id: session.id,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              model: session.model,
              provider: session.provider,
              messageCount: session.messageCount,
            } as SessionListItem,
            ...prev,
          ]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "创建会话失败");
      }
    },
    [selectedProvider, selectedModel, loadSessions],
  );

  // 删除会话
  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await apiDeleteSession(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (sessionId === id) {
          setSessionId(null);
          setMessages([]);
          setCurrentText("");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除会话失败");
      }
    },
    [sessionId],
  );

  // 初始化：加载 Provider → 加载模型列表 → 选第一个模型 → 加载/创建会话
  const initialize = useCallback(async () => {
    // 1. 先拉取 Provider
    try {
      const providerList = await fetchProviders();
      setProviders(providerList);
      const firstAvailable = providerList.find((p) => p.available);
      if (firstAvailable) {
        setSelectedProvider(firstAvailable.id);
      }
    } catch {
      // Provider 加载失败不阻塞
    }

    // 2. 加载会话列表
    const list = await loadSessions();

    if (list.length > 0) {
      await switchSession(list[0].id);
      return;
    }

    // 3. 无现有会话 → 自动创建：先加载模型，选第一个
    const provider = selectedProvider || "ollama";
    try {
      const models = await fetchModels(provider);
      if (models.length > 0) {
        const firstModel = models[0].name;
        setSelectedModel(firstModel);
        await createSession(provider, firstModel).then(async (session) => {
          setSessionId(session.id);
          setMessages([]);
          setCurrentText("");
          setError(null);
          const updatedList = await loadSessions();
          if (!updatedList.find((s) => s.id === session.id)) {
            setSessions((prev) => [
              {
                id: session.id,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                model: session.model,
                provider: session.provider,
                messageCount: session.messageCount,
              } as SessionListItem,
              ...prev,
            ]);
          }
        });
      } else {
        setError("未找到可用模型，请先启动 Ollama 或检查 API Key");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载模型列表");
    }
  }, [selectedProvider, loadSessions, switchSession]);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      const sid = sessionId;
      if (!sid) {
        await initialize();
        return;
      }

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
              loadSessions();
              break;
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        const message = err instanceof Error ? err.message : "请求失败";
        setError(message);
        setIsStreaming(false);
      } finally {
        setIsStreaming(false);
      }
    },
    [isStreaming, sessionId, initialize, loadSessions],
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
    // 会话管理
    sessions,
    sessionId,
    loadSessions,
    switchSession,
    createNewSession,
    deleteSession: handleDeleteSession,
    initialize,
  };
}
