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

**服务端的角色是"翻译器"**：把 Anthropic 的 SSE 格式翻译成前端能理解的简化 SSE 格式。

为什么要翻译，而不是直接透传 Anthropic 的原始 SSE？

1. **解耦**：前端不应该知道后端用的是 Anthropic 还是 OpenAI。换 Provider 时前端零改动。
2. **简化**：Anthropic 的事件类型有 8 种以上，前端只需要关心 4 种（`text_delta`、`done`、`error`、`state_change`）。
3. **安全**：原始响应可能包含 token 用量等内部信息，翻译层可以按需过滤。

---

## 三、实现模块（按实现顺序）

### 模块 1：归一化事件类型 (`app/service/src/llm/types/`)

这是最先实现的模块——定义整个 LLM 层的"语言"。所有上层模块都依赖这套类型，所以必须最先确定。

#### `normalized.ts` — 归一化流事件

```typescript
// 无论底层用 Anthropic 还是 OpenAI，上层看到的都是这套类型。
// 这就是"归一化"的含义：用一套统一接口屏蔽不同 Provider 的差异。

type NormalizedStreamEvent =
  | { type: "message_start"; messageId: string; model: string; usage: { inputTokens: number; outputTokens: number } }
  | { type: "content_block_start"; index: number; blockType: "text" | "tool_use"; toolCall?: { id: string; name: string } }
  | { type: "text_delta"; index: number; text: string }
  | { type: "tool_call_delta"; index: number; partialJson: string }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; stopReason: "end_turn" | "tool_use" | "max_tokens" | null; usage: { outputTokens: number } }
  | { type: "message_stop" }
  | { type: "error"; error: { type: string; message: string } }
```

每个事件的作用：

| 事件类型 | 触发时机 | 携带信息 | Phase 1 是否用到 |
|---------|---------|---------|:---:|
| `message_start` | LLM 开始生成 | 消息 ID、模型名、输入 token 数 | ✅ |
| `content_block_start` | 一个内容块开始 | 块索引、块类型（文本/工具调用） | ✅ |
| `text_delta` | 收到一段文字 | 块索引、增量文本 | ✅ 核心 |
| `tool_call_delta` | 收到工具调用 JSON 片段 | 块索引、JSON 片段 | ❌ Phase 3 |
| `content_block_stop` | 一个内容块结束 | 块索引 | ✅ |
| `message_delta` | 消息级别状态变更 | 停止原因、输出 token 数 | ✅ |
| `message_stop` | 整条消息生成完毕 | 无 | ✅ |
| `error` | 出错 | 错误类型和描述 | ✅ |

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

**为什么用 `AsyncIterable` 而不是回调或 EventEmitter？**

三种方案对比：

| 方案 | 代码样子 | 优点 | 缺点 |
|------|---------|------|------|
| 回调 | `stream(params, onEvent)` | 简单直接 | 嵌套地狱、难以组合 |
| EventEmitter | `emitter.on("text", ...)` | Node.js 风格、熟悉 | 无类型安全、无背压控制 |
| **AsyncIterable** | `for await (const e of stream(params))` | 类型安全、天然背压、可用 generator 实现 | 需要理解 async generator 语法 |

选择 `AsyncIterable` 的关键原因：

1. **天然适配 `for await...of` 循环** —— 消费者代码像同步循环一样清晰
2. **支持背压** —— 消费者处理完一个事件才会拉取下一个，不会因为 LLM 吐得太快而丢数据
3. **可以用 generator 函数 (`async function*`) 优雅实现** —— 每次 `yield` 一个事件，控制流直观

```typescript
// 消费端：像读列表一样读流
for await (const event of provider.stream(params)) {
  if (event.type === "text_delta") {
    process.stdout.write(event.text)  // 逐字打印
  }
}
```

#### `message.ts` — 归一化消息类型

```typescript
interface NormalizedMessage {
  role: "user" | "assistant"
  content: NormalizedContentBlock[]
}

type NormalizedContentBlock =
  | { type: "text"; text: string }
  // Phase 3 加入:
  // | { type: "tool_use"; id: string; name: string; input: unknown }
  // | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
```

