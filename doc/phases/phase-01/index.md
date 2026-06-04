# Phase 1：最小 Agent 循环

> 状态：🔜 待开始
> 前置依赖：Step 0 脚手架（已完成 ✅）
> 预计工作量：2-3 天

---

## 一、目标

用户在浏览器输入消息，服务端转发到 Anthropic API，LLM 的流式响应实时转发回浏览器。

这是整个 Agent 系统的"Hello World"——验证端到端数据通路。完成后你会拥有：

- 一条从浏览器到 LLM 再返回的完整链路
- 手写的 SSE 流解析器（理解流式协议的核心）
- 可扩展的 Provider 抽象（Phase 3 加入工具调用时无需重写）

---

## 二、架构概览

```
浏览器 (React)                    服务端 (Hono)                      LLM API
─────────────                    ──────────────                     ─────────
     │                                │                                 │
     │  POST /api/session/:id/chat    │                                 │
     │  body: { content: "你好" }     │                                 │
     │ ───────────────────────────►   │                                 │
     │                                │  POST https://api.anthropic.com │
     │                                │       /v1/messages              │
     │                                │  body: { stream: true, ... }    │
     │                                │ ───────────────────────────────►│
     │                                │                                 │
     │                                │  ◄── SSE: message_start         │
     │  ◄── SSE: text_delta          │  ◄── SSE: content_block_start   │
     │  ◄── SSE: text_delta          │  ◄── SSE: content_block_delta   │
     │  ◄── SSE: text_delta          │  ◄── SSE: content_block_delta   │
     │  ◄── SSE: done                │  ◄── SSE: message_stop          │
     │                                │                                 │
```

**服务端的角色是"翻译器"**：把 Anthropic 的 SSE 格式翻译成前端能理解的简化 SSE 格式。为什么要翻译（而不是透传）？

1. **解耦**：前端不应该知道后端用的是 Anthropic 还是 OpenAI。换 Provider 时前端零改动。
2. **简化**：Anthropic 的事件类型有 8 种以上，前端只需要关心 4 种（`text_delta`、`done`、`error`、`state_change`）。
3. **安全**：原始响应可能包含 token 用量等内部信息，翻译层可以按需过滤。

> 完整的数据流设计见 [数据流文档](../../architecture/data-flow.md)。LLM 集成层的分层架构和设计原理见 [LLM 集成层架构](../../architecture/llm-integration.md)。

---

## 三、实现模块（按实现顺序）

### 模块 1：归一化类型层（`app/service/src/llm/types/`）

这是最先实现的模块——定义整个 LLM 层的"语言"。所有上层模块都依赖这套类型。

