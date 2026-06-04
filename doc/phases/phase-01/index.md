# Phase 1：最小 Agent 循环

> 状态：🔜 待开始
> 前置依赖：Step 0 脚手架（已完成 ✅）
> 预计工作量：2-3 天

---

## 一、目标

用户在浏览器输入消息，服务端转发到 Anthropic API，LLM 的流式响应实时转发回浏览器逐字显示。

完成后验收标准：输入"你好"后，看到文字**逐字**出现（不是一次性显示）。

---

## 二、前置阅读（必读）

实现前需要先理解以下文档，它们定义了设计决策和外部规范：

| 文档 | 必读章节 | 你会了解到 |
|------|---------|-----------|
| [LLM 集成层架构](../../architecture/llm-integration.md) | §2 分层架构、§3 归一化事件类型、§6 Provider 接口 | 为什么分 4 层、NormalizedStreamEvent 的 8 种事件、AsyncIterable 选型 |
| [Anthropic Messages API 参考](../../references/anthropic-messages-api.md) | §2 SSE 事件格式、§3 事件序列图 | Anthropic SSE 的 8 种原始事件、JSON 结构、事件生命周期 |
| [数据流设计](../../architecture/data-flow.md) | §1 请求流、§2 响应流 | 端到端数据怎么流转 |
| [协议定义](../../../app/protocol/index.md) | 全部 | 前后端共享的 Schema（SSE 事件、请求、响应） |

---

## 三、协议层（已就绪）

以下 Schema 已在 `app/protocol/src/` 中定义完成，实现时直接 import 使用。

### 客户端发送

| 端点 | Schema 文件 | 请求格式 |
|------|-----------|---------|
| `POST /api/session` | `session.ts` → `CreateSessionRequestSchema` | `{ systemPrompt?, model?, provider? }` |
| `POST /api/session/:id/chat` | `message.ts` → `SendMessageRequestSchema` | `{ content: string }` |
| `GET /api/session/:id` | 无请求体 | — |
| `DELETE /api/session/:id` | 无请求体 | — |

### 服务端返回（REST）

所有 REST 端点使用统一信封（定义在 `api.ts`）：

```typescript
// 成功
{ success: true, data: T }
// 失败
{ success: false, error: { code: ErrorCode, message: string } }
```

### 服务端返回（SSE 流）

chat 端点返回 SSE 流，事件类型定义在 `stream-event.ts` → `StreamEventSchema`。

Phase 1 涉及的客户端事件：

| 事件 | 字段 | Phase 1 用途 |
|------|------|-------------|
| `text_delta` | `{ type, text }` | 前端逐字拼接显示 |
| `state_change` | `{ type, state }` | 更新 UI 状态指示器 |
| `error` | `{ type, code, message, retryable }` | 显示错误提示 |
| `done` | `{ type, usage: { inputTokens, outputTokens } }` | 流结束，解锁输入框 |

### 服务端内部类型（需要新建）

以下类型**不在** `app/protocol/` 中（前端不可见），需要在 `app/service/src/llm/types/` 中新建：