为什么 `content` 是数组而不是字符串？因为 LLM 的一条消息可以包含多个内容块——文本、工具调用、工具结果。Phase 1 只有文本块，但类型设计要为未来预留空间。

---

### 模块 2：Anthropic HTTP 客户端 (`app/service/src/llm/providers/anthropic/client.ts`)

#### 职责

用原生 `fetch()` 调用 Anthropic Messages API，返回原始字节流。这个模块只负责"发请求、拿到流"，不负责解析流的内容。

#### 关键代码结构（伪代码）

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
      "x-api-key": apiKey,                // Anthropic 用自定义 header 而非 Bearer token
      "anthropic-version": "2023-06-01",  // API 版本，必填
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      messages: params.messages,          // 已经转换为 Anthropic 格式
      system: params.system,
      stream: true,                       // 关键：开启流式模式
    }),
    signal,  // 传入 AbortSignal，调用方可以随时取消请求
  })

  // 非 2xx 响应，解析错误体并抛出
  if (!response.ok) {
    const errorBody = await response.json()
    throw new AnthropicApiError(response.status, errorBody)
  }

  // response.body 是一个 ReadableStream<Uint8Array>
  // 它是"活的"——数据会随着 LLM 的生成持续到达
  return response.body!
}
```

#### 学习要点

- **`fetch()` 的 `signal` 参数**：用于取消请求。配合 `AbortController` 使用：
  ```typescript
  const controller = new AbortController()
  // 传入 controller.signal
  // 需要取消时调用 controller.abort()
  ```
- **`response.body`**：是一个 `ReadableStream<Uint8Array>`，是流式处理的入口。它不是一次性返回所有数据，而是数据到达多少就能读多少。
- **Anthropic 要求的 headers**：
  - `x-api-key`：API 密钥（注意不是 `Authorization: Bearer ...` 格式）
  - `anthropic-version`：API 版本号，目前固定为 `"2023-06-01"`

---

### 模块 3：SSE 流解析器 (`app/service/src/llm/providers/anthropic/stream-parser.ts`)

这是 Phase 1 最复杂也最值得学习的模块——把 Anthropic 的原始 SSE 字节流转换为归一化事件。

#### SSE 协议基础知识

```
SSE (Server-Sent Events) 是一种基于 HTTP 的单向推送协议。格式规则：

1. 每个事件由若干行组成，每行以字段名开头（event:、data: 等）
2. 事件之间用空行（\n\n）分隔
3. data: 行的内容通常是 JSON

示例（两个事件）：
event: message_start\n
data: {"type":"message_start","message":{"id":"msg_01X","model":"claude-sonnet-4-20250514"}}\n
\n
event: content_block_delta\n
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}\n
\n
```

#### Anthropic 事件生命周期（关键！）

理解 Anthropic SSE 流的事件顺序是正确实现解析器的前提。

**场景 A：纯文本响应**（Phase 1 的核心场景）

```
message_start          → 消息元数据（id, model, usage）
  content_block_start  → index=0, type="text"
  content_block_delta  → delta.type="text_delta", delta.text="你"
  content_block_delta  → delta.type="text_delta", delta.text="好"
  content_block_delta  → delta.type="text_delta", delta.text="世"
  content_block_delta  → delta.type="text_delta", delta.text="界"
  content_block_stop   → index=0
message_delta          → stop_reason="end_turn", usage.output_tokens=N
message_stop           → 流结束
```

缩进表示嵌套关系：`content_block_*` 事件嵌套在 `message_start` 和 `message_stop` 之间。一条消息可以包含多个 content block。

**场景 B：工具调用响应**（Phase 3 预览，Phase 1 不需要实现，但理解了有助于设计）

```
message_start
  content_block_start  → index=0, type="text"（可能有思考文本）
  content_block_delta  → text:"让我查一下..."
  content_block_stop   → index=0
  content_block_start  → index=1, type="tool_use", id="toolu_xxx", name="get_weather"
  content_block_delta  → delta.type="input_json_delta", partial_json='{"lo'
  content_block_delta  → delta.type="input_json_delta", partial_json='cation'
  content_block_delta  → delta.type="input_json_delta", partial_json='":"北京"}'
  content_block_stop   → index=1  → 此时拼接好的字符串可以 JSON.parse 得到完整输入
