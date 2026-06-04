# Ollama Chat API 参考

> 来源：https://github.com/ollama/ollama/blob/main/docs/api.md

## 1. Chat API (POST /api/chat)

### 请求

端点：`POST http://localhost:11434/api/chat`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名，如 `"llama3.2"`, `"qwen2.5:7b"` |
| `messages` | array | 是 | 消息数组，支持 system/user/assistant/tool 角色 |
| `stream` | boolean | 否 | 默认 true |
| `options` | object | 否 | temperature, top_p, seed 等 |
| `keep_alive` | string | 否 | 模型驻留时间，默认 `"5m"` |
| `tools` | array | 否 | 工具列表（OpenAI 兼容格式） |

消息格式：
```json
{ "role": "user", "content": "你好" }
{ "role": "system", "content": "你是一个助手" }
{ "role": "assistant", "content": "你好！" }
{ "role": "tool", "content": "...", "tool_name": "get_weather" }
```

请求示例：
```json
{
  "model": "llama3.2",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Why is the sky blue?" }
  ],
  "options": { "temperature": 0.7 },
  "stream": true
}
```

### 流式响应（NDJSON 格式）

Ollama 流式响应是 **NDJSON**（每行一个完整 JSON，按 `\n` 分割），**不是 SSE**。

中间 chunk（`done: false`）：
```json
{"model":"llama3.2","created_at":"...","message":{"role":"assistant","content":"The"},"done":false}
{"model":"llama3.2","created_at":"...","message":{"role":"assistant","content":" sky"},"done":false}
{"model":"llama3.2","created_at":"...","message":{"role":"assistant","content":" is"},"done":false}
```

最终 chunk（`done: true`，包含统计信息）：
```json
{
  "model": "llama3.2",
  "created_at": "2023-08-04T19:22:45.499127Z",
  "message": { "role": "assistant", "content": "" },
  "done": true,
  "done_reason": "stop",
  "total_duration": 4883583458,
  "prompt_eval_count": 26,
  "prompt_eval_duration": 342546000,
  "eval_count": 282,
  "eval_duration": 4535599000
}
```

`done_reason` 可能值：`"stop"`, `"load"`, `"unload"`

### 工具调用

工具定义（OpenAI 兼容）：
```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get the weather in a given city",
    "parameters": { "type": "object", "properties": { "city": { "type": "string" } }, "required": ["city"] }
  }
}
```

工具调用在响应中：
```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      { "function": { "name": "get_weather", "arguments": { "city": "Tokyo" } } }
    ]
  },
  "done": false
}
```

工具结果回传：
```json
{ "role": "tool", "content": "11 degrees celsius", "tool_name": "get_weather" }
```

## 2. 模型列表 API (GET /api/tags)

端点：`GET http://localhost:11434/api/tags`

响应：
```json
{
  "models": [
    {
      "name": "llama3.2:latest",
      "model": "llama3.2:latest",
      "size": 2019393189,
      "digest": "a80c4f17acd...",
      "details": {
        "family": "llama",
        "parameter_size": "3.2B",
        "quantization_level": "Q4_K_M"
      }
    }
  ]
}
```

## 3. 与 Anthropic 关键差异

| 维度 | Anthropic | Ollama |
|------|-----------|--------|
| 端点 | POST /v1/messages | POST /api/chat |
| 流式格式 | SSE (\n\n 分割, event:/data: 行) | NDJSON (\n 分割, 每行一个 JSON) |
| System prompt | 顶层 system 字段 | messages 中的 {role: "system"} |
| 工具调用 | tool_use content block + input_json_delta 增量 | tool_calls 数组一次性返回 |
| 工具结果 | {role: "user", content: [{type: "tool_result"}]} | {role: "tool", tool_name, content} |
| 认证 | x-api-key + anthropic-version | 无认证（本地） |
| 端口 | 443 | 11434 |
