# Anthropic Messages API 参考

> 基于 Anthropic 官方文档整理，供项目实现者离线查阅。
> 官方文档：https://docs.anthropic.com/en/api/messages-streaming

---

## 请求格式

### 端点

POST https://api.anthropic.com/v1/messages

### 必需 Headers

| Header | 值 | 说明 |
|--------|---|------|
| `Content-Type` | `application/json` | — |
| `x-api-key` | `sk-ant-...` | API 密钥（不是 Bearer token） |
| `anthropic-version` | `2023-06-01` | API 版本，目前稳定版本 |

### 请求体 Schema

```typescript
interface AnthropicMessageRequest {
  model: string;                // 如 "claude-sonnet-4-20250514"
  max_tokens: number;           // 最大输出 token 数，必填
  messages: AnthropicMessage[]; // 对话消息数组
  system?: string;              // 系统提示词
  stream: true;                 // 流式模式
  temperature?: number;         // 0.0-1.0，默认 1.0
  top_p?: number;               // 核采样
  top_k?: number;               // Top-K 采样
  stop_sequences?: string[];    // 停止序列
  metadata?: { user_id?: string }; // 元数据
  tools?: AnthropicTool[];      // 工具定义（Phase 3）
  tool_choice?: AnthropicToolChoice; // 工具选择策略
}
```

### 消息格式

```typescript
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

// content 可以是简单字符串或内容块数组
// 字符串形式等价于 [{ type: "text", text: "..." }]
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
```

> 注意字段命名：Anthropic 用 `snake_case`（如 `tool_use_id`、`is_error`、`max_tokens`）。

---

## SSE 流式响应

流式响应使用 Server-Sent Events（SSE）协议。每个事件格式为：

```
event: <event_type>
data: <json_payload>
```

### 事件类型

#### message_start

流的第一个事件，包含完整的 message 对象（content 为空数组）。

```json
{
  "type": "message_start",
  "message": {
    "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
    "type": "message",
    "role": "assistant",
    "content": [],
    "model": "claude-sonnet-4-20250514",
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 25,
      "output_tokens": 0
    }
  }
}
```

#### content_block_start — 文本块变体

```json
{
  "type": "content_block_start",
  "index": 0,
  "content_block": {
    "type": "text",
    "text": ""
  }
}
```

#### content_block_start — 工具调用变体

```json
{
  "type": "content_block_start",
  "index": 1,
  "content_block": {
    "type": "tool_use",
    "id": "toolu_01A09q90qw90lq917835lq9",
    "name": "get_weather",
    "input": {}
  }
}
```

> 注意：`input` 在 start 事件中始终为 `{}`，真正的参数通过 `input_json_delta` 增量到达。

#### content_block_delta — text_delta 变体

```json
{
  "type": "content_block_delta",
  "index": 0,
  "delta": {
    "type": "text_delta",
    "text": "你好"
  }
}
```

#### content_block_delta — input_json_delta 变体

```json
{
  "type": "content_block_delta",
  "index": 1,
  "delta": {
    "type": "input_json_delta",
    "partial_json": "{\"location\":"
  }
}
```

#### content_block_stop

```json
{
  "type": "content_block_stop",
  "index": 0
}
```

#### message_delta

```json
{
  "type": "message_delta",
  "delta": {
    "stop_reason": "end_turn",
    "stop_sequence": null
  },
  "usage": {
    "output_tokens": 42
  }
}
```

#### message_stop

```json
{
  "type": "message_stop"
}
```

#### ping

心跳事件，用于保持连接活跃。

```json
{
  "type": "ping"
}
```

#### error

流内错误事件。

```json
{
  "type": "error",
  "error": {
    "type": "overloaded_error",
    "message": "Overloaded"
  }
}
```

---

## 事件序列

### 纯文本响应

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

### 工具调用响应

```
event: message_start
data: {...}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"让我查一下天气"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01xxx","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"location\":"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"北京\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":32}}

event: message_stop
data: {"type":"message_stop"}
```

---

## stop_reason 值

| 值 | 含义 | Agent 行为 |
|----|------|-----------|
| `end_turn` | 模型自然结束 | 结束循环 |
| `max_tokens` | 达到 token 上限 | 结束循环（响应可能被截断） |
| `stop_sequence` | 遇到停止序列 | 结束循环 |
| `tool_use` | 模型请求调用工具 | 执行工具 -> 追加结果 -> 再次调用 |

---

## 错误响应

### 非流式错误（HTTP 状态码 != 200）

```typescript
interface AnthropicErrorResponse {
  type: "error";
  error: {
    type: string;    // 错误类型标识
    message: string; // 人类可读描述
  };
}
```

| 状态码 | error.type | 含义 | 是否可重试 |
|--------|-----------|------|-----------|
| 400 | `invalid_request_error` | 请求格式错误 | 否 |
| 401 | `authentication_error` | API Key 无效 | 否 |
| 403 | `permission_error` | 权限不足 | 否 |
| 404 | `not_found_error` | 资源不存在 | 否 |
| 429 | `rate_limit_error` | 速率限制 | 是（读 `retry-after` header） |
| 500 | `api_error` | 服务端错误 | 是（指数退避） |
| 529 | `overloaded_error` | 服务过载 | 是（等待后重试） |

### 429 响应的重要 Headers

```
retry-after: 30
anthropic-ratelimit-requests-limit: 60
anthropic-ratelimit-requests-remaining: 0
anthropic-ratelimit-requests-reset: 2024-01-01T00:01:00Z
anthropic-ratelimit-tokens-limit: 100000
anthropic-ratelimit-tokens-remaining: 0
anthropic-ratelimit-tokens-reset: 2024-01-01T00:01:00Z
```

---

## 工具定义格式（Phase 3 参考）

```typescript
interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, JsonSchema>;
    required?: string[];
  };
}

// tool_choice 选项
type AnthropicToolChoice =
  | { type: "auto" }                  // 默认：模型自行决定
  | { type: "any" }                   // 强制调用工具（任意一个）
  | { type: "tool"; name: string };   // 强制调用指定工具
```

---

## 工具结果返回格式（Phase 3 参考）

工具执行后，结果作为 user 消息追加（Anthropic 要求）：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "北京当前天气：晴，25°C",
      "is_error": false
    }
  ]
}
```

> 注意字段名：Anthropic 用 `tool_use_id`（snake_case），项目归一化类型用 `toolUseId`（camelCase）。