message_delta          → stop_reason="tool_use"  ← 这是 Agent Loop 的续命信号
message_stop
```

注意 `stop_reason="tool_use"` 告诉上层："我还没说完，需要先执行工具再继续"。这就是 Agent Loop 的驱动力，Phase 3 会详细讲。

#### 解析算法（伪代码）

```typescript
async function* parseAnthropicStream(
  byteStream: ReadableStream<Uint8Array>
): AsyncIterable<NormalizedStreamEvent> {

  // ========== 第一步：字节流 → 文本 ==========
  // ReadableStream<Uint8Array> 是原始字节，需要先解码为字符串
  // TextDecoderStream 负责 UTF-8 解码

  let buffer = ""
  const reader = byteStream
    .pipeThrough(new TextDecoderStream())  // Uint8Array → string
    .getReader()

  // ========== 第二步：按事件边界切割 ==========
  while (true) {
    const { done, value } = await reader.read()
    if (done) break  // 流结束

    buffer += value  // 把新到的文本追加到 buffer

    // 按双换行（\n\n）分割事件
    // 为什么用 buffer？因为一次 read() 可能只拿到半个事件，
    // 也可能拿到两个半事件。buffer 确保我们总是在完整事件边界上切割。
    while (buffer.includes("\n\n")) {
      const eventEndIndex = buffer.indexOf("\n\n")
      const eventBlock = buffer.substring(0, eventEndIndex)
      buffer = buffer.substring(eventEndIndex + 2)  // +2 跳过 \n\n

      // ========== 第三步：提取 event: 和 data: 行 ==========
      // eventBlock 形如：
      //   "event: content_block_delta\ndata: {\"type\":...}"
      const eventTypeMatch = eventBlock.match(/^event:\s*(.+)$/m)
      const dataMatch = eventBlock.match(/^data:\s*(.+)$/m)

      if (!eventTypeMatch || !dataMatch) continue  // 格式不对，跳过
      
      const eventType = eventTypeMatch[1].trim()
      if (eventType === "ping") continue  // 心跳事件，忽略

      const parsed = JSON.parse(dataMatch[1])

      // ========== 第四步：映射为归一化事件 ==========
      switch (parsed.type) {
        case "message_start":
          yield {
            type: "message_start",
            messageId: parsed.message.id,
            model: parsed.message.model,
            usage: {
              inputTokens: parsed.message.usage.input_tokens,
              outputTokens: parsed.message.usage.output_tokens,
            },
          }
          break

        case "content_block_start": {
          const blockType = parsed.content_block.type  // "text" 或 "tool_use"
          yield {
            type: "content_block_start",
            index: parsed.index,
            blockType,
            // Phase 3: 如果是 tool_use，还要提取 id 和 name
            ...(blockType === "tool_use" && {
              toolCall: {
                id: parsed.content_block.id,
                name: parsed.content_block.name,
              },
            }),
          }
          break
        }

        case "content_block_delta":
          if (parsed.delta.type === "text_delta") {
            yield {
              type: "text_delta",
              index: parsed.index,
              text: parsed.delta.text,
            }
          } else if (parsed.delta.type === "input_json_delta") {
            // Phase 3 才会用到
            yield {
              type: "tool_call_delta",
              index: parsed.index,
              partialJson: parsed.delta.partial_json,
            }
          }
          break

        case "content_block_stop":
          yield { type: "content_block_stop", index: parsed.index }
          break

        case "message_delta":
          yield {
            type: "message_delta",
            stopReason: parsed.delta.stop_reason ?? null,
            usage: { outputTokens: parsed.usage.output_tokens },
          }
          break

        case "message_stop":
          yield { type: "message_stop" }
          break

        case "error":
          yield {
            type: "error",
            error: { type: parsed.error.type, message: parsed.error.message },
          }
          break
      }
    }
  }
}
```

#### 关键陷阱（实现时务必注意）

1. **Buffer 机制**：一次 `read()` 可能包含多个事件（LLM 吐得快时），也可能只有半个事件（网络拆包时）。必须用 buffer 累积，只在看到 `\n\n` 时才切割。没有 buffer 的实现**一定**会在边界情况下出 bug。

2. **`ping` 事件**：Anthropic 会定期发送 `event: ping` 作为心跳。必须识别并忽略，否则 `JSON.parse` 会报错。

3. **`input_json_delta` 的增量性**：工具调用的 JSON 参数是一段一段发过来的（`'{"lo'`、`'cation'`、`'":"北京"}'`），每一段都不是合法 JSON。要把所有片段拼接成完整字符串后才能 `JSON.parse`。Phase 1 不需要实现这个逻辑，但 stream-parser 要正确 `yield` 这些片段，拼接工作交给上层。

4. **`TextDecoderStream` 的流式参数**：解码器内部会处理 UTF-8 多字节字符被拆到两次 `read()` 中的情况。不要自己手动处理字符编码。

---

### 模块 4：消息格式映射器 (`app/service/src/llm/providers/anthropic/mapper.ts`)

把归一化消息转换为 Anthropic API 期望的格式。

```typescript
// 归一化消息 → Anthropic API 格式
function toAnthropicMessages(messages: NormalizedMessage[]): AnthropicMessageParam[] {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content.map(block => {
      if (block.type === "text") {
        return { type: "text" as const, text: block.text }
      }
      // Phase 3 加入:
      // if (block.type === "tool_use") → 转换为 Anthropic tool_use 格式
      // if (block.type === "tool_result") → 转换为 Anthropic tool_result 格式
      throw new Error(`Unsupported block type: ${(block as { type: string }).type}`)
    }),
  }))
}
```

为什么需要 mapper？因为不同 Provider 的消息格式不同：

| 字段 | 归一化格式 | Anthropic 格式 | OpenAI 格式（参考） |
|------|-----------|---------------|-------------------|
| 角色 | `role: "user"` | `role: "user"` | `role: "user"` |
| 文本内容 | `{ type: "text", text: "..." }` | `{ type: "text", text: "..." }` | 直接是字符串 `"..."` |
| 工具调用 | `{ type: "tool_use", id, name, input }` | 同左 | `{ type: "function", function: { name, arguments } }` |

Anthropic 和归一化格式碰巧很接近，但 mapper 的存在确保了未来加入其他 Provider 时，归一化层不需要改动。

---

### 模块 5：Anthropic Provider 组装 (`app/service/src/llm/providers/anthropic/index.ts`)

把 client + stream-parser + mapper 组装成一个符合 `LLMProvider` 接口的对象。

```typescript
function createAnthropicProvider(config: { apiKey: string }): LLMProvider {
  return {
    async *stream(params: LLMStreamParams) {
      // 1. 用 mapper 把归一化消息转为 Anthropic 格式
      const anthropicMessages = toAnthropicMessages(params.messages)

      const requestBody = {
        model: params.model,
        maxTokens: params.maxTokens,
        messages: anthropicMessages,
        system: params.system,
      }

      // 2. 调用 HTTP 客户端拿到字节流
      const byteStream = await callAnthropicStream(requestBody, config.apiKey, params.signal)

      // 3. 用 stream-parser 把字节流转为归一化事件，逐个 yield 出去
      yield* parseAnthropicStream(byteStream)
    },
  }
}
```

**`yield*` 语法说明**：`yield*` 是 generator 的语法糖，作用是"把另一个 iterable 的所有值逐个 yield 出去"。等价于：

```typescript
for await (const event of parseAnthropicStream(byteStream)) {
  yield event
}
```

但 `yield*` 更简洁，而且在某些运行时有性能优势。

---

### 模块 6：Provider 工厂 (`app/service/src/llm/providers/factory.ts`)

```typescript
// 根据配置创建对应的 Provider
function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider({ apiKey: config.apiKey })
    // 未来扩展:
    // case "openai":
    //   return createOpenAIProvider({ apiKey: config.apiKey })
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}
```

工厂模式的好处：路由层不需要知道具体用了哪个 Provider，只需要调用 `createLLMProvider(config)` 就能拿到一个统一接口的对象。

---

### 模块 7：SSE 中继层 (`app/service/src/relay/sse-relay.ts`)

职责：把 `NormalizedStreamEvent` 翻译成客户端能理解的简化 SSE 格式，通过 HTTP 响应推送到浏览器。

```typescript
// 在 Hono 路由中使用
app.post("/api/session/:id/chat", async (c) => {
  const body = await c.req.json()

  // 创建一个 ReadableStream 作为 HTTP 响应体
  // 这个流是"活的"——数据会随着 LLM 的生成持续写入
  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const provider = createLLMProvider(config)

        try {
          for await (const event of provider.stream(params)) {
            // 把内部归一化事件翻译为客户端事件
            const clientEvent = mapToClientEvent(event)
            if (clientEvent) {
              // 构造 SSE 格式的字符串并写入流
              const sseChunk = `event: ${clientEvent.type}\ndata: ${JSON.stringify(clientEvent)}\n\n`
              controller.enqueue(encoder.encode(sseChunk))
            }
          }
        } catch (err) {
          // 发送错误事件，让前端知道出了什么问题
          const errorEvent = `event: error\ndata: ${JSON.stringify({
            type: "error",
            code: "STREAM_ERROR",
            message: err instanceof Error ? err.message : String(err),
          })}\n\n`
          controller.enqueue(encoder.encode(errorEvent))
        } finally {
          controller.close()  // 关闭流，浏览器端会触发结束
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",   // 告诉浏览器这是 SSE 流
        "Cache-Control": "no-cache",            // 禁用缓存，确保实时性
        "Connection": "keep-alive",             // 保持长连接
      },
    }
  )
})
```

#### 事件映射规则

并不是所有内部事件都需要转发给前端。映射规则如下：

```
NormalizedStreamEvent            →  客户端 SSE 事件             说明
─────────────────────────────   ──  ─────────────────────────  ─────────────────────────
text_delta                       →  text_delta                 直接转发 text 字段，前端用它逐字拼接
content_block_start (tool_use)   →  tool_call_start            仅 tool_use 类型时转发（Phase 3）
tool_call_delta                  →  tool_call_delta            直接转发（Phase 3）
message_delta                    →  state_change               告诉前端："状态变了"（如 → "completed"）
message_stop                     →  done                       流结束标志，可附带 usage 统计
error                            →  error                      附带 code + message + retryable
message_start                    →  （不转发）                  前端不需要知道内部消息 ID
content_block_start (text)       →  （不转发）                  前端不需要知道 block 边界
content_block_stop               →  （不转发）                  前端不需要知道 block 边界
```

---

### 模块 8：前端 SSE 客户端 (`app/web/src/api/client.ts`)

```typescript
// 为什么用 fetch 而不是 EventSource？
// 因为 EventSource API 只支持 GET 请求，而我们需要 POST 发送消息体。
// 而且 EventSource 不支持自定义 headers，未来加认证会受限。

