# 工具/能力插件系统架构

本文档是 Phase 3 工具系统的架构唯一来源。Phase 文档只引用本文，不复制工具协议、Agent Loop 状态机、Provider 映射规则。

---

## 1. 目标边界

Phase 3 要解决的问题是：让 Agent 不只生成文本，还能在模型提出工具调用时执行本地能力，并把结果回填给模型继续生成最终回答。

完整闭环：

```
用户消息
  → Context Builder 输出历史消息
  → LLM Provider 携带 tools 调用模型
  → Provider 解析 tool_use / tool_calls
  → Agent Loop 收集工具参数
  → Tool Registry 查找并执行工具
  → 工具结果写回 messages
  → 再次调用 LLM
  → 输出最终回答
```

Phase 3 只实现低风险、确定性的内置工具：

| 工具 | 作用 | 选择理由 |
|------|------|----------|
| `calculator` | 结构化四则运算 | 结果可验证，适合测试 Tool Call 闭环 |
| `current_time` | 返回当前时间 | 无外部依赖，适合验证工具参数、时区和 UI 展示 |

不在 Phase 3 做的事：

- 外部网络工具（Web search、HTTP fetch）
- 文件系统读写工具
- 用户自定义动态插件加载
- 权限系统和沙箱隔离

这些能力会扩大安全边界，应放在后续 Phase 做护栏和权限模型后再引入。

---

## 2. 协议分层

工具系统有两层类型，不能混在一起：

| 层级 | 位置 | 作用 | 是否可包含函数 |
|------|------|------|---------------|
| 跨端协议 | `app/protocol/src/tool.ts` | 前后端共享、可序列化、可持久化 | 否 |
| 服务端运行时 | `app/service/src/tools/types.ts` | 注册执行器、注入上下文、执行工具 | 是 |

### 2.1 跨端协议

协议唯一来源是 [app/protocol/src/tool.ts](../../app/protocol/src/tool.ts)。

核心结构：

- `ToolDefinitionSchema`：暴露给 Provider 的工具定义，包含 `name`、`description`、`inputSchema`
- `ToolCallSchema`：一次完整工具调用，包含 `id`、`name`、`input`
- `ToolResultSchema`：工具执行结果，包含 `toolUseId`、`content`、`isError`
- `ToolInputSchemaSchema`：工具参数的 JSON Schema 子集，固定为 object 根类型

`inputSchema` 使用 JSON Schema 子集而不是 Zod，是因为 Provider API（Anthropic、Ollama）都要求可序列化 JSON Schema。Zod schema 可以服务端内部使用，但不能直接发送给模型 API。

### 2.2 服务端运行时类型

运行时工具接口位于 `app/service/src/tools/types.ts`：

```typescript
interface ToolExecutor {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
```

这里的 `execute` 是函数，不能进入 `@myagent/protocol`。前端只知道工具调用和结果，不知道工具如何执行。

---

## 3. Tool Registry

Tool Registry 是工具系统的目录服务：负责注册、查找和导出工具定义。

职责：

1. 启动时注册所有内置工具
2. 校验工具名唯一
3. 按工具名查找执行器
4. 将运行时工具转换为 `ToolDefinition[]` 供 Provider 使用

建议接口：

```typescript
interface ToolRegistry {
  list(): ToolExecutor[];
  get(name: string): ToolExecutor | undefined;
  definitions(): ToolDefinition[];
}
```

### 名称约束

工具名必须符合 `^[a-z][a-z0-9_]*$`。

理由：

- 与 Provider 的工具名约束兼容
- 避免空格、短横线、大小写造成跨 Provider 差异
- 方便前端展示和日志检索

重复工具名必须在创建 registry 时失败，不能后注册覆盖。工具覆盖会让模型看到的工具定义和实际执行器不一致，是非常隐蔽的生产事故来源。

---

## 4. Provider 工具映射

不同 Provider 的工具协议不一样，但 Agent Loop 不应该关心这些差异。

### 4.1 Anthropic

Anthropic Messages API 使用顶层 `tools` 字段：

```json
{
  "name": "calculator",
  "description": "Perform arithmetic calculation",
  "input_schema": {
    "type": "object",
    "properties": {
      "a": { "type": "number" },
      "b": { "type": "number" },
      "operator": { "type": "string", "enum": ["+", "-", "*", "/"] }
    },
    "required": ["a", "b", "operator"]
  }
}
```

映射规则：

