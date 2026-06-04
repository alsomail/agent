# 端到端数据流设计

本文档用 ASCII 图表和文字说明，展示用户消息从输入到 Agent 响应的完整数据流。

---

## 总览

MyAgent 的数据流分为三条路径：

1. **请求流**：用户输入 → LLM API 调用
2. **响应流**：LLM SSE 事件 → 前端 UI 更新
3. **工具调用流**：LLM 返回 tool_use → 执行工具 → 追加结果 → 再次调用 LLM

```
┌──────────┐     HTTP POST      ┌──────────────┐     HTTP SSE      ┌──────────────┐
│          │  ───────────────►  │              │  ───────────────►  │              │
│  React   │  /api/session/     │  Hono        │  Anthropic         │  Anthropic   │
│  前端     │  :id/chat          │  后端         │  Messages API      │  API         │
│          │  ◄───────────────  │              │  ◄───────────────  │              │
│          │     SSE Stream     │              │     SSE Stream     │              │
└──────────┘                    └──────────────┘                    └──────────────┘
```

---

## 1. 请求流

用户输入一条消息，经过以下步骤到达 LLM：

```
用户键入消息 + 按回车
        │
        ▼
┌─────────────────────────────────────┐
│ React: App.tsx                       │
│  1. 将用户消息追加到 messages 状态    │
│  2. setIsStreaming(true)             │
│  3. fetch POST /api/session/:id/chat │
│     body: { messages, model? }       │
└────────────────┬────────────────────┘
                 │
                 │  HTTP POST (JSON)
                 │  由 Vite proxy 转发到 localhost:3001
                 ▼
┌─────────────────────────────────────┐
│ Hono: routes/chat.ts                 │
│  1. zValidator 校验请求体             │
│  2. 从 store 取出会话上下文           │
│  3. 调用 Agent Loop                  │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ Agent Loop: agent/loop.ts            │
│  1. 组装完整 messages 数组            │
│  2. 附加 system prompt               │
│  3. 附加工具定义（如有）              │
│  4. 调用 LLM Provider.stream()       │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ LLM Provider: providers/anthropic/   │
│  1. 构造 Anthropic Messages API 请求 │
│     - model, messages, max_tokens    │
│     - stream: true                   │
│     - tools (如有)                   │
│  2. fetch POST api.anthropic.com     │
│     headers: x-api-key, anthropic-   │
│              version, content-type   │
│  3. 获得 ReadableStream 响应         │
└──────────────────────────────────────┘
```

### 请求体结构

前端发给后端的请求：

```typescript
// POST /api/session/:id/chat
{
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: "请帮我解释什么是 Agent Loop" }]
    }
  ],
  model: "claude-sonnet-4-5-20250929",   // 可选
  maxTokens: 4096                        // 可选
}
```

后端发给 Anthropic API 的请求：

```typescript
// POST https://api.anthropic.com/v1/messages
{
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 4096,
  stream: true,
  system: "你是一个有帮助的 AI 助手...",
  messages: [
    { role: "user", content: [{ type: "text", text: "..." }] }
  ],
  tools: [...]  // Phase 3+ 才有
}
```

---

## 2. 响应流

LLM 的流式响应经过解析、归一化、中继，最终到达前端 UI：

