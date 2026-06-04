# @myagent/protocol

## 概述

本目录定义前后端共享的 Zod Schema 和 TypeScript 类型。作为协议层，确保前后端对数据结构有统一的理解。

## 文件职责

| 文件 | 职责 |
|------|------|
| `agent-state.ts` | Agent 状态枚举 (`idle`, `streaming`, `tool_executing`, `completed`, `error`, `aborted`) |
| `session.ts` | 会话相关 Schema：创建会话请求、会话信息结构 |
| `message.ts` | 消息相关 Schema：内容块（文本/工具调用/工具结果）、消息结构、聊天请求 |
| `stream-event.ts` | SSE 流事件 Schema：客户端接收的所有事件类型定义 |
| `tool.ts` | 工具相关 Schema：工具定义、工具调用、工具结果 |

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

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/session` | 创建会话 |
| `GET` | `/api/session/:id` | 获取会话信息 |
| `DELETE` | `/api/session/:id` | 终止会话 |
| `POST` | `/api/session/:id/chat` | SSE 流式聊天 |

## 使用方式

### 后端（@myagent/service）

```typescript
import { CreateSessionRequestSchema } from "@myagent/protocol";
// 配合 @hono/zod-validator 进行请求校验
```

### 前端

```typescript
import type { StreamEvent, Session, Message } from "@myagent/protocol";
// 类型安全地处理 SSE 事件和 API 响应
```