| 文件 | 类型 | 定义见 |
|------|------|-------|
| `normalized.ts` | `NormalizedStreamEvent`（8 种内部事件） | [LLM 架构 §3](../../architecture/llm-integration.md#3-归一化事件类型) |
| `provider.ts` | `LLMProvider` 接口 + `LLMStreamParams` | [LLM 架构 §6](../../architecture/llm-integration.md#6-provider-接口) |
| `message.ts` | `NormalizedMessage` + `NormalizedContentBlock` | [LLM 架构 §6](../../architecture/llm-integration.md#6-provider-接口) |

实现时按架构文档中的类型定义编写。

---

## 四、服务端模块（按实现顺序）

### 模块 1：LLM 内部类型（`app/service/src/llm/types/`）

按 [LLM 架构文档](../../architecture/llm-integration.md#3-归一化事件类型) 中的定义，创建以下文件：

| 文件 | 内容 |
|------|------|
| `normalized.ts` | `NormalizedStreamEvent` 判别联合（8 种事件） |
| `provider.ts` | `LLMProvider` 接口、`LLMStreamParams`、`LLMConfig` |
| `message.ts` | `NormalizedMessage`、`NormalizedContentBlock` |
| `index.ts` | barrel 导出 |

### 模块 2：Anthropic API 类型（`anthropic/types.ts`）

按 [Anthropic API 参考](../../references/anthropic-messages-api.md#1-请求格式) 定义 Anthropic 原始类型：

| 类型 | 对应 API 文档 |
|------|-------------|
| `AnthropicMessageRequest` | 请求体 schema（model, max_tokens, messages, stream, system） |
| `AnthropicMessageParam` | 消息格式（role, content） |
| `AnthropicContentBlock` | 内容块（text, tool_use） |
| `AnthropicStreamEvent` | 原始 SSE 事件联合（8 种） |
| `AnthropicDelta` | delta 变体（text_delta, input_json_delta） |
| `AnthropicApiError` | 错误类型（含 status, retryable 标记） |

注意字段命名：Anthropic 用 `snake_case`（`max_tokens`、`tool_use_id`），项目内部用 `camelCase`。

### 模块 3：Anthropic HTTP 客户端（`anthropic/client.ts`）

职责：用原生 `fetch()` 调用 `POST /v1/messages`，返回 `ReadableStream<Uint8Array>`。

实现要点：
- Headers：`x-api-key`、`anthropic-version: 2023-06-01`、`Content-Type: application/json`
- Body：`stream: true` 开启流式
- `signal` 参数透传 `AbortSignal`
- 非 200 响应：解析 error body，抛出 `AnthropicApiError`（含 `status`、`retryable` 字段）
- 返回 `response.body!`

> 请求格式详见 [Anthropic API 参考 §1](../../references/anthropic-messages-api.md#1-请求格式)

### 模块 4：SSE 流解析器（`anthropic/stream-parser.ts`）⭐

职责：`ReadableStream<Uint8Array>` → `AsyncIterable<NormalizedStreamEvent>`

算法核心（三步）：

```
1. byteStream.pipeThrough(new TextDecoderStream()).getReader()
2. buffer 累积 + 按 \n\n 分割事件块
3. 每个事件块：提取 event:/data: 行 → JSON.parse → switch(type) 映射为归一化事件
```

必须处理的陷阱：
- **buffer 机制**：一次 read() 可能包含半个事件或多个事件
- **`ping` 事件**：心跳，必须忽略
- **Phase 1 不需要拼接 `input_json_delta`**，但 stream-parser 要正确 yield `tool_call_delta` 事件

> 事件映射规则和 JSON 字段详见 [Anthropic API 参考 §2-§3](../../references/anthropic-messages-api.md#2-sse-流式响应)

### 模块 5：消息格式映射器（`anthropic/mapper.ts`）

`NormalizedMessage[]` → `AnthropicMessageParam[]`

Phase 1 只处理 `text` 类型内容块。`tool_use` / `tool_result` 映射留 Phase 3。

### 模块 6：Provider 组装 + 工厂

| 文件 | 职责 |
|------|------|
| `anthropic/index.ts` | 组装 client + stream-parser + mapper → `LLMProvider` |
| `providers/factory.ts` | `createLLMProvider(config)` 工厂函数 |
| `llm/index.ts` | barrel 导出 |

### 模块 7：环境配置（`app/service/src/config.ts`）

从环境变量加载配置，启动时校验必需项：

```typescript
// 必需：
//   ANTHROPIC_API_KEY
// 可选：
//   ANTHROPIC_BASE_URL（代理/本地模型）
//   DEFAULT_MODEL（默认 claude-sonnet-4-20250514）
//   PORT（默认 3001）
```

service 的 `dev` 脚本修改为：`tsx watch --env-file=../../.env src/index.ts`

### 模块 8：SSE 中继（`app/service/src/relay/sse-relay.ts`）

职责：`NormalizedStreamEvent` → 客户端 `StreamEvent`（定义在 `@myagent/protocol`）→ SSE 格式写入 HTTP 响应。

事件映射规则（Phase 1）：

| 内部事件（NormalizedStreamEvent） | 客户端事件（StreamEvent） | 说明 |
|-------------------------------|----------------------|------|
| `text_delta` | `text_delta` | 转发 text 字段 |
| `message_delta` | `state_change` → `"completed"` | 当 stopReason=end_turn |
| `message_stop` | `done` + usage | 流结束 |
| `error` | `error` | 转发 |
| 其他（message_start, content_block_*） | 不转发 | 内部状态 |

### 模块 9：聊天路由（更新 `app/service/src/routes/chat.ts`）

用 `zValidator("json", SendMessageRequestSchema)` 校验请求体。

流程：
1. 从 session store 获取会话（不存在则 404）
2. 构建 `NormalizedMessage`：`[{ role: "user", content: [{ type: "text", text: body.content }] }]`
3. 创建 `ReadableStream`，内部调用 `provider.stream()` + relay 翻译
4. 返回 `new Response(stream, { headers: SSE headers })`
5. 监听 `c.req.raw.signal` 的 abort 事件 → 取消上游 LLM 请求

---

## 五、Web 前端设计

### 5.1 Phase 1 UI 功能需求

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 消息列表 | 显示用户消息和 Agent 回复，支持滚动 | 必须 |
| 流式文本 | Agent 回复逐字出现，未完成时有光标/闪烁指示 | 必须 |
| 输入框 | 底部固定，Enter 发送，流式中禁用 | 必须 |
| 状态指示 | 流式中显示"Agent 正在思考..."，错误时显示错误信息 | 必须 |
| 自动滚动 | 新消息或流式文本增长时自动滚动到底部 | 必须 |
| 空状态 | 无消息时显示引导文案 | 建议 |

Phase 1 **不需要**：侧边栏、会话列表、会话切换、设置面板。

### 5.2 组件结构

```
App.tsx
│  顶层布局（全屏容器、flex column）
│  管理会话 ID（Phase 1 使用默认会话）
│
├── components/chat/
│   │
│   ├── ChatContainer.tsx
│   │   整个聊天区域的容器组件
│   │   使用 useChat hook 获取状态
│   │   组合 MessageList + ChatInput
│   │
│   ├── MessageList.tsx
│   │   可滚动的消息列表
│   │   props: messages[], currentText, isStreaming
│   │   自动滚动逻辑（useRef + scrollIntoView）
│   │
│   ├── MessageBubble.tsx
│   │   单条消息的渲染
│   │   props: role ("user" | "assistant"), content: string
│   │   用户消息和 Agent 消息使用不同样式
│   │
│   ├── StreamingMessage.tsx
│   │   流式文本渲染（仅 Agent 消息在流式中使用）
│   │   props: text: string, isActive: boolean
│   │   尾部闪烁光标动画（CSS animation）
│   │
│   └── ChatInput.tsx
│       底部输入区域
│       props: onSend(content), disabled: boolean
│       Enter 发送，Shift+Enter 换行
│       streaming 时禁用输入和按钮
```

### 5.3 状态管理

`useChat` hook 是前端唯一的状态中心：

```
useChat(sessionId) → {
  messages: ChatMessage[]     // 完成的消息列表
  currentText: string         // 流式中累积的文本（未完成）
  isStreaming: boolean         // 是否正在流式接收
  error: string | null         // 最近的错误信息
  send(content: string): void  // 发送消息
}
```

组件数据流：

```
useChat ──► ChatContainer
             ├── messages + currentText + isStreaming ──► MessageList
             │                                            ├── MessageBubble × N
             │                                            └── StreamingMessage（仅 isStreaming 时）
             └── send + isStreaming ──► ChatInput
```

### 5.4 视觉布局

```
┌────────────────────────────────────────────┐
│  🤖 MyAgent     Phase 1                   │ ← header (固定)
├────────────────────────────────────────────┤
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ 👤 你好                             │  │ ← 用户消息（右对齐/深色背景）
│  └──────────────────────────────────────┘  │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │ 🤖 你好！我是 AI Agent，有什么可以    │  │ ← Agent 消息（左对齐/边框）
│  │    帮你的吗？█                       │  │ ← 流式时尾部有闪烁光标
│  └──────────────────────────────────────┘  │
│                                            │ ← 可滚动区域 (flex: 1, overflow-y: auto)
│  ┌──────────────────────────────────────┐  │
│  │ ⏳ Agent 正在思考...                 │  │ ← 状态提示（仅 streaming 时）
│  └──────────────────────────────────────┘  │
│                                            │
├────────────────────────────────────────────┤
│  ┌──────────────────────────────┐ [发送]   │ ← footer (固定)
│  │ 输入消息...                   │          │
│  └──────────────────────────────┘          │
└────────────────────────────────────────────┘
```

深色主题 CSS 变量已在 `app/web/src/styles/index.css` 中定义。

### 5.5 前端文件清单

| 文件 | 职责 | 新建/更新 |
|------|------|----------|
| `src/api/client.ts` | SSE 流式客户端（fetch + ReadableStream → AsyncIterable\<StreamEvent\>） | 更新 |
| `src/hooks/useChat.ts` | 聊天状态管理 hook | 更新 |
| `src/components/chat/ChatContainer.tsx` | 聊天区域容器 | 新建 |
| `src/components/chat/MessageList.tsx` | 消息列表 + 自动滚动 | 新建 |
| `src/components/chat/MessageBubble.tsx` | 单条消息渲染 | 新建 |
| `src/components/chat/StreamingMessage.tsx` | 流式文本 + 闪烁光标 | 新建 |
| `src/components/chat/ChatInput.tsx` | 输入框 + 发送按钮 | 新建 |
| `src/App.tsx` | 顶层布局，组合 ChatContainer | 更新 |

### 5.6 前端实现要点

**`api/client.ts`** — SSE 流消费：
- 用 `fetch`（非 EventSource——需要 POST）
- `buffer + \n\n` 分割模式（和服务端解析 Anthropic SSE 一样）
- 返回 `AsyncIterable<StreamEvent>`（`StreamEvent` 从 `@myagent/protocol` import）
- 透传 `AbortSignal` 给 fetch

**`hooks/useChat.ts`** — 状态管理：
- `accumulated` 局部变量累积文本（不读 React state，避免旧值）
- `AbortController` 防竞态：发送新消息时中止旧请求
- `AbortError` 静默处理

**`StreamingMessage.tsx`** — 流式文本：
- 接收 `text` prop，直接渲染
- `isActive` 时显示尾部闪烁光标（`@keyframes blink`）
- 光标用 `::after` 伪元素实现，不影响文本内容

---

## 六、完整文件清单与实现顺序

### 服务端（按依赖顺序）

| # | 文件 | 职责 | 新建/更新 |
|---|------|------|----------|
| 1 | `service/src/llm/types/normalized.ts` | NormalizedStreamEvent 8 种事件 | 新建 |
| 2 | `service/src/llm/types/provider.ts` | LLMProvider 接口 | 新建 |
| 3 | `service/src/llm/types/message.ts` | NormalizedMessage | 新建 |
| 4 | `service/src/llm/types/index.ts` | barrel 导出 | 新建 |
| 5 | `service/src/llm/providers/anthropic/types.ts` | Anthropic API 原始类型 | 新建 |
| 6 | `service/src/llm/providers/anthropic/client.ts` | HTTP 客户端 | 新建 |
| 7 | `service/src/llm/providers/anthropic/stream-parser.ts` | SSE 解析器 ⭐ | 新建 |
| 8 | `service/src/llm/providers/anthropic/mapper.ts` | 消息格式转换 | 新建 |
| 9 | `service/src/llm/providers/anthropic/index.ts` | Provider 组装 | 新建 |
| 10 | `service/src/llm/providers/factory.ts` | Provider 工厂 | 新建 |
| 11 | `service/src/llm/index.ts` | LLM barrel 导出 | 新建 |
| 12 | `service/src/config.ts` | 环境变量加载 + 校验 | 新建 |
| 13 | `service/src/relay/sse-relay.ts` | 事件翻译 + SSE 写入 | 新建 |
| 14 | `service/src/routes/chat.ts` | 聊天路由 | 更新 |
| 15 | `service/src/index.ts` | 引入 config | 更新 |
| 16 | `service/package.json` | dev 脚本加 --env-file | 更新 |

### 前端（按依赖顺序）

| # | 文件 | 职责 | 新建/更新 |
|---|------|------|----------|
| 17 | `web/src/api/client.ts` | SSE 流客户端 | 更新 |
| 18 | `web/src/hooks/useChat.ts` | 聊天 hook | 更新 |
| 19 | `web/src/components/chat/MessageBubble.tsx` | 消息气泡 | 新建 |
| 20 | `web/src/components/chat/StreamingMessage.tsx` | 流式文本 + 光标 | 新建 |
| 21 | `web/src/components/chat/MessageList.tsx` | 消息列表 + 自动滚动 | 新建 |
| 22 | `web/src/components/chat/ChatInput.tsx` | 输入框 | 新建 |
| 23 | `web/src/components/chat/ChatContainer.tsx` | 容器 | 新建 |
| 24 | `web/src/App.tsx` | 顶层布局 | 更新 |

---

## 七、边缘情况

### 1. Anthropic API 错误分级

> 状态码和错误类型详见 [Anthropic API 参考 §5](../../references/anthropic-messages-api.md#5-错误响应)

Phase 1 处理方式：全部抛出 `AnthropicApiError`，包含 `retryable` 标记（为 Phase 5 预留）。429/500/529 标记为可重试，400/401/403 不可重试。

### 2. 前端竞态

`useChat` 用 `AbortController` 解决——发送新消息时 abort 旧请求。`AbortError` 静默处理。

### 3. 服务端连接断开

监听 `c.req.raw.signal` 的 abort → 取消上游 Anthropic 请求（节省 token）。

### 4. 环境变量缺失

`config.ts` 启动时校验 `ANTHROPIC_API_KEY`，缺失则 `process.exit(1)` 并提示。

### 5. 调试日志

关键路径日志点：

```
[Chat]  收到请求 sessionId=%s contentLength=%d
[LLM]   调用 Anthropic model=%s
[LLM]   流开始 messageId=%s
[LLM]   流结束 stopReason=%s outputTokens=%d duration=%dms
[Chat]  响应完成 sessionId=%s
[Error] %s sessionId=%s error=%s
```

---

## 八、验证清单

```
代码质量
- [ ] pnpm run lint 通过
- [ ] pnpm run typecheck 通过
- [ ] 无 console.log 残留（使用结构化日志）

功能验证
- [ ] pnpm dev 启动，前端 http://localhost:5173 可访问
- [ ] 输入 "你好"，文字逐字流式出现
- [ ] 输入长问题（"详细解释 TCP 三次握手"），流式不卡顿
- [ ] 流式过程中输入框禁用、显示"Agent 正在思考..."
- [ ] 流式结束后输入框恢复、光标消失
- [ ] 自动滚动到最新消息

错误处理
- [ ] 关闭服务端后发消息，前端显示错误提示
- [ ] .env 中 API Key 为空，服务端启动时报错并退出
- [ ] 浏览器 DevTools Network 面板确认 SSE 事件格式正确

日志
- [ ] 服务端日志完整：收到请求 → 调用 LLM → 流开始 → 流结束（含 duration）
```

---

## 九、相关文档索引

| 主题 | 文档 |
|------|------|
| LLM 分层架构 + NormalizedStreamEvent 定义 | [architecture/llm-integration.md](../../architecture/llm-integration.md) §2-§3 |
| Anthropic SSE 事件格式（JSON 完整示例） | [references/anthropic-messages-api.md](../../references/anthropic-messages-api.md) §2-§3 |
| Anthropic 错误响应 + 状态码 | [references/anthropic-messages-api.md](../../references/anthropic-messages-api.md) §5 |
| 端到端数据流图 | [architecture/data-flow.md](../../architecture/data-flow.md) §1-§2 |
| Provider 接口 + AsyncIterable 选型 | [architecture/llm-integration.md](../../architecture/llm-integration.md) §6 |
| 前后端协议（Schema 源码） | [app/protocol/index.md](../../../app/protocol/index.md) |
| SSE 事件 Schema（客户端） | [`app/protocol/src/stream-event.ts`](../../../app/protocol/src/stream-event.ts) |
| 请求 Schema | [`app/protocol/src/message.ts`](../../../app/protocol/src/message.ts) → `SendMessageRequestSchema` |
| 会话 Schema | [`app/protocol/src/session.ts`](../../../app/protocol/src/session.ts) |
| API 响应信封 | [`app/protocol/src/api.ts`](../../../app/protocol/src/api.ts) |
| 环境搭建 | [guides/setup.md](../../guides/setup.md) |
| API 密钥配置 | [guides/accounts.md](../../guides/accounts.md) |
