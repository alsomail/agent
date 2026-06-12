# 手写 LLM 集成层架构

这是 MyAgent 项目最核心的学习文档。本文详细解释为什么要手写 LLM 集成层、分层架构设计、归一化事件类型、Anthropic SSE 流格式，以及 Agent Loop 状态机。

---

## 1. 为什么要手写

### SDK 帮你做了什么

以 Vercel AI SDK 为例，一行代码就能实现流式聊天：

```typescript
// Vercel AI SDK — 一行搞定
const result = streamText({
  model: anthropic("claude-sonnet-4-5-20250929"),
  messages,
});
```

这一行背后，SDK 完成了以下所有工作：

1. 构造 HTTP 请求（headers、body JSON 序列化）
2. 设置 `stream: true` 启用流式模式
3. 解析 SSE 格式（`data:` 前缀、`\n\n` 分隔）
4. 将 Anthropic 的事件（`content_block_delta`）映射为统一格式
5. 处理 Tool Call 的增量 JSON 拼接
6. 管理 Agent Loop（`maxSteps` 参数控制循环次数）
7. 错误处理和重试
8. Token 用量统计

LangChain 的封装更厚——它还加上了 Chain、Memory、VectorStore 等抽象层。

### 手写能学到什么

| 你将理解的底层概念 | 具体内容 |
|-------------------|---------|
| **SSE 协议** | `data:` 前缀、`\n\n` 分隔、`event:` 类型标识的含义 |
| **HTTP 流式传输** | `Transfer-Encoding: chunked`、`ReadableStream` API、背压控制 |
| **Anthropic 事件生命周期** | `message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta` → `message_stop` 的完整序列 |
| **增量 JSON 解析** | Tool Call 的 `input_json_delta` 是分块发送的，需要拼接后再 `JSON.parse` |
| **Provider 差异** | Anthropic 和 OpenAI 的事件格式、字段命名、错误码完全不同 |
| **状态机设计** | Agent Loop 的 `idle → streaming → tool_executing → streaming → completed` 状态转换 |
| **AsyncIterable 模式** | 为什么选 `for await...of` 而不是 EventEmitter |

这些知识在任何 AI 应用开发中都会用到，不会因为换了 SDK 就过时。

---

## 2. 分层架构

LLM 集成层从上到下分为 4 层：

```
┌───────────────────────────────────────────────┐
│           Agent Loop (agent/loop.ts)           │
│                                               │
│  消费 NormalizedStreamEvent，编排整个对话循环    │
│  - 判断是否需要执行工具                         │
│  - 控制循环次数（防止无限循环）                  │
│  - 管理上下文（messages 数组）                  │
├───────────────────────────────────────────────┤
│         归一化层 (llm/types/normalized)         │
│                                               │
│  定义 Provider 无关的事件接口                    │
│  - NormalizedStreamEvent 判别联合               │
│  - LLMProvider 接口                            │
│  - LLMStreamParams 参数类型                    │
├─────────────────────┬─────────────────────────┤
│  Anthropic Provider  │  OpenAI Provider         │
│                     │                          │
│  anthropic/         │  openai/                 │
│  ├── client.ts      │  ├── client.ts           │
│  ├── stream-parser  │  ├── stream-parser       │
│  │   .ts            │  │   .ts                 │
│  └── mapper.ts      │  └── mapper.ts           │
│                     │                          │
│  HTTP 客户端         │  HTTP 客户端              │
│  + SSE 流解析器      │  + SSE 流解析器           │
│  + 事件映射器        │  + 事件映射器             │
└─────────────────────┴─────────────────────────┘
```

### 每层的职责

**Agent Loop**（最上层）
- 不关心用的是 Anthropic 还是 OpenAI
- 只消费 `NormalizedStreamEvent`
- 决定何时停止循环

**归一化层**（中间层）
- 定义所有 Provider 都必须遵守的事件接口
- 相当于一个"翻译合同"

**Provider 层**（最下层）
- 每个 Provider 负责：
  1. `client.ts` — 构造 HTTP 请求，发送给 LLM API
  2. `stream-parser.ts` — 解析 SSE 流，输出 Provider 原生事件
  3. `mapper.ts` — 将 Provider 原生事件映射为 `NormalizedStreamEvent`