```
Anthropic API 返回 SSE 流
        │
        │  data: {"type":"message_start",...}
        │  data: {"type":"content_block_start",...}
        │  data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Agent"}}
        │  data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" Loop"}}
        │  ...
        │  data: {"type":"message_stop"}
        ▼
┌─────────────────────────────────────┐
│ Stream Parser: anthropic/stream-     │
│                parser.ts             │
│  1. 逐行读取 SSE（按 "data: " 前缀） │
│  2. JSON.parse 每个事件              │
│  3. 过滤 ping 和非数据事件           │
└────────────────┬────────────────────┘
                 │
                 │  Anthropic 原生事件
                 ▼
┌─────────────────────────────────────┐
│ Mapper: anthropic/mapper.ts          │
│  1. 将 Anthropic 事件映射为           │
│     NormalizedStreamEvent            │
│  2. content_block_delta(text_delta)   │
│     → { type: "text_delta", text }   │
│  3. message_stop                      │
│     → { type: "done", usage }        │
└────────────────┬────────────────────┘
                 │
                 │  NormalizedStreamEvent（Provider 无关）
                 ▼
┌─────────────────────────────────────┐
│ Agent Loop: agent/loop.ts            │
│  1. 消费归一化事件                    │
│  2. 如果遇到 tool_call_start         │
│     → 进入工具执行流程（见下文）      │
│  3. 否则转发给 relay 层              │
└────────────────┬────────────────────┘
                 │
                 │  NormalizedStreamEvent
                 ▼
┌─────────────────────────────────────┐
│ Relay: relay/sse-relay.ts            │
│  1. 将 NormalizedStreamEvent          │
│     序列化为 SSE 格式                 │
│  2. event: text_delta                 │
│     data: {"type":"text_delta",       │
│            "text":"Agent"}            │
│  3. 通过 Hono 的 streamSSE() 推送    │
└────────────────┬────────────────────┘
                 │
                 │  SSE (text/event-stream)
                 │  通过 Vite proxy 传回前端
                 ▼
┌─────────────────────────────────────┐
│ SSE Client: api/client.ts            │
│  1. fetch 获取 ReadableStream         │
│  2. TextDecoderStream 解码为文本      │
│  3. 按 "data: " 前缀逐行解析         │
│  4. JSON.parse → StreamEvent 类型     │
└────────────────┬────────────────────┘
                 │
                 │  StreamEvent (类型安全)
                 ▼
┌─────────────────────────────────────┐
│ React Hook: hooks/useChat.ts         │
│  1. switch(event.type)               │
│  2. text_delta → 追加文字到当前消息   │
│  3. state_change → 更新 UI 状态       │
│  4. done → 标记流式完成              │
│  5. error → 显示错误提示             │
└────────────────┬────────────────────┘
                 │
                 │  React state 更新
                 ▼
┌─────────────────────────────────────┐
│ React: App.tsx                       │
│  messages 状态更新 → UI 重新渲染      │
│  用户看到 Agent 逐字输出             │
└──────────────────────────────────────┘
```

### 响应事件流示例

一次纯文本回复的完整事件序列：

```
event: state_change
data: {"type":"state_change","state":"streaming"}

event: text_delta
data: {"type":"text_delta","text":"Agent"}

event: text_delta
data: {"type":"text_delta","text":" Loop"}

event: text_delta
data: {"type":"text_delta","text":" 是指..."}

event: done
data: {"type":"done","usage":{"inputTokens":42,"outputTokens":128}}

event: state_change
data: {"type":"state_change","state":"completed"}
```

---

## 3. 工具调用流（Phase 3 实现）

当 LLM 决定调用工具时，数据流会形成一个**循环**：

```
Agent Loop 收到 LLM 响应
        │
        │  stop_reason = "tool_use"
        ▼
┌─────────────────────────────────────┐
│ 1. 解析 tool_use 内容块              │
│    - toolCallId: "toolu_abc123"      │
│    - toolName: "web_search"          │
│    - input: { query: "..." }         │
└────────────────┬────────────────────┘
                 │
                 │  推送 tool_call_start 事件给前端
                 │  推送 tool_call_delta 事件（增量 JSON）
                 ▼
┌─────────────────────────────────────┐
│ 2. 执行工具                          │
│    state → "tool_executing"          │
│    - 从 ToolRegistry 查找执行器      │
│    - 调用 executor.execute(input)    │
│    - 获取结果 string                 │
└────────────────┬────────────────────┘
                 │
                 │  推送 tool_result 事件给前端
                 ▼
┌─────────────────────────────────────┐
│ 3. 追加结果到 messages               │
│    messages.push({                   │
│      role: "user",                   │
│      content: [{                     │
│        type: "tool_result",          │
│        tool_use_id: "toolu_abc123",  │
│        content: "搜索结果..."         │
│      }]                              │
│    })                                │
└────────────────┬────────────────────┘
                 │
                 │  再次调用 LLM（带上工具结果）
                 ▼
┌─────────────────────────────────────┐
│ 4. LLM Provider.stream(messages)     │
│    state → "streaming"               │
│    - LLM 看到工具结果，继续生成回复    │
│    - 可能再次调用工具（循环继续）      │
│    - 或者生成最终文本回复（循环结束）   │
└──────────────────────────────────────┘
```

