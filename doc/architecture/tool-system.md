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

## 5. 模型能力探测与缓存

Ollama 的 `/api/chat` 接受 `tools` 字段，不等于每个本地模型都能稳定产生真实 `tool_calls`。有些模型会在文本里表达工具意图，例如"我应该调用 current_time"，但不会返回结构化工具调用。Phase 3 必须把"模型是否支持工具"作为可查询、可缓存的能力，而不是在 Agent Loop 中事后猜测。

能力判断分三层，不能混用：

| 层级 | 作用 | 可信度 |
|------|------|--------|
| 静态身份 | 从模型列表和模型详情读取 `name`、`model`、`digest`、`modified_at`、模板/Modelfile 哈希 | 只能判断缓存是否仍有效 |
| 静态分析 | 服务端显式读取或探测 TEMPLATE / Modelfile，判断是否疑似具备 tools 模板 | 辅助信号，不能证明运行时可用 |
| 运行时探测 | 用最小工具定义向模型发起一次确定性探测，观察是否返回真实 `tool_calls` | Phase 3 判定 `supported` 的主要依据 |

外部 Agent 或模型不能被假定为自动理解 TEMPLATE 语义。即使 Modelfile 中出现工具相关模板，也只能标记为静态分析命中，仍需要运行时探测确认。

### 5.1 协议边界

跨端契约唯一来源是 [app/protocol/src/model.ts](../../app/protocol/src/model.ts)：

- `ModelIdentitySchema` 描述模型身份指纹。
- `ModelCapabilitiesSchema` 描述模型能力结果。
- `ModelToolCapabilitySchema` 描述 tools 支持状态。
- `ModelCapabilityProbeRequestSchema` / `ModelCapabilityResponseSchema` 描述探测 API。

Phase 文档、服务端实现和前端 UI 只能引用这些类型，不能复制字段定义。

### 5.2 模型身份指纹

缓存键必须包含 provider 和模型名，并尽量纳入 Ollama 可获得的稳定身份特征：

| 来源 | 建议字段 | 说明 |
|------|----------|------|
| `/api/tags` | `name`、`model`、`digest`、`modified_at`、`details` | `digest` 变化时必须视为新模型 |
| 模型详情/显式读取 | TEMPLATE hash、Modelfile hash | 读取不到时允许为空，但不能伪造 |
| 服务端派生 | `detailsHash` | 对 details 做稳定 JSON 序列化后哈希，用于捕捉量化/家族变化 |

有效缓存的匹配条件：

1. `provider` 与 `name` 完全一致。
2. 如果新旧记录都有 `digest`，必须相等。
3. 如果新旧记录都有 `modifiedAt`，必须相等。
4. 如果 template/modelfile/details hash 任一可用且发生变化，缓存失效。

字段缺失时不能反向证明模型未变化，只能降低置信度并依赖 TTL 或手动刷新。

### 5.3 探测状态

tools 支持状态使用 protocol 中的 `ModelToolSupportStatus`：

| 状态 | 含义 | 工具加载策略 |
|------|------|--------------|
| `unknown` | 尚无有效缓存或身份不足 | 默认不自动加载工具；UI 显示待探测 |
| `probing` | 正在探测 | 禁止重复探测；UI 显示进行中 |
| `supported` | 运行时返回了真实 `tool_calls` | Agent Loop 可传入 Tool Registry 定义 |
| `unsupported` | 模型只返回文本或明确不支持工具 | Agent Loop 不传入 tools |
| `unstable` | 出现工具意图文本但没有真实 tool_calls，或多次探测结果不一致 | Agent Loop 不传入 tools；UI 提示不稳定 |
| `error` | 探测请求失败或 Provider 不可达 | 不使用缓存结论；允许用户重试 |

检测到文本工具意图但没有结构化工具调用时，服务端应保留现有日志语义：`Tool intent detected without actual tool call`，并把该次探测结果记为 `unstable` 或降低置信度。

### 5.4 数据库缓存

建议新增 `model_capability_cache` 表，按模型身份缓存探测结果。表结构属于服务端实现细节，不进入 protocol，但必须能映射到 `ModelCapabilities`。

建议列：

| 列 | 说明 |
|----|------|
| `id` | 主键 |
| `provider`、`name`、`model` | 基础身份 |
| `digest`、`modified_at`、`template_hash`、`modelfile_hash`、`details_hash` | 身份指纹 |
| `tools_status`、`tools_confidence`、`tools_reason` | tools 能力结论 |
| `source` | `none`、`static_analysis`、`runtime_probe`、`manual_refresh` 或返回给客户端时的 `cache` |
| `probe_prompt_version` | 探测提示版本，提示变化时缓存失效 |
| `detected_at`、`expires_at`、`last_probe_error` | 生命周期与错误信息 |

失效策略：

- 身份指纹变化：立即失效。
- `probe_prompt_version` 变化：立即失效。
- `supported` / `unsupported` 默认 TTL 7 天。
- `unstable` / `error` 默认 TTL 1 天。
- 用户手动刷新必须绕过缓存并更新 `source=manual_refresh`。

并发策略：

- 同一 `provider + name + identity fingerprint` 同时只允许一个运行时探测。
- 其他请求读取旧的未过期缓存；若没有缓存，返回 `probing`。
- 探测完成后以新对象/新行更新，不在内存中原地修改共享对象。

### 5.5 工具加载策略

Chat 路由进入 Agent Loop 前先查询模型能力：

1. `supported`：传入 Tool Registry 的 `definitions()`。
2. `unsupported` / `unstable`：不传入 tools；模型按纯文本聊天。
3. `unknown`：不隐式触发每次聊天探测；除非用户在 UI 触发探测，否则不传入 tools。
4. `error`：不传入 tools，并向 UI 暴露可见状态。

这个策略避免把工具定义塞给不支持或不稳定的模型，也避免每次聊天都产生额外模型调用。

### 5.6 前端展示模型能力

模型选择器在用户选择模型后展示 tools 支持状态：

| 状态 | UI 行为 |
|------|---------|
| `unknown` | 显示"待探测"，提供刷新/探测按钮 |
| `probing` | 显示进行中，禁用重复触发 |
| `supported` | 显示 tools 可用，聊天可使用工具能力 |
| `unsupported` | 显示 tools 不支持，禁用工具能力提示 |
| `unstable` | 显示 tools 不稳定，禁用工具能力并提示纯文本模式 |
| `error` | 显示错误和重试入口 |

前端不能根据模型名称硬编码能力，也不能在模型列表未加载时用不存在的默认模型创建会话。

---

## 6. Agent Loop 工具循环

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

## 7. 消息持久化

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

## 8. 前端展示模型

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

## 9. 错误处理策略

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