async function* streamChat(
  sessionId: string,
  content: string
): AsyncIterable<StreamEvent> {
  const response = await fetch(`/api/session/${sessionId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  })

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`)
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    // stream: true 告诉 TextDecoder：这不是最后一块数据，
    // 如果末尾有被截断的多字节字符，先别报错，等下一块数据来再拼
    buffer += decoder.decode(value, { stream: true })

    // 按 \n\n 分割事件（和服务端解析 Anthropic 流一样的逻辑！）
    // 注意这个模式的复用：前端解析服务端 SSE、服务端解析 Anthropic SSE，
    // 用的是同一套 buffer + split 逻辑
    while (buffer.includes("\n\n")) {
      const idx = buffer.indexOf("\n\n")
      const block = buffer.substring(0, idx)
      buffer = buffer.substring(idx + 2)

      // 从事件块中提取 data: 行的内容
      const dataMatch = block.match(/^data:\s*(.+)$/m)
      if (dataMatch) {
        yield JSON.parse(dataMatch[1]) as StreamEvent
      }
    }
  }
}
```

**学习要点**：注意"SSE 解析"这个模式出现了两次——服务端解析 Anthropic 的 SSE、前端解析服务端的 SSE。核心逻辑完全一样：`buffer + 按 \n\n 分割 + 提取 data 行`。理解一次就能用两处。

---

### 模块 9：React Hook (`app/web/src/hooks/useChat.ts`)

```typescript
function useChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentText, setCurrentText] = useState("")

  async function send(content: string) {
    // 1. 先把用户消息追加到列表（乐观更新）
    setMessages(prev => [...prev, { role: "user", content }])
    setIsStreaming(true)
    setCurrentText("")

    let accumulated = ""

    try {
      // 2. 消费 SSE 流
      for await (const event of streamChat(sessionId, content)) {
        switch (event.type) {
          case "text_delta":
            // 每收到一个文本片段，就累积并触发 React 重渲染
            // 用户会看到文字逐字出现
            accumulated += event.text
            setCurrentText(accumulated)
            break

          case "done":
            // 流结束：把累积的完整文本作为 assistant 消息追加到列表
            setMessages(prev => [...prev, { role: "assistant", content: accumulated }])
            setCurrentText("")
            break

          case "error":
            // 显示错误提示
            console.error("[useChat] 流式响应错误:", event)
            break
        }
      }
    } catch (err) {
      console.error("[useChat] 请求失败:", err)
      // 可以在这里追加一条错误消息到列表
    } finally {
      setIsStreaming(false)
    }
  }

  return { messages, isStreaming, currentText, send }
}
```

**为什么用 `accumulated` 局部变量而不是直接用 `currentText` state？**

因为 React 的 `setState` 是异步的。如果写 `setCurrentText(prev => prev + event.text)` 然后在 `done` 分支里读 `currentText`，可能拿到旧值。用局部变量 `accumulated` 保证始终持有最新的完整文本。

---

## 四、文件清单与实现顺序

按依赖关系排列：先实现的模块被后面的模块 import。

```
实现顺序    文件                                                         职责
────────   ───────────────────────────────────────────────────────────  ─────────────────────
   1       app/service/src/llm/types/normalized.ts                     归一化事件类型
   2       app/service/src/llm/types/provider.ts                       LLMProvider 接口
   3       app/service/src/llm/types/message.ts                        归一化消息类型
   4       app/service/src/llm/types/index.ts                          类型 barrel 导出
   5       app/service/src/llm/providers/anthropic/types.ts            Anthropic API 原始类型
   6       app/service/src/llm/providers/anthropic/client.ts           HTTP 客户端
   7       app/service/src/llm/providers/anthropic/stream-parser.ts    SSE 流解析器 ★ 最复杂
   8       app/service/src/llm/providers/anthropic/mapper.ts           消息格式转换
   9       app/service/src/llm/providers/anthropic/index.ts            Provider 组装
  10       app/service/src/llm/providers/factory.ts                    Provider 工厂
  11       app/service/src/llm/index.ts                                LLM 层 barrel 导出
  12       app/service/src/relay/sse-relay.ts                          SSE 中继
  13       app/service/src/routes/chat.ts                              聊天路由（更新已有文件）
  14       app/web/src/api/client.ts                                   前端 SSE 客户端
  15       app/web/src/hooks/useChat.ts                                聊天 Hook
  16       app/web/src/App.tsx                                         聊天 UI（更新已有文件）
