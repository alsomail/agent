# Phase 3：工具/能力插件系统

> 状态：🚧 当前实现
> 前置依赖：Phase 1（已完成 ✅）、Phase 2（已完成 ✅）
> 预计工作量：5-6 天

---

## 一、目标与验收标准

让 Agent 从"只能聊天"升级为"可以安全调用工具完成任务"，并在用户选择模型后明确知道该模型是否支持 tools。Phase 3 聚焦手写 Tool Call 的完整闭环：模型能力探测与缓存 → 按能力加载工具 → Provider 解析工具调用 → Agent Loop 执行工具 → 将工具结果回填给 LLM → 前端展示工具过程。

验收标准：

- 用户选择 Ollama 模型 → UI 展示 tools 支持状态；未知时可触发探测，缓存命中时不重复调用模型。
- Ollama 模型只在文本中表达工具意图但没有真实 `tool_calls` → 服务端记录不稳定状态，UI 提示 tools 不稳定，后续聊天不加载工具定义。
- 用户发送"计算 17 * 23" 且当前模型支持 tools → SSE 中出现 `calculator` 工具调用与结果 → Agent 最终回答 `391`。
- 用户发送"查看当前时间" 且当前模型支持 tools → SSE 中出现 `current_time` 工具调用与结果 → Agent 最终回答包含可读时间。
- 用户选择不支持或不稳定 tools 的模型 → Chat 路由不传入工具定义，UI 显示纯文本模式提示。
- 用户触发未知工具、非法参数或工具执行失败 → SSE 返回可见 `error` 或 `tool_result.isError=true`，UI 不静默失败。
- 工具调用后的 assistant 文本、assistant tool_use、user tool_result 能进入会话历史，刷新或切换会话后上下文不丢失。

---

## 二、前置阅读

| 文档 | 必读章节 | 内容 |
|------|---------|------|
| [工具系统架构](../../architecture/tool-system.md) | 全部，尤其 §5 | Phase 3 的架构唯一来源：协议分层、模型能力探测与缓存、Tool Registry、Provider 映射、Agent Loop 工具循环 |
| [LLM 集成层](../../architecture/llm-integration.md) | §4.2-§6.2 | Anthropic tool_use 事件、增量 JSON、Provider 接口、模型能力与推理调用分离 |
| [数据流](../../architecture/data-flow.md) | §3 工具调用流、状态变迁 | 工具调用端到端事件序列与前端状态 |
| [Ollama API 参考](../../references/ollama-api.md) | §1-§3 | `/api/chat`、`/api/tags`、`/api/show` 的外部格式 |
| [协议定义](../../../app/protocol/index.md) | 工具协议、模型能力协议、SSE 事件类型、消息内容块 | 前后端共享协议 |
| [项目结构](../../architecture/project-structure.md) | `@myagent/service`、`@myagent/web` | 新增 agent、tools、组件文件的放置边界 |
| [Phase 2](../phase-02/index.md) | Phase 2 复盘补充场景 | 会话初始化、模型选择、旧会话残留和流式时序回归 |

---

## 三、协议状态/变更

协议唯一来源是 `app/protocol/src/`。Phase 3 使用或新增以下协议文件：