### 为什么要这样分层

**替换 Provider 只需要加一个文件夹**。如果要支持 Google Gemini，只需要新建 `providers/gemini/` 并实现三个文件。Agent Loop 的代码一行不用改。

---

## 3. 归一化事件类型

所有 Provider 的事件最终都会映射为以下 7 种归一化事件：

```typescript
type NormalizedStreamEvent =
  | TextDeltaEvent       // 文本增量
  | ToolCallStartEvent   // 工具调用开始
  | ToolCallDeltaEvent   // 工具调用参数增量
  | ToolResultEvent      // 工具执行结果
  | StateChangeEvent     // 状态变更
  | ErrorEvent           // 错误
  | DoneEvent;           // 完成（含 token 用量）
```

### 每种事件的作用

#### TextDeltaEvent — 文本增量

```typescript
{ type: "text_delta", text: "Agent" }
{ type: "text_delta", text: " Loop" }
{ type: "text_delta", text: " 是指" }
```

LLM 的文本输出是逐块到达的，每个 `text_delta` 包含几个字到几个词。前端收到后追加到当前消息，实现"逐字输出"效果。

#### ToolCallStartEvent — 工具调用开始

```typescript
{
  type: "tool_call_start",
  toolCallId: "toolu_01ABC",
  toolName: "web_search"
}
```

LLM 决定调用工具时发出。此时 Agent Loop 知道需要切换到工具执行流程。前端可以显示"正在调用 web_search..."。

#### ToolCallDeltaEvent — 工具参数增量

```typescript
{ type: "tool_call_delta", toolCallId: "toolu_01ABC", partialJson: "{\"query\":" }
{ type: "tool_call_delta", toolCallId: "toolu_01ABC", partialJson: "\"什么是Agent\"}" }
```

工具的输入参数（JSON）是分块到达的。需要收集所有 `partialJson` 片段，拼接后再 `JSON.parse` 得到完整参数。这就是"增量 JSON 解析"。

#### ToolResultEvent — 工具执行结果

```typescript
{
  type: "tool_result",
  toolCallId: "toolu_01ABC",
  toolName: "web_search",
  result: "搜索结果：Agent Loop 是...",
  isError: false
}
```

工具执行完毕后由 Agent Loop 生成（不是 LLM 发出的）。前端可以展示工具的执行结果。

#### StateChangeEvent — 状态变更

```typescript
{ type: "state_change", state: "streaming" }
{ type: "state_change", state: "tool_executing" }
{ type: "state_change", state: "completed" }
```

通知前端 Agent 的当前状态，用于 UI 状态切换（显示加载指示器、禁用输入框等）。

#### ErrorEvent — 错误

```typescript
{
  type: "error",
  code: "RATE_LIMIT",
  message: "API 速率限制，请稍后重试",
  retryable: true
}
```

可恢复错误（`retryable: true`）和不可恢复错误（`retryable: false`）的区分，让前端决定是否显示重试按钮。

#### DoneEvent — 完成

```typescript
{
  type: "done",
  usage: { inputTokens: 42, outputTokens: 128 }
}
```

整个响应结束时发出，包含 token 用量信息。

---

## 4. Anthropic SSE 流格式

理解 Anthropic Messages API 的 SSE 事件是手写集成层的基础。

### 4.1 纯文本场景的事件序列

当 LLM 只生成文本（不调用工具）时：

```
data: {"type":"message_start","message":{"id":"msg_01XYZ","model":"claude-sonnet-4-5-20250929","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":42,"output_tokens":0}}}

data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Agent"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" Loop 是指"}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}

data: {"type":"content_block_stop","index":0}

data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":128}}

data: {"type":"message_stop"}
```

**生命周期**：

```
message_start           → 消息开始，包含 model、role、初始 usage
  content_block_start   → 第 0 个内容块开始（type: "text"）
    content_block_delta → 文本增量（可能有很多个）
    content_block_delta → ...
  content_block_stop    → 第 0 个内容块结束
message_delta           → 消息级别更新（stop_reason、最终 usage）
message_stop            → 消息完全结束
```