```

依赖图（箭头表示"被依赖"）：

```
types/normalized.ts ◄── types/provider.ts ◄── providers/anthropic/index.ts ◄── providers/factory.ts
       ▲                      ▲                          ▲                            ▲
       │                      │                          │                            │
types/message.ts    anthropic/client.ts           anthropic/mapper.ts          relay/sse-relay.ts
                    anthropic/stream-parser.ts                                        ▲
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

## 补充：容易忽略的边界情况

以下是架构审查中发现的、实现时必须处理的问题。

### 1. 环境变量加载

`ANTHROPIC_API_KEY` 从哪来？需要在服务启动时从 `.env` 加载并校验：

```typescript
// app/service/src/index.ts 或单独的 config.ts
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("缺少 ANTHROPIC_API_KEY，请在 .env 中配置");
  process.exit(1);
}
```

Node.js 22 内置 `--env-file=.env` 参数来加载 `.env` 文件。`tsx` 也支持，所以 `dev` 脚本可以改为：

```json
"dev": "tsx watch --env-file=../../.env src/index.ts"
```

或者使用 `dotenv` 包。推荐前者（零依赖）。

### 2. Anthropic API 错误响应处理

非 200 响应不是简单的"抛错就行"，不同状态码有不同的处理策略：

| 状态码 | 含义 | 处理方式 |
|--------|------|---------|
| 400 | 请求格式错误 | 抛出不可重试错误，检查 messages 格式 |
| 401 | API Key 无效 | 抛出不可重试错误，提示检查 .env |
| 429 | 速率限制 | 读取 `retry-after` header，可重试 |
| 500 | Anthropic 内部错误 | 可重试（指数退避） |
| 529 | Anthropic 过载 | 可重试（等待后重试） |