| 文件 | 状态 | 用途 | 详情 |
|------|------|------|------|
| `app/protocol/src/tool.ts` | 已存在 | 工具定义、工具调用、工具结果、JSON Schema 参数子集 | [工具协议](../../../app/protocol/index.md#工具协议) |
| `app/protocol/src/message.ts` | 已存在 | `tool_use` / `tool_result` 内容块，用于持久化上下文 | [文件职责](../../../app/protocol/index.md#文件职责) |
| `app/protocol/src/stream-event.ts` | 已存在 | `tool_call_start`、`tool_call_delta`、`tool_result` SSE 事件 | [SSE 事件类型](../../../app/protocol/index.md#sse-事件类型) |
| `app/protocol/src/model.ts` | 更新 | 模型身份指纹、tools 支持状态、能力探测请求/响应 | [模型能力协议](../../../app/protocol/index.md#模型能力协议) |

实现要求：

1. 修改协议后必须运行 `./app/codegen.sh build`。
2. Phase 文档不得复制完整 Schema 字段，必须链接到 `app/protocol/index.md` 或源文件。
3. 服务端运行时工具接口（含 `execute` 函数）不进入 protocol，放在 `app/service/src/tools/`。
4. 数据库缓存表结构不进入 protocol，但 API 返回必须映射到 `ModelCapabilities`。

---

## 四、API 端点变更

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/providers` | 保持现有 Provider 可用性查询 |
| `GET` | `/api/models?provider=ollama` | 返回模型列表，并尽量携带 Ollama 可获得的身份元数据 |
| `GET` | `/api/model-capabilities?provider=ollama&model=...` | 查询模型能力；优先返回有效缓存，不触发昂贵运行时探测 |
| `POST` | `/api/model-capabilities/probe` | 手动刷新模型能力；绕过缓存并执行静态分析/运行时探测 |
| `POST` | `/api/session/:id/chat` | 根据当前会话模型能力决定是否传入工具定义 |

能力探测 API 使用 `ModelCapabilityProbeRequestSchema` 和 `ModelCapabilityResponseSchema`。缓存、过期、失效和并发策略见 [工具系统架构 §5](../../architecture/tool-system.md#5-模型能力探测与缓存)。

---

## 五、服务端模块清单（按依赖顺序）

### 模块 1：服务端内部工具类型

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/tools/types.ts` | 新建 | 定义运行时工具执行器、执行上下文和结果转换 |

关键函数/接口签名：

```typescript
interface ToolExecutor {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

function toToolDefinition(tool: ToolExecutor): ToolDefinition;
```

### 模块 2：Tool Registry

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/tools/registry.ts` | 新建 | 注册、查找、导出工具定义 |

关键函数签名：

```typescript
function createToolRegistry(tools: ToolExecutor[]): ToolRegistry;
```

### 模块 3：内置工具

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/tools/built-in/calculator.ts` | 新建 | 安全计算器工具 |
| `app/service/src/tools/built-in/current-time.ts` | 新建 | 当前时间工具 |
| `app/service/src/tools/built-in/index.ts` | 新建 | 导出内置工具集合 |

关键函数签名：

```typescript
function createBuiltInTools(options?: { clock?: () => Date }): ToolExecutor[];
```

### 模块 4：模型身份读取与能力缓存

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/db/schema.ts` | 更新 | 新增模型能力缓存表 |
| `app/service/src/db/migrate.ts` | 更新 | 增量创建缓存表 |
| `app/service/src/models/capability-cache.ts` | 新建 | 读写模型能力缓存，按身份指纹判断有效性 |
| `app/service/src/llm/providers/ollama/client.ts` | 更新 | 增加模型详情读取能力，供身份指纹与静态分析使用 |

关键函数签名：

```typescript
function getCachedModelCapabilities(identity: ModelIdentity): Promise<ModelCapabilities | null>;
function saveModelCapabilities(capabilities: ModelCapabilities): Promise<void>;
function isModelCapabilityCacheValid(cached: ModelCapabilities, current: ModelIdentity): boolean;
```

数据库缓存建议见 [工具系统架构 §5.4](../../architecture/tool-system.md#54-数据库缓存)。

### 模块 5：模型能力探测服务

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/models/capability-probe.ts` | 新建 | 编排静态身份、静态分析、运行时探测、结果归一化 |

关键函数签名：

```typescript
function getModelCapabilities(input: ModelCapabilityProbeRequest): Promise<ModelCapabilityResponse>;
function probeModelCapabilities(input: ModelCapabilityProbeRequest): Promise<ModelCapabilityResponse>;
```

探测服务必须区分 `unsupported`、`unstable` 和 `error`，不得因为文本中出现工具意图就伪造工具调用。

### 模块 6：Provider 工具定义映射

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/llm/types/provider.ts` | 更新 | `LLMStreamParams` 增加 `tools?: ToolDefinition[]` |
| `app/service/src/llm/providers/anthropic/client.ts` | 更新 | 将 `ToolDefinition[]` 映射为 Anthropic `tools` 请求字段 |
| `app/service/src/llm/providers/ollama/client.ts` | 更新 | 将 `ToolDefinition[]` 映射为 Ollama OpenAI 风格 `tools` 字段 |

Provider 差异见 [工具系统架构 §4](../../architecture/tool-system.md#4-provider-工具映射)。

### 模块 7：工具调用解析

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/llm/providers/anthropic/stream-parser.ts` | 更新 | 将 `tool_use` 和 `input_json_delta` 映射为内部归一化事件 |
| `app/service/src/llm/providers/ollama/stream-parser.ts` | 更新 | 识别 Ollama `message.tool_calls`，映射为工具调用事件 |

关键要求：Ollama 返回文本工具意图但无 `tool_calls` 时，只记录不稳定信号，不生成工具事件。

### 模块 8：Agent Loop

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/agent/loop.ts` | 新建 | 编排 LLM 调用、工具执行、结果回填、循环终止 |

关键函数签名：

```typescript
function runAgentLoop(params: AgentLoopParams): Promise<AgentLoopResult>;
```

默认 `maxIterations = 5`。详细循环见 [工具系统架构 §6](../../architecture/tool-system.md#6-agent-loop-工具循环)。

### 模块 9：Provider/Model 路由接入

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/routes/provider.ts` | 更新 | 暴露模型能力查询与手动探测端点 |

关键要求：能力查询优先返回缓存；手动探测需要绕过缓存；边界层必须 catch 并返回协议错误。

### 模块 10：Chat 路由接入

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/routes/chat.ts` | 更新 | 使用 Phase 2 的上下文构建器作为输入，按模型能力加载工具，持久化工具相关消息 |
| `app/service/src/relay/sse-relay.ts` | 更新/复核 | 确认工具事件 relay 到客户端协议 |

关键要求：进入 Agent Loop 前查询当前 session 的 provider/model 和能力缓存；只有 `supported` 才传入工具定义。

---

## 六、前端组件清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/web/src/api/client.ts` | 更新 | 增加模型能力查询与手动探测 API |
| `app/web/src/components/chat/ModelCapabilityBadge.tsx` | 新建 | 展示 tools 支持状态、错误摘要和刷新入口 |
| `app/web/src/components/chat/ModelSelector.tsx` | 更新 | 模型选择后加载能力状态，并传给能力展示组件 |
| `app/web/src/components/chat/ToolCallBlock.tsx` | 新建 | 展示工具名、参数增量、执行状态、结果或错误 |
| `app/web/src/hooks/useChat.ts` | 更新 | 处理工具 SSE 事件和能力禁用提示 |
| `app/web/src/components/chat/MessageBubble.tsx` | 更新 | 渲染文本块与工具块 |
| `app/web/src/components/chat/StreamingMessage.tsx` | 更新 | 流式过程中显示当前文本与工具状态 |
| `app/web/src/components/chat/ChatInput.tsx` | 更新 | `streaming/tool_executing` 期间禁用提交并保留草稿 |

Props 接口：

```typescript
interface ModelCapabilityBadgeProps {
  capabilities: ModelCapabilities | null;
  loading: boolean;
  onProbe: () => void;
  disabled?: boolean;
}

interface ToolCallBlockProps {
  toolName: string;
  inputPreview?: string;
  result?: string;
  isError?: boolean;
  state: "streaming" | "executing" | "completed" | "error";
}
```

UI 状态规则见 [工具系统架构 §5.6](../../architecture/tool-system.md#56-前端展示模型能力) 和 [§8](../../architecture/tool-system.md#8-前端展示模型)。

---

## 七、文件清单

| # | 文件 | 新建/更新 |
|---|------|----------|
| 1 | `doc/architecture/tool-system.md` | 更新 |
| 2 | `doc/architecture/llm-integration.md` | 更新 |
| 3 | `doc/architecture/index.md` | 更新 |
| 4 | `doc/references/ollama-api.md` | 更新 |
| 5 | `doc/phases/phase-03/index.md` | 更新 |
| 6 | `app/protocol/src/model.ts` | 更新 |
| 7 | `app/protocol/index.md` | 更新 |
| 8 | `app/service/src/db/schema.ts` | 更新 |
| 9 | `app/service/src/db/migrate.ts` | 更新 |
| 10 | `app/service/src/models/capability-cache.ts` | 新建 |
| 11 | `app/service/src/models/capability-probe.ts` | 新建 |
| 12 | `app/service/src/tools/types.ts` | 新建 |
| 13 | `app/service/src/tools/registry.ts` | 新建 |
| 14 | `app/service/src/tools/built-in/calculator.ts` | 新建 |
| 15 | `app/service/src/tools/built-in/current-time.ts` | 新建 |
| 16 | `app/service/src/tools/built-in/index.ts` | 新建 |
| 17 | `app/service/src/llm/types/provider.ts` | 更新 |
| 18 | `app/service/src/llm/providers/anthropic/client.ts` | 更新 |
| 19 | `app/service/src/llm/providers/anthropic/stream-parser.ts` | 更新 |
| 20 | `app/service/src/llm/providers/ollama/client.ts` | 更新 |
| 21 | `app/service/src/llm/providers/ollama/stream-parser.ts` | 更新 |
| 22 | `app/service/src/agent/loop.ts` | 新建 |
| 23 | `app/service/src/routes/provider.ts` | 更新 |
| 24 | `app/service/src/routes/chat.ts` | 更新 |
| 25 | `app/service/src/relay/sse-relay.ts` | 更新/复核 |
| 26 | `app/web/src/api/client.ts` | 更新 |
| 27 | `app/web/src/components/chat/ModelCapabilityBadge.tsx` | 新建 |
| 28 | `app/web/src/components/chat/ModelSelector.tsx` | 更新 |
| 29 | `app/web/src/components/chat/ToolCallBlock.tsx` | 新建 |
| 30 | `app/web/src/hooks/useChat.ts` | 更新 |
| 31 | `app/web/src/components/chat/MessageBubble.tsx` | 更新 |
| 32 | `app/web/src/components/chat/StreamingMessage.tsx` | 更新 |
| 33 | `app/web/src/components/chat/ChatInput.tsx` | 更新 |

---

## 八、测试场景清单

### 主流程

1. 模型能力缓存命中 → 选择已探测且身份指纹未变化的 Ollama 模型 → UI 立即显示 tools 支持状态，服务端不发起新的运行时探测。
2. 手动探测支持 tools 的模型 → 选择模型后点击探测 → 服务端返回 `supported`，UI 显示 tools 可用，随后发送"计算 17 * 23"能看到工具调用和最终 `391`。
3. 当前时间工具闭环 → 在 tools 支持模型下发送"查看当前时间" → UI 展示 `current_time` 工具调用和结果，最终回答包含可读时间。
4. 多轮上下文 + 工具结果 → 先发送"我叫小明"，再发送"用计算器算 8 * 9，然后说出我的名字" → 最终回答同时包含 `72` 和"小明"，工具内容块刷新后仍在。

### 边界用例

1. 空输入/null/undefined → 前端不发送空白消息；服务端非法请求返回协议错误，不创建工具调用或能力探测记录。
2. 超限输入长度/探测频率 → 聊天内容超过协议上限或连续快速点击探测 → 服务端返回可见错误或复用进行中的探测，不写入多条冲突缓存。
3. 异常：Ollama 网络断开 → 查询模型能力或聊天时返回可见错误，UI 停止 loading，不能把 `error` 当作 `unsupported` 缓存 7 天。
4. 异常：模型不存在 → 数据库旧会话保存过期 model → 服务端返回可见错误，不回退到硬编码模型。
5. 异常：文本工具意图但无 tool_calls → Mock Ollama 返回"我应该调用 current_time"但没有 `message.tool_calls` → 日志出现 `Tool intent detected without actual tool call`，能力状态为 `unstable`，后续聊天不加载 tools。
6. 时序：模型选择器未加载时创建会话 → 首次打开页面并延迟 `/api/models` 响应，立即触发新建会话 → 不使用 `"llama3.2"` 等硬编码 fallback；等待真实模型或显示可操作错误。
7. 时序：首次加载完整链路 → 清空本地会话后刷新页面，观察 Provider 列表加载、模型列表加载、能力状态查询、会话创建、消息输入可用 → 创建请求中的 provider/model 必须来自已加载列表。
8. 持久化：重启后能力缓存仍在 → 完成一次 supported 探测后重启服务 → 选择同一身份指纹模型直接显示缓存结果，不重新探测。
9. 持久化：旧会话数据残留 → 数据库中保留旧 provider/model 的会话后重启 → 切换旧会话时使用该会话保存的模型；模型身份变化时能力缓存失效。
10. 并发：同一模型快速连续探测 → 多次点击探测按钮 → 同一模型身份只运行一次探测，其余请求显示 `probing` 或返回同一结果。
11. 并发：切换会话时工具流未结束 → A 会话正在工具调用时切换到 B → A 的后续 `tool_result` 不得追加到 B。
12. 工具循环超限 → Mock Provider 连续返回 `tool_use` 超过 `maxIterations` → Agent Loop 停止并发送可见终止原因。
13. 未知工具名 → Provider 返回未注册工具 → Agent Loop 返回可见工具错误，不抛出未捕获异常。

### 自动化检查

```
代码质量
- [ ] ./app/codegen.sh build 通过
- [ ] pnpm run lint 通过
- [ ] pnpm run typecheck 通过
- [ ] pnpm run test 通过

重点单元测试
- [ ] Model capability cache：身份匹配、digest 变化失效、TTL 过期、手动刷新绕过缓存
- [ ] Model capability probe：supported、unsupported、unstable、error 四类结果
- [ ] ToolRegistry：注册、查找、重复名称、非法名称
- [ ] calculator：正常四则运算、非法表达式、禁止任意代码执行
- [ ] current_time：固定 clock 下输出稳定
- [ ] Anthropic parser：tool_use start、input_json_delta、stop_reason=tool_use
- [ ] Ollama parser：message.tool_calls、纯文本工具意图但无 tool_calls
- [ ] Agent Loop：纯文本、单工具调用、参数 JSON 错误、未知工具、maxIterations
```

---

## 九、相关文档索引

| 主题 | 文档 |
|------|------|
| 工具系统全景 | [tool-system.md](../../architecture/tool-system.md) |
| 模型能力探测与缓存 | [tool-system.md §5](../../architecture/tool-system.md#5-模型能力探测与缓存) |
| Provider 工具映射 | [tool-system.md §4](../../architecture/tool-system.md#4-provider-工具映射) |
| Agent Loop 工具循环 | [tool-system.md §6](../../architecture/tool-system.md#6-agent-loop-工具循环) |
| 前端工具展示 | [tool-system.md §8](../../architecture/tool-system.md#8-前端展示模型) |
| LLM Provider 接口 | [llm-integration.md §6](../../architecture/llm-integration.md#6-provider-接口) |
| Ollama API | [ollama-api.md](../../references/ollama-api.md) |
| 协议定义 | [protocol/index.md](../../../app/protocol/index.md) |