**映射到归一化事件**：

| Anthropic 事件 | 归一化事件 |
|---------------|-----------|
| `content_block_delta` (text_delta) | `TextDeltaEvent` |
| `message_delta` (stop_reason = "end_turn") | `DoneEvent` |
| `message_start` / `content_block_start` / `content_block_stop` / `message_stop` | 不直接映射，用于内部状态管理 |

### 4.2 工具调用场景的事件序列

当 LLM 决定调用工具时：

```
data: {"type":"message_start","message":{...}}

data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"让我搜索一下"}}
data: {"type":"content_block_stop","index":0}

data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01ABC","name":"web_search"}}
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query\":"}}
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"什么是Agent\"}"}}
data: {"type":"content_block_stop","index":1}

data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":64}}
data: {"type":"message_stop"}
```

关键区别：
- `content_block_start` 的 `type` 是 `"tool_use"` 而非 `"text"`
- delta 的类型是 `"input_json_delta"` 而非 `"text_delta"`
- `stop_reason` 是 `"tool_use"` 而非 `"end_turn"`

### 4.3 input_json_delta 的增量 JSON 拼接

这是手写解析器最需要注意的地方。工具的输入参数不是一次性发完的，而是分块发送：

```
第 1 块: {"query":
第 2 块: "什么是Agent"}
拼接后: {"query":"什么是Agent"}
```

实现方式：

```typescript
// 维护一个 buffer
let jsonBuffer = "";

function handleInputJsonDelta(partial: string): void {
  jsonBuffer += partial;
}

function parseCompleteJson(): Record<string, unknown> {
  const result = JSON.parse(jsonBuffer);
  jsonBuffer = ""; // 重置
  return result;
}
```

在 `content_block_stop` 事件时，说明该工具调用的所有参数已到齐，此时调用 `parseCompleteJson()` 得到完整的输入参数。

### 4.4 stop_reason 的含义

| stop_reason | 含义 | Agent Loop 行为 |
|-------------|------|----------------|
| `"end_turn"` | LLM 认为回复完成 | 结束循环 |
| `"tool_use"` | LLM 想调用工具 | 执行工具 → 追加结果 → 继续循环 |
| `"max_tokens"` | 达到 token 上限 | 结束循环（可能回复被截断） |
| `"stop_sequence"` | 遇到停止序列 | 结束循环 |

`stop_reason` 是 Agent Loop 决定下一步行为的关键信号。

---

## 5. Agent Loop 状态机

Agent Loop 是整个 Agent 系统的"大脑"，它编排 LLM 调用和工具执行的循环。

### 状态定义

```typescript
type AgentState =
  | "idle"            // 等待用户输入
  | "streaming"       // 正在接收 LLM 流式响应
  | "tool_executing"  // 正在执行工具
  | "completed"       // 本轮对话完成
  | "error"           // 出错
  | "aborted";        // 用户中止
```

### 状态转换图

```
         用户发送消息
              │
              ▼
  ┌──────► idle
  │          │
  │          │ 开始调用 LLM
  │          ▼
  │     streaming ◄─────────────┐
  │          │                  │
  │          ├─ stop_reason     │
  │          │  = "end_turn"    │
  │          │        │         │
  │          │        ▼         │
  │          │   completed ─────┘─► idle（等待下一条消息）
  │          │
  │          ├─ stop_reason
  │          │  = "tool_use"
  │          │        │
  │          │        ▼
  │          │  tool_executing
  │          │        │
  │          │        │ 工具执行完毕，追加结果
  │          │        │ 再次调用 LLM
  │          │        │
  │          │        └─────────► streaming（回到流式接收）
  │          │
  │          └─ 发生错误 ──────► error
  │
  └─── 用户点击重试 ◄────── error
```

### 伪代码

