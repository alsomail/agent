import type {
  AgentState,
  ContentBlock,
  LLMProvider,
  ModelCapabilities,
  ProviderInfo,
  Session,
  SessionListItem,
  StoredMessage,
  StreamEvent,
  ToolUseContentBlock,
} from "@myagent/protocol";
import { useCallback, useRef, useState } from "react";
import {
  deleteSession as apiDeleteSession,
  probeModelCapabilities as apiProbeModelCapabilities,
  createSession,
  fetchMessages,
  fetchModelCapabilities,
  fetchModels,
  fetchProviders,
  fetchSession,
  fetchSessions,
  streamChat,
  updateSession,
} from "../api/client.js";
import { ANTHROPIC_MODELS, getDefaultAnthropicModel } from "../lib/provider-models.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface PendingToolCall {
  toolCallId: string;
  toolName: string;
  partialJson: string;
  status: "streaming" | "executing";
}

export interface StreamingState {
  messages: ChatMessage[];
  streamingText: string;
  pendingToolCalls: PendingToolCall[];
  pendingBatchCommitted: boolean;
  agentState: AgentState | "idle";
}

export function createCapabilityErrorState(
  provider: "ollama",
  model: string,
  message: string,
): ModelCapabilities {
  return {
    identity: {
      provider,
      name: model,
    },
    tools: {
      status: "error",
      source: "none",
      confidence: 0,
      reason: message,
      lastProbeError: message,
    },
  };
}

export function storedMessagesToChatMessages(messages: StoredMessage[]): ChatMessage[] {
  return messages.map((m) => {
    let content: ContentBlock[] = [];
    try {
      content = JSON.parse(m.content) as ContentBlock[];
    } catch {
      content = [{ type: "text", text: m.content }];
    }
    return {
      id: m.id,
      role: m.role as "user" | "assistant",
      content,
    };
  });
}

export function createStreamingState(messages: ChatMessage[] = []): StreamingState {
  return {
    messages,
    streamingText: "",
    pendingToolCalls: [],
    pendingBatchCommitted: false,
    agentState: "idle",
  };
}

export function resolveRequestedModel(
  explicitModel: string | null | undefined,
  selectedModel: string,
): string {
  return typeof explicitModel === "string" && explicitModel.trim().length > 0
    ? explicitModel
    : selectedModel;
}

export function createClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function applyStreamEvent(state: StreamingState, event: StreamEvent): StreamingState {
  switch (event.type) {
    case "text_delta":
      return {
        ...state,
        streamingText: `${state.streamingText}${event.text}`,
      };

    case "tool_call_start":
      return {
        ...state,
        pendingToolCalls: [
          ...state.pendingToolCalls,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            partialJson: "",
            status: "streaming",
          },
        ],
      };

    case "tool_call_delta":
      return {
        ...state,
        pendingToolCalls: state.pendingToolCalls.map((toolCall) =>
          toolCall.toolCallId === event.toolCallId
            ? {
                ...toolCall,
                partialJson: `${toolCall.partialJson}${event.partialJson}`,
              }
            : toolCall,
        ),
      };

    case "tool_result":
      return commitToolResult(state, event);

    case "done":
      return flushStreamingText({
        ...state,
        pendingBatchCommitted: false,
      });

    case "state_change":
      return {
        ...state,
        agentState: event.state,
        ...(event.state === "tool_executing"
          ? {
              pendingToolCalls: state.pendingToolCalls.map((toolCall) => ({
                ...toolCall,
                status: "executing",
              })),
            }
          : {}),
        ...(event.state === "streaming" && state.agentState === "tool_executing"
          ? {
              pendingToolCalls: [],
              pendingBatchCommitted: false,
            }
          : {}),
      };

    case "error":
      return {
        ...state,
        agentState: "error",
      };
  }
}