Phase 1 可以先简单处理（全部抛错），但 `AnthropicApiError` 类应该包含 `status` 和 `retryable` 字段，为 Phase 5 的重试策略预留：

```typescript
class AnthropicApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly retryable: boolean = status >= 500 || status === 429,
  ) {
    super(`Anthropic API error: ${status}`);
  }
}
```

### 3. 前端竞态防护

用户快速连续发送两条消息时，两个 `for await` 循环会并发修改 `messages` state。解决方案：

```typescript
// useChat.ts 中维护一个 AbortController 引用
const controllerRef = useRef<AbortController | null>(null);

async function send(content: string) {
  // 中止上一个正在进行的请求
  controllerRef.current?.abort();
  const controller = new AbortController();
  controllerRef.current = controller;

  try {
    for await (const event of streamChat(sessionId, content, controller.signal)) {
      if (controller.signal.aborted) break;
      // ... 处理事件
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return; // 用户主动取消，静默处理
    }
    throw err;
  }
}
```

同时 `streamChat` 需要把 `signal` 传递给 `fetch`：
```typescript
const response = await fetch(url, { method: "POST", body, signal });
```

### 4. 连接断开时的资源清理

服务端：当浏览器关闭 Tab 或切换页面时，SSE 连接会断开。此时 `controller.enqueue()` 会报错。需要在 `try/finally` 中妥善处理：