```typescript
async function agentLoop(
  provider: LLMProvider,
  messages: Message[],
  tools: ToolDefinition[],
  maxIterations: number = 10
): AsyncIterable<NormalizedStreamEvent> {
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    // 调用 LLM
    yield { type: "state_change", state: "streaming" };
    const events = provider.stream({ messages, tools });

    let stopReason = "end_turn";
    const pendingToolCalls: ToolCall[] = [];

    for await (const event of events) {
      yield event; // 转发给前端

      if (event.type === "tool_call_start") {
        // 收集工具调用
      }
      if (event.type === "done") {
        stopReason = /* 从事件中提取 */;
      }
    }

    // 判断是否需要执行工具
    if (stopReason === "tool_use" && pendingToolCalls.length > 0) {
      yield { type: "state_change", state: "tool_executing" };

      for (const toolCall of pendingToolCalls) {
        const result = await executeToolCall(toolCall);
        yield { type: "tool_result", ...result };

        // 追加工具结果到 messages
        messages = [
          ...messages,
          /* assistant 消息（包含 tool_use 块） */,
          /* user 消息（包含 tool_result 块） */,
        ];
      }

      // 继续循环 — 带着工具结果再次调用 LLM
      continue;
    }

    // 没有工具调用，循环结束
    yield { type: "state_change", state: "completed" };
    break;
  }
}
```

---

## 6. Provider 接口

### 接口定义

```typescript
interface LLMProvider {
  stream(params: LLMStreamParams): AsyncIterable<NormalizedStreamEvent>;
}

interface LLMStreamParams {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  system?: string;
  tools?: ToolDefinition[];
}
```

### 为什么选 AsyncIterable 而不是 EventEmitter

**AsyncIterable**（`for await...of`）：

```typescript
// 消费者代码
for await (const event of provider.stream(params)) {
  switch (event.type) {
    case "text_delta":
      yield event; // 直接转发
      break;
    case "tool_call_start":
      collectToolCall(event);
      break;
  }
}
```

**EventEmitter** 模式（如果用的话）：

```typescript
// 消费者代码
const emitter = provider.stream(params);
emitter.on("text_delta", (event) => { /* ... */ });
emitter.on("tool_call_start", (event) => { /* ... */ });
emitter.on("error", (err) => { /* ... */ });
emitter.on("end", () => { /* ... */ });
```

选 AsyncIterable 的理由：

| 特性 | AsyncIterable | EventEmitter |
|------|--------------|-------------|
| 背压控制 | 天然支持——消费者不 `next()` 生产者就暂停 | 需要手动 `pause()`/`resume()` |
| 错误传播 | `try/catch` 即可 | 必须注册 `error` 事件，否则进程崩溃 |
| 生命周期 | `for await` 结束 = 消费完毕 | 需要手动 `removeListener` 防止内存泄漏 |
| 组合性 | 可以用 `yield*` 转发、`for await` 过滤 | 需要创建新的 emitter 做 pipe |
| TypeScript 类型安全 | 泛型 `AsyncIterable<NormalizedStreamEvent>` 自动推导 | 事件名是字符串，类型需要额外声明 |

AsyncIterable 是流式数据消费的现代 TypeScript 惯用模式，也是 Web Streams API 的核心概念。

### Anthropic Provider 实现骨架

```typescript
// providers/anthropic/client.ts
class AnthropicProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  async *stream(params: LLMStreamParams): AsyncIterable<NormalizedStreamEvent> {
    // 1. 构造请求
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.model ?? "claude-sonnet-4-5-20250929",
        max_tokens: params.maxTokens ?? 4096,
        stream: true,
        system: params.system,
        messages: params.messages,
        tools: params.tools,
      }),
    });

    // 2. 解析 SSE 流
    const sseStream = parseSSEStream(response.body!);

    // 3. 映射为归一化事件
    for await (const anthropicEvent of sseStream) {
      const normalized = mapToNormalized(anthropicEvent);
      if (normalized) {
        yield normalized;
      }
    }
  }
}
```

`async *stream()` 中的 `*` 表示这是一个异步生成器（async generator），它返回 `AsyncIterable`。每个 `yield` 向消费者推送一个事件。

---

## 6.1 Provider 适配模式

### 模式：Strategy + Factory