| Protocol | Anthropic |
|----------|-----------|
| `ToolDefinition.name` | `name` |
| `ToolDefinition.description` | `description` |
| `ToolDefinition.inputSchema` | `input_schema` |

Anthropic 工具调用是流式的：

- `content_block_start(type=tool_use)` 给出工具 `id` 和 `name`
- 多个 `content_block_delta(input_json_delta)` 给出参数 JSON 片段
- `content_block_stop` 表示参数收集完成
- `message_delta.stop_reason = "tool_use"` 表示模型等待工具结果

### 4.2 Ollama

Ollama `/api/chat` 支持 OpenAI 风格的 `tools` 数组，但本地模型是否真正会调用工具取决于模型能力。

Phase 3 策略：

- Provider 层可以映射工具定义
- 如果模型不返回 `tool_calls`，按纯文本响应处理
- 如果当前 Ollama 模型/版本不支持工具调用，不伪造工具调用，不在 Agent Loop 中硬编码 fallback

Ollama 流式格式是 NDJSON，不是 SSE。工具调用通常以 `message.tool_calls` 一次性返回，而不是 Anthropic 的增量 JSON。

---

## 5. Agent Loop 工具循环

Agent Loop 是工具系统的编排层。

核心状态：

```
streaming
  ├─ stop_reason=end_turn → completed
  └─ stop_reason=tool_use → tool_executing → streaming
```

循环步骤：

1. 发送 `state_change: streaming`
2. 调用 `provider.stream({ messages, tools })`
3. 转发 `text_delta` 给前端
4. 收集工具调用：
   - 工具 id
   - 工具名
   - 参数 JSON 片段
5. 当模型停止原因是 `tool_use`，切到 `tool_executing`
6. 从 Tool Registry 查找执行器
7. 执行工具并发送 `tool_result`
8. 将 assistant `tool_use` 和 user `tool_result` 追加到 messages
9. 再次调用 LLM
10. 直到 `end_turn`、错误、中止或达到 `maxIterations`

默认 `maxIterations = 5`。这个限制是护栏，不是优化项。没有它，模型可能在错误提示或工具失败时无限循环调用同一个工具。

---

## 6. 消息持久化

工具调用必须进入会话历史，否则下一轮模型看不到刚才执行过什么。

持久化内容块：

```typescript
assistant:
  { type: "tool_use", id, name, input }

user:
  { type: "tool_result", toolUseId, content, isError }
```

为什么工具结果作为 `user` 消息？

- Anthropic 工具结果以用户侧内容块回填
- Ollama/OpenAI 风格中工具结果是独立 `tool`/结果消息
- 项目内部先沿用现有 `Message.role = "user" | "assistant"`，避免 Phase 3 同时扩大消息角色协议

如果未来需要 OpenAI 兼容角色，可以在 protocol 中扩展 `Message.role`，但必须作为单独协议变更处理。

---

## 7. 前端展示模型

前端只消费 `StreamEvent`：

| 事件 | UI 行为 |
|------|---------|
| `tool_call_start` | 创建工具调用块，状态 `streaming` |
| `tool_call_delta` | 追加参数 JSON 片段 |
| `state_change: tool_executing` | 工具块切换为执行中 |
| `tool_result` | 显示结果，状态 completed/error |
| `error` | 显示可见错误，停止 loading |

推荐组件：

- `ToolCallBlock.tsx`：工具调用过程块
- `MessageBubble.tsx`：支持文本块和工具块混合渲染
- `StreamingMessage.tsx`：流式过程中显示文本与工具参数

前端不能推断或自行构造工具协议。所有工具 UI 的输入都来自 `@myagent/protocol` 的 `StreamEvent`。

---

## 8. 错误处理策略

| 错误 | 处理方式 |
|------|----------|
| 未知工具名 | 生成 `tool_result.isError=true`，可选择回填给 LLM 解释 |
| 参数 JSON 解析失败 | 发送可见 `error`，结束本轮 |
| 参数校验失败 | 生成错误 tool_result，让 LLM 有机会修正 |
| 工具执行抛错 | 捕获并生成 `tool_result.isError=true` |
| 达到 maxIterations | 发送 `error` 或终止原因，不能继续循环 |
| 用户中止 | AbortSignal 传入 Provider 和工具执行上下文 |

系统级错误和工具业务错误要区分：

- 工具业务错误：工具执行成功返回了失败结果，用 `tool_result.isError=true`
- 系统级错误：Provider 断流、数据库失败、Abort 之外的未预期异常，用 `error` + `state_change:error`

