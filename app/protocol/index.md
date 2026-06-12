# @myagent/protocol

## 概述

本目录定义前后端共享的 Zod Schema 和 TypeScript 类型。作为协议层，确保前后端对数据结构有统一的理解。

当前运行时协议只允许 `ollama` 和 `anthropic` 两个 Provider。OpenAI 是后续扩展槽，完成 Provider 实现前不进入会话创建/更新协议。

## 文件职责

| 文件 | 职责 |
|------|------|
| `agent-state.ts` | Agent 状态枚举 (`idle`, `streaming`, `tool_executing`, `completed`, `error`, `aborted`) |
| `api.ts` | API 统一响应信封 (`{ success, data?, error? }`)，错误码枚举 |
| `health.ts` | 健康检查响应格式 |
| `model.ts` | 模型信息相关 Schema：模型条目、模型身份指纹、模型能力探测请求/响应 |
| `provider.ts` | Provider 信息相关 Schema：Provider 条目（id/name/available）、Provider 列表响应 |
| `session.ts` | 会话相关 Schema：创建/更新会话请求（含 model/provider）、会话信息结构 |
| `message.ts` | 消息相关 Schema：内容块（文本/工具调用/工具结果）、消息结构、发送消息请求 |
| `stream-event.ts` | SSE 流事件 Schema：客户端接收的所有事件类型定义 |
| `tool.ts` | 工具相关 Schema：工具定义、JSON Schema 参数、工具调用、工具结果 |

## 工具协议

工具协议的代码唯一来源是 `src/tool.ts`。Phase 文档和 architecture 文档只能链接到这里，不能复制完整类型定义。

| Schema | 作用 | 关键字段 |
|--------|------|----------|
| `ToolJsonSchemaSchema` | Provider 可接收的 JSON Schema 子集 | `type`、`description`、`enum`、`properties`、`required`、`items` |
| `ToolInputSchemaSchema` | 工具输入参数根 Schema | 固定 `type: "object"`，默认 `properties: {}`、`required: []`、`additionalProperties: false` |
| `ToolNameSchema` | 工具名约束 | `^[a-z][a-z0-9_]*$`，最多 64 字符 |
| `ToolDefinitionSchema` | 暴露给 LLM Provider 的工具定义 | `name`、`description`、`inputSchema` |
| `ToolCallSchema` | 一次完整工具调用 | `id`、`name`、`input` |
| `ToolResultSchema` | 工具执行结果 | `toolUseId`、`content`、`isError` |

运行时工具执行器（`execute` 函数、AbortSignal、日志上下文）不属于 protocol，必须放在 `app/service/src/tools/`。

## 模型能力协议

模型能力协议的代码唯一来源是 `src/model.ts`。它用于模型列表、模型身份指纹、tools 支持状态和能力探测 API。

| Schema | 作用 |
|--------|------|
| `ModelInfoSchema` | 模型列表条目，允许携带 Ollama identity 元数据 |
| `ModelIdentitySchema` | 模型身份指纹，用于判断缓存是否仍有效 |
| `ModelToolCapabilitySchema` | tools 支持状态、来源、置信度和错误摘要 |
| `ModelCapabilitiesSchema` | 单个模型的能力结果 |
| `ModelCapabilityProbeRequestSchema` | 手动探测/刷新请求 |
| `ModelCapabilityResponseSchema` | 能力查询或探测响应 |

数据库表结构、运行时探测 prompt、并发锁和 TTL 策略属于服务端实现与架构设计，不属于 protocol；详见 [工具系统架构](../../doc/architecture/tool-system.md#5-模型能力探测与缓存)。

## SSE 事件类型

| 事件类型 | 说明 |
|----------|------|
| `text_delta` | 文本增量，流式文本片段 |
| `tool_call_start` | 工具调用开始 |
| `tool_call_delta` | 工具调用增量，逐步传递 JSON 参数 |
| `tool_result` | 工具执行结果 |
| `state_change` | Agent 状态变更 |
| `error` | 错误事件，包含错误码和是否可重试 |
| `done` | 流结束，包含 token 用量统计 |

## API 端点

| 方法 | 路径 | 请求/响应 |
|------|------|-----------|
| `GET` | `/api/health` | 响应: `HealthResponse { status, uptime, timestamp }` |
| `POST` | `/api/session` | 请求: `CreateSessionRequest { systemPrompt?, model?, provider? }` / 响应: `Session` |
| `GET` | `/api/session/:id` | 响应: `Session` |
| `PATCH` | `/api/session/:id` | 请求: `UpdateSessionRequest { systemPrompt?, model?, provider? }` / 响应: `Session` |
| `DELETE` | `/api/session/:id` | 响应: `null` |
| `GET` | `/api/providers` | 响应: `{ providers: ProviderInfo[] }` |
| `GET` | `/api/models?provider=ollama` | 响应: `{ models: ModelInfo[] }` |
| `GET` | `/api/model-capabilities?provider=ollama&model=...` | 响应: `ModelCapabilityResponse` |
| `POST` | `/api/model-capabilities/probe` | 请求: `ModelCapabilityProbeRequest` / 响应: `ModelCapabilityResponse` |
| `POST` | `/api/session/:id/chat` | 请求: `SendMessageRequest { content: string }` / 响应: SSE 流 (`StreamEvent`) |

所有端点返回统一信封格式：
- 成功: `{ success: true, data: T }`
- 失败: `{ success: false, error: { code: ErrorCode, message: string } }`

## 使用方式

### 后端（@myagent/service）

```typescript
import { CreateSessionRequestSchema, SendMessageRequestSchema } from "@myagent/protocol";
import type { ApiErrorResponse, Session } from "@myagent/protocol";
// 配合 @hono/zod-validator 进行请求校验
```

### 前端

```typescript
import type { StreamEvent, Session, Message, HealthResponse } from "@myagent/protocol";
// 类型安全地处理 SSE 事件和 API 响应
```