```
LLMProvider (Strategy 接口)
    │
    ├── AnthropicProvider  (SSE 解析)
    │   ├── client.ts      → POST /v1/messages → ReadableStream
    │   ├── stream-parser.ts → SSE (\n\n 分割) → NormalizedStreamEvent
    │   └── mapper.ts      → system 作为顶层字段
    │
    └── OllamaProvider    (NDJSON 解析)
        ├── client.ts      → POST /api/chat → ReadableStream
        ├── stream-parser.ts → NDJSON (\n 分割) → NormalizedStreamEvent
        └── mapper.ts      → system 作为 messages[0]
```

### 归一化策略差异

不同 Provider 的事件粒度不同：

| 事件 | Anthropic | Ollama |
|------|-----------|--------|
| `text_delta` | 每个 content_block_delta 映射 | 每个有 message.content 的 chunk 映射 |
| `content_block_start` | content_block_start 映射 | 不 emit（Ollama 无此概念） |
| `content_block_stop` | content_block_stop 映射 | 不 emit |
| `message_start` | message_start 映射 | 不 emit |
| `message_stop` | message_stop 映射 | done:true 后 emit |
| `message_delta` | message_delta 映射（含 stop_reason） | done:true 后 emit（含 done_reason + usage） |
| `tool_call_delta` | 每个 input_json_delta 映射 | 一次性 emit（完整 JSON） |
| `error` | error 事件映射 | HTTP 错误映射 |

**关键原则**：上层的 Agent Loop 和 relay 不要假设所有事件都存在——它们处理 NormalizedStreamEvent 的判别联合，对未知事件类型静默忽略。

## 6.2 Provider 发现与模型列表

Provider 发现和模型列表是管理能力，不属于 `LLMProvider` 接口（那是推理能力）。它们通过独立的 REST 端点暴露：

```
GET /api/providers  → ProviderInfo[]   (哪些 Provider 可用)
GET /api/models?provider=ollama → ModelInfo[]  (该 Provider 的模型列表)
GET /api/model-capabilities?provider=ollama&model=... → ModelCapabilities  (模型能力缓存)
POST /api/model-capabilities/probe → ModelCapabilities  (手动刷新探测)
```

### Provider 可用性检测

- **Ollama**：尝试 GET /api/tags，成功则标记 available=true
- **Anthropic**：检查 ANTHROPIC_API_KEY 环境变量是否存在
- **OpenAI**：规划中的扩展槽，接入前不进入 `LLMProviderEnum`，不能写入会话 provider

### 会话中的 Provider 绑定

创建会话时记录 provider + model：
```
POST /api/session { provider: "ollama", model: "llama3.2" }
→ session.provider = "ollama", session.model = "llama3.2"
```

chat 路由根据 session.provider 调用 factory 创建对应的 LLMProvider。

当前会话允许通过 `PATCH /api/session/:id` 修改 provider/model。修改时仍要执行 Provider 可用性和模型存在性校验；如果会话正在 streaming/tool_executing，服务端返回 409，避免同一轮响应中途切换模型。

### 模型能力与推理调用分离

模型能力探测是管理能力，不属于 `LLMProvider.stream()` 的实时推理路径。Chat 路由进入 Agent Loop 前查询缓存结果，再决定是否传入 `tools`。探测架构、缓存指纹和 UI 状态见 [工具系统 §5 模型能力探测与缓存](./tool-system.md#5-模型能力探测与缓存)。

---

## 7. 渐进实现路径

LLM 集成层不是一次写完的，而是随着项目阶段逐步构建：

| 阶段 | 实现内容 |
|------|---------|
| **Phase 1** | Anthropic HTTP 客户端 + SSE 流解析 + 纯文本归一化 + 最简 Agent Loop（无工具） |
| **Phase 2** | 会话上下文管理 + 消息历史持久化 + 多轮对话 |
| **Phase 3** | Tool Call 解析 + 增量 JSON 拼接 + 工具执行 + Agent Loop 循环 |
| **Phase 4** | OpenAI Provider + Provider 工厂模式 |
| **Phase 5+** | 错误处理增强、重试策略、流式中止、并发工具调用 |

每个阶段的代码都可以独立运行和测试。Phase 1 结束时你就能看到 Agent 逐字输出文本；Phase 3 结束时就有了完整的 Tool Call 循环。