export function useChat() {
  const [streamState, setStreamState] = useState<StreamingState>(createStreamingState());
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // 会话列表状态
  const [sessions, setSessions] = useState<SessionListItem[]>([]);

  // Provider/Model 选择状态
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProvider>("ollama");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelCapabilities, setModelCapabilities] = useState<ModelCapabilities | null>(null);
  const [isLoadingModelCapabilities, setIsLoadingModelCapabilities] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef(0);
  const capabilityRequestRef = useRef(0);

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

  const loadModelCapabilities = useCallback(async (provider: LLMProvider, model: string) => {
    const requestId = capabilityRequestRef.current + 1;
    capabilityRequestRef.current = requestId;

    if (provider !== "ollama" || !model) {
      setIsLoadingModelCapabilities(false);
      setModelCapabilities(null);
      return;
    }

    setIsLoadingModelCapabilities(true);

    try {
      const result = await fetchModelCapabilities("ollama", model);
      if (capabilityRequestRef.current !== requestId) {
        return;
      }
      setModelCapabilities(result.capabilities);
    } catch (err) {
      if (capabilityRequestRef.current !== requestId) {
        return;
      }
      const message = err instanceof Error ? err.message : "加载模型能力失败";
      setModelCapabilities(createCapabilityErrorState("ollama", model, message));
    } finally {
      if (capabilityRequestRef.current === requestId) {
        setIsLoadingModelCapabilities(false);
      }
    }
  }, []);

  const syncSessionSelection = useCallback(
    (session: Pick<Session, "provider" | "model">) => {
      setSelectedProvider(session.provider);
      setSelectedModel(session.model);
      void loadModelCapabilities(session.provider, session.model);
    },
    [loadModelCapabilities],
  );

  const resolveValidSession = useCallback(
    async (
      sessionList: SessionListItem[],
      providerList: ProviderInfo[],
    ): Promise<SessionListItem | null> => {
      const modelCache = new Map<string, Set<string>>();

      for (const session of sessionList) {
        const providerInfo = providerList.find((provider) => provider.id === session.provider);
        if (!providerInfo?.available) {
          continue;
        }

        if (session.provider === "ollama") {
          if (!modelCache.has("ollama")) {
            try {
              const models = await fetchModels("ollama");
              modelCache.set("ollama", new Set(models.map((model) => model.name)));
            } catch {
              modelCache.set("ollama", new Set());
            }
          }

          if (!modelCache.get("ollama")?.has(session.model)) {
            continue;
          }
        }

        return session;
      }

      return null;
    },
    [],
  );

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

  const applySessionConfig = useCallback(
    async (next: { provider?: LLMProvider; model?: string }) => {
      if (!sessionId) {
        return null;
      }

      const updatedSession = await updateSession(sessionId, next);
      syncSessionSelection(updatedSession);
      await loadSessions();
      return updatedSession;
    },
    [loadSessions, sessionId, syncSessionSelection],
  );

  const handleProviderChange = useCallback(
    async (providerId: LLMProvider) => {
      const previousProvider = selectedProvider;
      const previousModel = selectedModel;

      setSelectedProvider(providerId);
      setError(null);

      try {
        let nextModel = previousModel;

        if (providerId === "anthropic") {
          nextModel = getDefaultAnthropicModel();
        } else {
          const models = await fetchModels("ollama");
          if (models.length === 0) {
            throw new Error("未找到可用模型，请先启动 Ollama 或检查模型是否已下载");
          }

          const matchedModel = models.find((model) => model.name === previousModel);
          nextModel = matchedModel?.name ?? models[0].name;
        }

        setSelectedModel(nextModel);
        void loadModelCapabilities(providerId, nextModel);
        await applySessionConfig({ provider: providerId, model: nextModel });
      } catch (err) {
        setSelectedProvider(previousProvider);
        setSelectedModel(previousModel);
        void loadModelCapabilities(previousProvider, previousModel);
        setError(err instanceof Error ? err.message : "更新 Provider 失败");
      }
    },
    [applySessionConfig, loadModelCapabilities, selectedModel, selectedProvider],
  );

  const handleModelChange = useCallback(
    async (modelName: string) => {
      const previousModel = selectedModel;
      setSelectedModel(modelName);
      setError(null);
      void loadModelCapabilities(selectedProvider, modelName);

      try {
        await applySessionConfig({ provider: selectedProvider, model: modelName });
      } catch (err) {
        setSelectedModel(previousModel);
        void loadModelCapabilities(selectedProvider, previousModel);
        setError(err instanceof Error ? err.message : "更新模型失败");
      }
    },
    [applySessionConfig, loadModelCapabilities, selectedModel, selectedProvider],
  );

  // 切换会话
  const switchSession = useCallback(
    async (id: string) => {
      try {
        controllerRef.current?.abort();
        activeRequestRef.current += 1;
        const [session, msgs] = await Promise.all([fetchSession(id), fetchMessages(id)]);
        syncSessionSelection(session);
        setStreamState(createStreamingState(storedMessagesToChatMessages(msgs)));
        setSessionId(id);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载消息失败");
      }
    },
    [syncSessionSelection],
  );

  // 新建会话（接受明确的 model 参数，不使用硬编码 fallback）
  const createNewSession = useCallback(
    async (explicitModel?: string) => {
      try {
        const model = resolveRequestedModel(explicitModel, selectedModel);
        if (!model) {
          setError("请先选择一个模型");
          return;
        }
        const session = await createSession(selectedProvider, model);
        setSessionId(session.id);
        syncSessionSelection(session);
        setStreamState(createStreamingState());
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
    [selectedProvider, selectedModel, loadSessions, syncSessionSelection],
  );

  // 删除会话
  const handleDeleteSession = useCallback(
    async (id: string) => {
      try {
        await apiDeleteSession(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (sessionId === id) {
          controllerRef.current?.abort();
          activeRequestRef.current += 1;
          setSessionId(null);
          setStreamState(createStreamingState());
          setModelCapabilities(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除会话失败");
      }
    },
    [sessionId],
  );

  // 初始化：加载 Provider → 加载模型列表 → 选第一个模型 → 加载/创建会话
  const initialize = useCallback(async () => {
    let providerList: ProviderInfo[] = [];

    // 1. 先拉取 Provider
    try {
      providerList = await fetchProviders();
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
    const validSession = await resolveValidSession(list, providerList);

    if (validSession) {
      await switchSession(validSession.id);
      return;
    }

    // 3. 无现有会话 → 自动创建：先加载模型，选第一个
    const provider = providerListFirstAvailable(providerList);
    if (!provider) {
      setError("没有可用 Provider");
      return;
    }
    try {
      const models = provider === "anthropic" ? ANTHROPIC_MODELS : await fetchModels(provider);
      if (models.length > 0) {
        const firstModel = models[0].name;
        setSelectedModel(firstModel);
        await loadModelCapabilities(provider, firstModel);
        await createSession(provider, firstModel).then(async (session) => {
          setSessionId(session.id);
          syncSessionSelection(session);
          setStreamState(createStreamingState());
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
    if (list.length > 0 && !validSession) {
      setError("现有会话使用的模型已不可用，已跳过，请选择当前可用模型后新建会话。");
    }
  }, [
    loadModelCapabilities,
    loadSessions,
    resolveValidSession,
    switchSession,
    syncSessionSelection,
  ]);

  const probeSelectedModelCapabilities = useCallback(async () => {
    if (selectedProvider !== "ollama" || !selectedModel) {
      return;
    }

    const requestId = capabilityRequestRef.current + 1;
    capabilityRequestRef.current = requestId;
    setIsLoadingModelCapabilities(true);
    setError(null);

    try {
      const result = await apiProbeModelCapabilities("ollama", selectedModel);
      if (capabilityRequestRef.current !== requestId) {
        return;
      }
      setModelCapabilities(result.capabilities);
    } catch (err) {
      if (capabilityRequestRef.current !== requestId) {
        return;
      }
      const message = err instanceof Error ? err.message : "探测模型能力失败";
      setError(message);
      setModelCapabilities(createCapabilityErrorState("ollama", selectedModel, message));
    } finally {
      if (capabilityRequestRef.current === requestId) {
        setIsLoadingModelCapabilities(false);
      }
    }
  }, [selectedModel, selectedProvider]);

  const send = useCallback(
    async (content: string) => {
      if (!content.trim() || isStreaming) return;

      let targetSessionId = sessionId;
      if (!targetSessionId) {
        const model = resolveRequestedModel(undefined, selectedModel);
        if (!model) {
          setError("请先选择一个模型");
          return;
        }

        try {
          const session = await createSession(selectedProvider, model);
          targetSessionId = session.id;
          setSessionId(session.id);
          syncSessionSelection(session);
          setStreamState(createStreamingState());
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
        } catch (err) {
          setError(err instanceof Error ? err.message : "创建会话失败");
          return;
        }
      }

      controllerRef.current?.abort();

      const controller = new AbortController();
      controllerRef.current = controller;
      const requestId = activeRequestRef.current + 1;
      activeRequestRef.current = requestId;

      const msgId = createClientId();
      const userMsg: ChatMessage = {
        id: msgId,
        role: "user",
        content: [{ type: "text", text: content.trim() }],
      };

      setStreamState((prev) => ({
        ...createStreamingState([...prev.messages, userMsg]),
        agentState: "streaming",
      }));
      setIsStreaming(true);
      setError(null);

      try {
        for await (const event of streamChat(targetSessionId, content.trim(), controller.signal)) {
          if (controller.signal.aborted || activeRequestRef.current !== requestId) {
            break;
          }

          if (event.type === "error") {
            setError(event.message);
          }

          setStreamState((prev) => applyStreamEvent(prev, event));

          if (event.type === "done") {
            await loadSessions();
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
    [isStreaming, sessionId, selectedModel, selectedProvider, syncSessionSelection, loadSessions],
  );

  return {
    messages: streamState.messages,
    isStreaming,
    currentText: streamState.streamingText,
    pendingToolCalls: streamState.pendingToolCalls,
    agentState: streamState.agentState,
    error,
    send,
    dismissError: () => setError(null),
    // Provider/Model 选择
    providers,
    selectedProvider,
    selectedModel,
    modelCapabilities,
    isLoadingModelCapabilities,
    probeSelectedModelCapabilities,
    setSelectedModel: handleModelChange,
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

function commitToolResult(
  state: StreamingState,
  event: Extract<StreamEvent, { type: "tool_result" }>,
): StreamingState {
  let nextMessages = state.messages;

  if (!state.pendingBatchCommitted && state.pendingToolCalls.length > 0) {
    const assistantBlocks: ContentBlock[] = [];
    if (state.streamingText) {
      assistantBlocks.push({ type: "text", text: state.streamingText });
    }

    assistantBlocks.push(
      ...state.pendingToolCalls.map((toolCall) => ({
        type: "tool_use" as const,
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        input: parseToolInput(toolCall.partialJson),
      })),
    );

    nextMessages = [
      ...nextMessages,
      {
        id: createClientId(),
        role: "assistant",
        content: assistantBlocks,
      },
    ];
  }

  nextMessages = [
    ...nextMessages,
    {
      id: createClientId(),
      role: "user",
      content: [
        {
          type: "tool_result",
          toolUseId: event.toolCallId,
          content: event.result,
          isError: event.isError,
        },
      ],
    },
  ];

  return {
    ...state,
    messages: nextMessages,
    streamingText: state.pendingBatchCommitted ? state.streamingText : "",
    pendingBatchCommitted: true,
    pendingToolCalls: state.pendingToolCalls.filter(
      (toolCall) => toolCall.toolCallId !== event.toolCallId,
    ),
  };
}

function flushStreamingText(state: StreamingState): StreamingState {
  if (!state.streamingText) {
    return {
      ...state,
      agentState: "completed",
    };
  }

  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: createClientId(),
        role: "assistant",
        content: [{ type: "text", text: state.streamingText }],
      },
    ],
    streamingText: "",
    agentState: "completed",
  };
}

function parseToolInput(partialJson: string): ToolUseContentBlock["input"] {
  try {
    const parsed = JSON.parse(partialJson || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function providerListFirstAvailable(providers: ProviderInfo[]): LLMProvider | null {
  return providers.find((provider) => provider.available)?.id ?? null;
}