> 类型的完整定义、设计原理、`AsyncIterable` 选型分析见 [LLM 集成层架构 §3 归一化事件类型](../../architecture/llm-integration.md#3-归一化事件类型) 和 [§6 Provider 接口](../../architecture/llm-integration.md#6-provider-接口)。以下仅列出 Phase 1 实现时需要落地的关键类型。

#### `normalized.ts` — 归一化流事件

```typescript
// 判别联合类型：所有 Provider 事件映射到这套类型
// 8 种事件，每种携带不同的字段
type NormalizedStreamEvent =
  | { type: "message_start"; messageId: string; model: string; usage: { inputTokens: number; outputTokens: number } }
  | { type: "content_block_start"; index: number; blockType: "text" | "tool_use"; toolCall?: { id: string; name: string } }
  | { type: "text_delta"; index: number; text: string }
  | { type: "tool_call_delta"; index: number; partialJson: string }          // Phase 3 用到
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; stopReason: "end_turn" | "tool_use" | "max_tokens" | null; usage: { outputTokens: number } }
  | { type: "message_stop" }
  | { type: "error"; error: { type: string; message: string } }
```

Phase 1 核心事件：`text_delta`（转发给前端）、`message_delta`（提取 stopReason）、`error`（错误处理）。

#### `provider.ts` — Provider 接口

```typescript
interface LLMProvider {
  stream(params: LLMStreamParams): AsyncIterable<NormalizedStreamEvent>
}

interface LLMStreamParams {
  model: string
  messages: NormalizedMessage[]
  maxTokens: number
  system?: string
  signal?: AbortSignal
  // Phase 3 加入: tools?: NormalizedToolDefinition[]
}
```

#### `message.ts` — 归一化消息类型

```typescript
interface NormalizedMessage {
  role: "user" | "assistant"
  content: NormalizedContentBlock[]   // 数组而非字符串——为未来 tool_use 预留
}

type NormalizedContentBlock =
  | { type: "text"; text: string }
  // Phase 3 加入:
  // | { type: "tool_use"; id: string; name: string; input: unknown }
  // | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
```

---

### 模块 2：Anthropic HTTP 客户端（`client.ts`）

职责：用原生 `fetch()` 调用 Anthropic Messages API，返回原始字节流。不负责解析。

```typescript
async function callAnthropicStream(
  params: RequestBody,
  apiKey: string,
  signal?: AbortSignal
): Promise<ReadableStream<Uint8Array>> {

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,                 // Anthropic 用自定义 header，非 Bearer token
      "anthropic-version": "2023-06-01",   // API 版本，必填
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: params.messages,
      system: params.system,
      stream: true,                        // 关键：开启流式
    }),
    signal,  // AbortSignal，用于取消
  })

  if (!response.ok) {
    const errorBody = await response.json()
    throw new AnthropicApiError(response.status, errorBody)
  }

  return response.body!  // ReadableStream<Uint8Array>，数据随 LLM 生成持续到达
}
```

**学习要点**：`fetch` 的 `signal` → `AbortController` 取消机制；`response.body` 是流式入口。

---

### 模块 3：SSE 流解析器（`stream-parser.ts`）⭐ 最复杂

职责：把 Anthropic 的原始 SSE 字节流转换为 `NormalizedStreamEvent`。

> Anthropic SSE 流格式和事件生命周期的完整讲解见 [LLM 集成层架构 §4](../../architecture/llm-integration.md#4-anthropic-sse-流格式)。Phase 1 场景（纯文本）的事件序列为：
> ```
> message_start → content_block_start(index=0,type="text") → text_delta ×N → content_block_stop → message_delta(stop_reason="end_turn") → message_stop
> ```

#### 解析算法（伪代码）

```typescript
async function* parseAnthropicStream(
  byteStream: ReadableStream<Uint8Array>
): AsyncIterable<NormalizedStreamEvent> {

  // 字节流 → 文本：TextDecoderStream 负责 UTF-8 解码
  let buffer = ""
  const reader = byteStream
    .pipeThrough(new TextDecoderStream())
    .getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += value

    // 按 \n\n 分割事件 —— buffer 保证完整事件边界
    while (buffer.includes("\n\n")) {
      const eventEndIndex = buffer.indexOf("\n\n")
      const eventBlock = buffer.substring(0, eventEndIndex)
      buffer = buffer.substring(eventEndIndex + 2)

      // 提取 event: 和 data: 行
      const eventType = eventBlock.match(/^event:\s*(.+)$/m)?.[1]?.trim()
      const dataMatch = eventBlock.match(/^data:\s*(.+)$/m)
      if (!eventType || !dataMatch) continue
      if (eventType === "ping") continue  // 心跳，忽略

      const parsed = JSON.parse(dataMatch[1])

      // 映射为归一化事件（switch 分派所有 Anthropic 事件类型）
      switch (parsed.type) {
        case "message_start":
          yield { type: "message_start", messageId: parsed.message.id,
                  model: parsed.message.model, usage: { ... } }
          break
        case "content_block_start":
          yield { type: "content_block_start", index: parsed.index,
                  blockType: parsed.content_block.type,
                  ...(parsed.content_block.type === "tool_use" && {
                    toolCall: { id: parsed.content_block.id, name: parsed.content_block.name }
                  }) }
          break
        case "content_block_delta":
          if (parsed.delta.type === "text_delta")
            yield { type: "text_delta", index: parsed.index, text: parsed.delta.text }
          else if (parsed.delta.type === "input_json_delta")
            yield { type: "tool_call_delta", index: parsed.index, partialJson: parsed.delta.partial_json }
          break
        case "content_block_stop":
          yield { type: "content_block_stop", index: parsed.index }; break
        case "message_delta":
          yield { type: "message_delta", stopReason: parsed.delta.stop_reason, usage: ... }; break
        case "message_stop":
          yield { type: "message_stop" }; break
        case "error":
          yield { type: "error", error: parsed.error }; break
      }
    }
  }
}
```

#### 关键陷阱

1. **Buffer 机制**：一次 `read()` 可能包含多个事件或半个事件。必须用 buffer 累积，仅在看到 `\n\n` 时切割。没有 buffer 的实现**一定**在边界出 bug。
2. **`ping` 事件**：Anthropic 定期发送心跳，必须识别并忽略。
3. **`input_json_delta` 的增量性**：工具调用的 JSON 参数分块到达（`'{"lo'`、`'cation'`），每段都不是合法 JSON。Phase 1 不用处理拼接，但要正确 yield 这些片段。
4. **`TextDecoderStream` 的 `stream` 参数**：解码器自动处理 UTF-8 多字节字符跨 chunk 截断。

---

### 模块 4：消息格式映射器（`mapper.ts`）

把归一化消息转换为 Anthropic API 期望的格式。不同 Provider 的消息格式差异见 [LLM 集成层架构 §4（Provider 差异表）](../../architecture/llm-integration.md)。

```typescript
function toAnthropicMessages(messages: NormalizedMessage[]): AnthropicMessageParam[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content.map(block => {
      if (block.type === "text") return { type: "text" as const, text: block.text }
      // Phase 3: tool_use、tool_result 的映射
      throw new Error(`Unsupported block type: ${(block as { type: string }).type}`)
    }),
  }))
}
```

---

### 模块 5：Anthropic Provider 组装（`index.ts`）

把 client + stream-parser + mapper 组装为 `LLMProvider` 对象。

```typescript
function createAnthropicProvider(config: { apiKey: string }): LLMProvider {
  return {
    async *stream(params: LLMStreamParams) {
      const anthropicMessages = toAnthropicMessages(params.messages)
      const body = { model: params.model, maxTokens: params.maxTokens,
                     messages: anthropicMessages, system: params.system }
      const byteStream = await callAnthropicStream(body, config.apiKey, params.signal)
      yield* parseAnthropicStream(byteStream)  // yield*：委托给另一个 generator
    },
  }
}
```

---

### 模块 6：Provider 工厂（`factory.ts`）

```typescript
function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider({ apiKey: config.apiKey })
    // 未来: case "openai": return createOpenAIProvider(...)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}
```

---

### 模块 7：SSE 中继层（`app/service/src/relay/sse-relay.ts`）

职责：把 `NormalizedStreamEvent` 翻译为客户端 SSE 格式，通过 HTTP 流推送到浏览器。

> 数据流的完整路径（请求流 + 响应流）见 [数据流文档](../../architecture/data-flow.md#1-请求流)。

```typescript
// Hono 路由中
app.post("/api/session/:id/chat", async (c) => {
  const body = await c.req.json()

  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const provider = createLLMProvider(config)

        try {
          for await (const event of provider.stream(params)) {
            const clientEvent = mapToClientEvent(event)  // 翻译
            if (clientEvent) {
              const sse = `event: ${clientEvent.type}\ndata: ${JSON.stringify(clientEvent)}\n\n`
              controller.enqueue(encoder.encode(sse))
            }
          }
        } catch (err) {
          const errorEvent = `event: error\ndata: ${JSON.stringify({
            type: "error", code: "STREAM_ERROR", message: err instanceof Error ? err.message : String(err),
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
        } finally {
          controller.close()
        }
      },
    }),
    { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } }
  )
})
```

#### 事件映射规则

```
NormalizedStreamEvent                  →  客户端 SSE 事件        说明
──────────────────────────────────    ──  ──────────────────   ─────────────────────────
text_delta                             →  text_delta           直接转发，前端逐字拼接
message_delta (stop_reason)            →  state_change         通知前端状态变更
message_stop                           →  done                 流结束，可附带 usage
error                                  →  error                附带 code + message
message_start                          →  （不转发）           内部状态
content_block_start / content_block_stop → （不转发）          前端不需要 block 边界
content_block_start (tool_use)          →  tool_call_start     Phase 3 开启
tool_call_delta                        →  tool_call_delta      Phase 3 开启
```

---

### 模块 8：前端 SSE 客户端（`app/web/src/api/client.ts`）

```typescript
// 用 fetch 而非 EventSource：EventSource 只支持 GET，且不支持自定义 headers
async function* streamChat(
  sessionId: string,
  content: string,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const response = await fetch(`/api/session/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    signal,
  })

  if (!response.ok) throw new Error(`Chat request failed: ${response.status}`)

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (buffer.includes("\n\n")) {
      const idx = buffer.indexOf("\n\n")
      const block = buffer.substring(0, idx)
      buffer = buffer.substring(idx + 2)

      const dataMatch = block.match(/^data:\s*(.+)$/m)
      if (dataMatch) yield JSON.parse(dataMatch[1]) as StreamEvent
    }
  }
}
```

注意：前端解析 SSE 的模式（buffer + `\n\n` 分割）和服务端解析 Anthropic SSE 完全一样。

---

### 模块 9：React Hook（`app/web/src/hooks/useChat.ts`）

```typescript
function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentText, setCurrentText] = useState("")
  const controllerRef = useRef<AbortController | null>(null)

  async function send(content: string) {
    // 中止上一个正在进行的请求（防竞态）
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setMessages(prev => [...prev, { role: "user", content }])
    setIsStreaming(true)
    setCurrentText("")

    let accumulated = ""     // 局部变量——避免读旧的 React state

    try {
      for await (const event of streamChat(sessionId, content, controller.signal)) {
        if (controller.signal.aborted) break
        switch (event.type) {
          case "text_delta":
            accumulated += event.text
            setCurrentText(accumulated)     // 触发重渲染，用户看到逐字输出
            break
          case "done":
            setMessages(prev => [...prev, { role: "assistant", content: accumulated }])
            setCurrentText("")
            break
          case "error":
            console.error("[useChat] 流错误:", event)
            break
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return  // 用户取消，静默
      console.error("[useChat] 请求失败:", err)
    } finally {
      setIsStreaming(false)
    }
  }

  return { messages, isStreaming, currentText, send }
}
```

---

## 四、文件清单与实现顺序

按依赖关系排列。箭头表示"被依赖"（A → B 表示 B import 了 A）。

```
实现序号  文件                                                      职责
───────   ────────────────────────────────────────────────────────  ────────────────────
   1      app/service/src/llm/types/normalized.ts                  归一化事件类型
   2      app/service/src/llm/types/provider.ts                    LLMProvider 接口
   3      app/service/src/llm/types/message.ts                     归一化消息类型
   4      app/service/src/llm/types/index.ts                       类型 barrel 导出
   5      app/service/src/llm/providers/anthropic/types.ts         Anthropic API 原始类型
   6      app/service/src/llm/providers/anthropic/client.ts        HTTP 客户端（fetch）
   7      app/service/src/llm/providers/anthropic/stream-parser.ts SSE 流解析器 ★
   8      app/service/src/llm/providers/anthropic/mapper.ts        消息格式转换
   9      app/service/src/llm/providers/anthropic/index.ts         Provider 组装
  10      app/service/src/llm/providers/factory.ts                 Provider 工厂
  11      app/service/src/llm/index.ts                             LLM 层 barrel 导出
  12      app/service/src/relay/sse-relay.ts                       SSE 中继（内部→客户端）
  13      app/service/src/routes/chat.ts                           聊天路由（更新已有文件）
  14      app/web/src/api/client.ts                                前端 SSE 客户端
  15      app/web/src/hooks/useChat.ts                             聊天 Hook
  16      app/web/src/App.tsx                                      聊天 UI（更新已有文件）
```

依赖图：

```
types/normalized.ts ◄── types/provider.ts ◄── anthropic/index.ts ◄── factory.ts
       ▲                      ▲                      ▲                ▲
       │                      │                      │                │
types/message.ts      anthropic/client.ts     anthropic/mapper.ts   sse-relay.ts
                      anthropic/stream-parser.ts                       ▲
                                                                       │
                                                                routes/chat.ts
                                                                       ▲
                                                                       │
                                                              web/api/client.ts
                                                                       ▲
                                                                       │
                                                              web/hooks/useChat.ts
                                                                       ▲
                                                                       │
                                                                web/App.tsx
```

---

## 五、边缘情况与防护

### 1. 环境变量加载

Node.js 22 原生支持 `--env-file`，修改 service 的 dev 脚本：

```json
"dev": "tsx watch --env-file=../../.env src/index.ts"
```

启动时校验：

```typescript
const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("缺少 ANTHROPIC_API_KEY，请在 .env 中配置");
  process.exit(1);
}
```

### 2. Anthropic API 错误分级

不同状态码的处理策略（Phase 5 会实现重试）：

| 状态码 | 含义 | Phase 1 行为 | Phase 5 改进 |
|--------|------|------------|------------|
| 400 | 请求格式错误 | 抛出不可重试错误 | 同 |
| 401 | API Key 无效 | 抛出不可重试错误 | 同 |
| 429 | 速率限制 | 抛错（包含 retryable 标记） | 读 `retry-after` 自动重试 |
| 500/529 | 服务端错误 | 抛错（包含 retryable 标记） | 指数退避重试 |

`AnthropicApiError` 类现在就要包含 `retryable` 字段：

```typescript
class AnthropicApiError extends Error {
  readonly retryable: boolean
  constructor(readonly status: number, readonly body: unknown) {
    super(`Anthropic API error: ${status}`)
    this.retryable = status >= 500 || status === 429
  }
}
```

### 3. 前端竞态防护

`useChat` 已通过 `AbortController` 实现（见模块 9 伪代码）：发送新消息时中止旧的流式请求。

### 4. 服务端连接断开

客户端关闭 Tab 时，利用 Hono 的 `c.req.raw.signal` 取消上游 LLM 请求：

```typescript
c.req.raw.signal.addEventListener("abort", () => {
  abortController.abort()  // 取消正在进行的 Anthropic 请求，节省 token
})
```

### 5. 调试日志

Phase 1 关键路径建议的日志点：

```
[Chat] 收到请求 sessionId=%s messageLength=%d
[LLM]  调用 Anthropic model=%s inputTokens=%d
[LLM]  流开始 messageId=%s
[LLM]  流结束 stopReason=%s outputTokens=%d duration=%dms
[Chat] 响应完成 sessionId=%s
[Chat] 错误 sessionId=%s error=%s
```

---

## 六、验证清单

```
- [ ] pnpm run lint 通过
- [ ] pnpm run typecheck 通过
- [ ] 启动 pnpm dev，前端打开 http://localhost:5173
- [ ] 输入 "你好"，看到流式文字逐字出现（不是一次性显示）
- [ ] 输入长文本问题，验证流式响应不卡顿
- [ ] 断开网络或关闭服务端，前端显示错误信息
- [ ] 服务端日志完整：收到请求 → 调用 LLM → 流式转发 → 完成
- [ ] 浏览器 DevTools Network 面板确认 SSE 事件格式正确
```

---

## 七、学习笔记

实现过程中建议深入理解以下主题（按相关性排序）：

- [ ] [LLM 集成层架构](../../architecture/llm-integration.md) —— 分层设计、归一化事件、Anthropic SSE 生命周期、Agent Loop 状态机
- [ ] [数据流设计](../../architecture/data-flow.md) —— 请求流/响应流/工具调用流的完整路径
- [ ] [技术选型](../../architecture/tech-stack.md) —— 为什么选 Hono、AsyncIterable、fetch over EventSource
- [ ] [项目结构](../../architecture/project-structure.md) —— 三包依赖关系、目录组织原则
- [ ] Anthropic Messages API 文档 —— 流式响应的完整事件列表
- [ ] `ReadableStream` + `TextDecoderStream` API —— Web Streams 标准
- [ ] `AsyncGenerator` / `AsyncIterable` —— `for await...of` 的工作原理
- [ ] `AbortController` 取消机制 —— 前端竞态防护、服务端资源清理

---

## 相关文档索引

| 主题 | 文档 | 具体章节 |
|------|------|---------|
| LLM 分层架构 | [llm-integration.md](../../architecture/llm-integration.md) | §2 分层架构 |
| 归一化事件类型详解 | [llm-integration.md](../../architecture/llm-integration.md) | §3 归一化事件类型 |
| Anthropic SSE 格式 | [llm-integration.md](../../architecture/llm-integration.md) | §4 Anthropic SSE 流格式 |
| Agent Loop 状态机 | [llm-integration.md](../../architecture/llm-integration.md) | §5 Agent Loop 状态机 |
| Provider 接口设计 | [llm-integration.md](../../architecture/llm-integration.md) | §6 Provider 接口 |
| 端到端数据流 | [data-flow.md](../../architecture/data-flow.md) | §1 请求流, §2 响应流 |
| 协议定义（SSE 事件 Schema） | [协议索引](../../../app/protocol/index.md) | stream-event.ts |
| 环境搭建 | [setup.md](../../guides/setup.md) | — |
| API 密钥配置 | [accounts.md](../../guides/accounts.md) | — |
