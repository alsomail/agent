# Phase 3：工具/能力插件系统

> 状态：🚧 当前实现
> 前置依赖：Phase 1（已完成 ✅）、Phase 2（已完成 ✅）
> 预计工作量：4-5 天

---

## 一、目标与验收标准

让 Agent 从"只能聊天"升级为"可以调用工具完成任务"。Phase 3 聚焦手写 Tool Call 的完整闭环：Provider 解析工具调用 → Agent Loop 执行工具 → 将工具结果回填给 LLM → 前端展示工具过程。

验收标准：

- 用户发送"计算 17 * 23" → SSE 中出现 `calculator` 工具调用与结果 → Agent 最终回答 `391`。
- 用户发送"查看当前时间" → SSE 中出现 `current_time` 工具调用与结果 → Agent 最终回答包含可读时间。
- 用户触发未知工具、非法参数或工具执行失败 → SSE 返回可见 `error` 或 `tool_result.isError=true`，UI 不静默失败。
- 用户诱导模型连续调用工具 → 同一轮对话最多执行 `maxIterations` 次，并返回可见终止原因。
- 工具调用后的 assistant 文本、assistant tool_use、user tool_result 能进入会话历史，刷新或切换会话后上下文不丢失。

---

## 二、前置阅读

| 文档 | 必读章节 | 内容 |
|------|---------|------|
| [工具系统架构](../../architecture/tool-system.md) | 全部 | Phase 3 的架构唯一来源：协议分层、Tool Registry、Provider 映射、Agent Loop 工具循环 |
| [LLM 集成层](../../architecture/llm-integration.md) | §4.2-§6 | Anthropic tool_use 事件、增量 JSON、Agent Loop 状态机、Provider 接口 |
| [数据流](../../architecture/data-flow.md) | §3 工具调用流、状态变迁 | 工具调用端到端事件序列与前端状态 |
| [协议定义](../../../app/protocol/index.md) | 工具协议、SSE 事件类型、消息内容块 | 前后端共享的工具协议与消息协议 |
| [项目结构](../../architecture/project-structure.md) | `@myagent/service`、`@myagent/web` | 新增 agent、tools、组件文件的放置边界 |
| [Phase 2](../phase-02/index.md) | 相关文档索引、验证清单 | 会话持久化、上下文构建器和历史消息恢复 |

---

## 三、协议状态

工具协议必须以 `app/protocol/src/` 为唯一来源。

Phase 3 需要的协议已经落在：