### 循环终止条件

Agent Loop 在以下情况终止：

| 条件 | 说明 |
|------|------|
| `stop_reason = "end_turn"` | LLM 认为回复完成，无需再调用工具 |
| 达到最大循环次数 | 防止无限循环，默认 10 次 |
| 遇到错误 | LLM API 错误、工具执行错误等 |
| 用户中止 | 前端发送 abort 信号 |

### 工具调用的事件序列

一次包含工具调用的完整事件序列：

```
event: state_change
data: {"type":"state_change","state":"streaming"}

event: text_delta
data: {"type":"text_delta","text":"让我搜索一下..."}

event: tool_call_start
data: {"type":"tool_call_start","toolCallId":"toolu_abc","toolName":"web_search"}

event: tool_call_delta
data: {"type":"tool_call_delta","toolCallId":"toolu_abc","partialJson":"{\"query\":"}

event: tool_call_delta
data: {"type":"tool_call_delta","toolCallId":"toolu_abc","partialJson":"\"什么是Agent\"}"}

event: state_change
data: {"type":"state_change","state":"tool_executing"}

event: tool_result
data: {"type":"tool_result","toolCallId":"toolu_abc","toolName":"web_search","result":"...","isError":false}

event: state_change
data: {"type":"state_change","state":"streaming"}

event: text_delta
data: {"type":"text_delta","text":"根据搜索结果..."}

event: done
data: {"type":"done","usage":{"inputTokens":256,"outputTokens":512}}

event: state_change
data: {"type":"state_change","state":"completed"}
```

---

## SSE 协议要点

Server-Sent Events 是本项目的核心传输协议，理解它的格式很重要。

### 格式规范

```
event: <事件类型>\n
data: <JSON 数据>\n
\n
```

- 每个字段以 `\n` 结尾
- 事件之间用空行 `\n` 分隔
- `event:` 是可选的事件类型标识
- `data:` 是数据载荷，必须是单行（JSON 不能换行）

### HTTP 头

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### 与 WebSocket 的区别

| 特性 | SSE | WebSocket |
|------|-----|-----------|
| 方向 | 服务端 → 客户端（单向） | 双向 |
| 协议 | 标准 HTTP | 独立协议（ws://） |
| 自动重连 | 浏览器原生支持 | 需要手动实现 |
| 数据格式 | 文本 | 文本 + 二进制 |

LLM 场景选 SSE 的原因：Agent 的响应是单向流（服务端 → 客户端），用户的新消息通过独立的 HTTP POST 发送。不需要双向通道。

---

## 状态变迁

整个请求-响应周期中，前端 UI 的状态变化：

```
idle ──► streaming ──► completed
  │          │              │
  │          ▼              │
  │    tool_executing       │
  │          │              │
  │          ▼              │
  │    streaming ───────────┘
  │
  └──► error（任何环节出错都可能跳转到此状态）
```

前端通过监听 `state_change` 事件来更新 UI：
- `streaming`：显示打字指示器，禁用发送按钮
- `tool_executing`：显示工具执行状态（工具名、输入参数）
- `completed`：恢复发送按钮，标记消息完成
- `error`：显示错误提示，允许重试