```typescript
// 监听客户端断开
c.req.raw.signal.addEventListener("abort", () => {
  // 可以用来取消上游 LLM 请求，节省 token
  abortController.abort();
});
```

### 5. 调试日志

Phase 1 需要在关键路径添加结构化日志，便于调试。建议的日志点：

```
[Chat] 收到请求 sessionId=%s messageLength=%d
[LLM]  调用 Anthropic model=%s inputTokens=%d
[LLM]  流开始 messageId=%s
[LLM]  流结束 stopReason=%s outputTokens=%d duration=%dms
[Chat] 响应完成 sessionId=%s
[Chat] 错误 sessionId=%s error=%s
```

---

## 五、验证清单

完成实现后，逐项检查：

```
- [ ] pnpm run lint 通过
- [ ] pnpm run typecheck 通过
- [ ] 启动 pnpm dev，前端打开 http://localhost:5173
- [ ] 输入 "你好"，看到流式文字逐字出现（不是一次性显示全部）
- [ ] 输入长文本问题（如 "详细解释 TCP 三次握手"），验证流式响应不卡顿
- [ ] 断开网络或关闭服务端，前端显示错误信息（而不是白屏或无响应）
- [ ] 查看服务端日志，确认请求链路完整（收到请求 → 调用 Anthropic → 流式转发 → 完成）
- [ ] 在浏览器 DevTools Network 面板中观察 SSE 响应，确认事件格式正确
```

---

## 六、学习笔记模板

在实现过程中，建议针对以下主题写学习笔记（可以直接在本文件下方追加）：

```
### 待学习主题
- [ ] SSE (Server-Sent Events) 协议规范 — 与 WebSocket 有什么不同？各自的适用场景？
- [ ] ReadableStream 和 TransformStream API — Web Streams 标准的核心概念
- [ ] AsyncGenerator / AsyncIterable 模式 — for await...of 是怎么工作的？
- [ ] Anthropic Messages API 文档 — 流式响应的完整事件列表
- [ ] HTTP 流式传输 vs WebSocket — 为什么 SSE 适合这个场景？
- [ ] TextDecoder 的 stream: true 参数 — 处理多字节字符截断
- [ ] fetch 的 AbortController 取消机制 — 如何优雅地中断正在进行的请求？
- [ ] yield 和 yield* 的区别 — generator 委托语法
```