| 文件 | 用途 | 详情 |
|------|------|------|
| `app/protocol/src/tool.ts` | 工具定义、工具调用、工具结果、JSON Schema 参数子集 | [协议文档：工具协议](../../../app/protocol/index.md#工具协议) |
| `app/protocol/src/message.ts` | `tool_use` / `tool_result` 内容块，用于持久化上下文 | [协议文档：文件职责](../../../app/protocol/index.md#文件职责) |
| `app/protocol/src/stream-event.ts` | `tool_call_start`、`tool_call_delta`、`tool_result` SSE 事件 | [协议文档：SSE 事件类型](../../../app/protocol/index.md#sse-事件类型) |

实现要求：

1. 修改协议后必须运行 `./app/codegen.sh build`。
2. Phase 文档不得复制完整 Schema 字段，必须链接到 `app/protocol/index.md` 或源文件。
3. 服务端运行时工具接口（含 `execute` 函数）不进入 protocol，放在 `app/service/src/tools/`。

---

## 四、服务端实现清单

### 模块 1：服务端内部工具类型

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/tools/types.ts` | 新建 | 定义 `ToolExecutor`、`ToolExecutionContext`、`ToolExecutionResult`，并提供运行时工具到 protocol 工具定义的转换 |

实现要点：

- `execute` 函数只能存在于 service 内部。
- `inputSchema` 使用 `ToolInputSchema`，不要另起一套协议。
- `ToolExecutionContext` 至少包含 `sessionId` 和 `signal?: AbortSignal`。

### 模块 2：Tool Registry

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/tools/registry.ts` | 新建 | 注册、查找、导出工具定义 |

实现要点：

- 工具名必须符合 protocol 中的 `ToolNameSchema`。
- 重复工具名创建 registry 时直接失败。
- `definitions()` 返回 `ToolDefinition[]`，供 Provider 请求体映射。

### 模块 3：内置工具

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/tools/built-in/calculator.ts` | 新建 | 安全计算器工具 |
| `app/service/src/tools/built-in/current-time.ts` | 新建 | 当前时间工具 |
| `app/service/src/tools/built-in/index.ts` | 新建 | 导出 `createBuiltInTools()` |

实现要点：

- `calculator` 使用结构化输入，不执行任意 JS 表达式。
- `current_time` 支持注入 `clock?: () => Date`，方便测试稳定。

### 模块 4：Provider 工具定义映射

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/llm/types/provider.ts` | 更新 | `LLMStreamParams` 增加 `tools?: ToolDefinition[]` |
| `app/service/src/llm/providers/anthropic/client.ts` | 更新 | 将 `ToolDefinition[]` 映射为 Anthropic `tools` 请求字段 |
| `app/service/src/llm/providers/ollama/client.ts` | 更新 | 明确 Ollama 工具能力的支持/降级行为 |

Provider 差异见 [工具系统架构 §4 Provider 工具映射](../../architecture/tool-system.md#4-provider-工具映射)。

### 模块 5：工具调用解析

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/llm/providers/anthropic/stream-parser.ts` | 更新 | 将 `tool_use` 和 `input_json_delta` 映射为内部 `NormalizedStreamEvent` |
| `app/service/src/llm/providers/ollama/stream-parser.ts` | 更新 | 识别 Ollama `message.tool_calls`，映射为工具调用事件 |

实现要点：

- Anthropic 参数是增量 JSON，必须按 `content_block.index` 收集。
- Ollama 通常一次性返回完整 `tool_calls`，不要假设它有 Anthropic 式增量事件。

### 模块 6：Agent Loop

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/agent/loop.ts` | 新建 | 编排 LLM 调用、工具执行、结果回填、循环终止 |

实现要点：

- 默认 `maxIterations = 5`。
- 收集 assistant 文本块、tool_use 块、工具参数。
- 工具结果以 `tool_result` 事件推给前端。
- assistant `tool_use` 和 user `tool_result` 必须进入持久化消息历史。
- 更新消息数组必须创建新数组/新对象。

详细循环见 [工具系统架构 §5 Agent Loop 工具循环](../../architecture/tool-system.md#5-agent-loop-工具循环)。

### 模块 7：Chat 路由接入

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/service/src/routes/chat.ts` | 更新 | 使用 Phase 2 的上下文构建器作为输入，调用 Agent Loop，持久化工具相关消息 |
| `app/service/src/relay/sse-relay.ts` | 更新/复核 | 确认工具事件 relay 到客户端协议 |

实现要点：

- 请求体仍使用 `SendMessageRequestSchema`。
- 进入 Agent Loop 前，从 Tool Registry 读取工具定义。
- 流结束后持久化完整 assistant 文本和工具内容块。

---

## 五、前端实现清单

| 文件 | 操作 | 职责 |
|------|------|------|
| `app/web/src/components/chat/ToolCallBlock.tsx` | 新建 | 展示工具名、参数增量、执行状态、结果或错误 |
| `app/web/src/hooks/useChat.ts` | 更新 | 处理 `tool_call_start`、`tool_call_delta`、`tool_result`、`state_change: tool_executing` |
| `app/web/src/components/chat/MessageBubble.tsx` | 更新 | 渲染文本块与工具块 |
| `app/web/src/components/chat/StreamingMessage.tsx` | 更新 | 流式过程中显示当前文本与工具状态 |
| `app/web/src/components/chat/ChatInput.tsx` | 更新 | `streaming/tool_executing` 期间禁用提交并保留草稿 |

前端展示规则见 [工具系统架构 §7 前端展示模型](../../architecture/tool-system.md#7-前端展示模型)。

---

## 六、测试场景清单

### 主流程

1. 计算器工具闭环 → 发送"计算 17 * 23" → UI 依次出现工具调用、工具结果，最终回答包含 `391`。
2. 当前时间工具闭环 → 发送"查看当前时间" → UI 展示 `current_time` 工具调用和结果，最终回答包含可读时间。
3. 多轮上下文 + 工具结果 → 先发送"我叫小明"，再发送"用计算器算 8 * 9，然后说出我的名字" → 最终回答同时包含 `72` 和"小明"。
4. 工具执行失败可见 → 触发非法计算参数 → UI 展示工具错误状态，SSE 不提前断流。

### 边界用例

1. 空输入/null/undefined → 前端不发送空白消息；服务端非法请求返回协议错误，不创建工具调用。
2. 超限输入长度 → 服务端返回校验错误；历史不写入半条消息。
3. 工具循环超限 → Mock Provider 连续返回 `tool_use` 超过 `maxIterations` → Agent Loop 停止并发送可见终止原因。
4. 模型不存在 → 数据库旧会话保存过期 model → 服务端返回可见错误，不回退到硬编码模型。
5. Provider/API 网络中断 → SSE 发送 `state_change:error` 和 `error`，UI 停止 loading。
6. 未知工具名 → Agent Loop 返回可见工具错误，不抛出未捕获异常。
7. 模型选择器未加载时创建会话 → 不使用 `"llama3.2"` 等硬编码 fallback；等待真实模型或显示错误。
8. 切换会话时工具流未结束 → A 会话后续 `tool_result` 不得追加到 B。
9. 重启后工具内容块仍在 → 完成工具调用后重启服务，刷新页面能恢复工具相关历史。
10. 同一会话双请求 → 拒绝第二个请求或串行化处理，消息顺序和工具结果不交叉。

### 自动化检查

```
代码质量
- [ ] ./app/codegen.sh build 通过
- [ ] pnpm run lint 通过
- [ ] pnpm run typecheck 通过
- [ ] pnpm run test 通过

重点单元测试
- [ ] ToolRegistry：注册、查找、重复名称、非法名称
- [ ] calculator：正常四则运算、非法表达式、禁止任意代码执行
- [ ] current_time：固定 clock 下输出稳定
- [ ] Anthropic parser：tool_use start、input_json_delta、stop_reason=tool_use
- [ ] Agent Loop：纯文本、单工具调用、参数 JSON 错误、未知工具、maxIterations
```

