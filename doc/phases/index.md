# Agent 学习与实现阶段

## 阶段总览

| 阶段 | 名称 | 状态 | 核心交付物 |
|------|------|------|----------|
| Phase 1 | 最小 Agent 循环 | ✅ 已完成 | 单轮 LLM SSE 流式响应 + Ollama 集成 |
| Phase 2 | 对话记忆与上下文管理 | ✅ 已完成 | 多轮上下文、SQLite 持久化、Running Summary、会话管理 UI |
| Phase 3 | 工具/能力插件系统 | 🚧 当前实现 | Tool Registry、Agent 循环扩展、内置工具 |
| Phase 4 | 工作记忆 + 高级记忆 | ⬜ 规划中 | L4 Scratchpad、L5 跨会话记忆、L6 长期记忆 |
| Phase 5 | 重试策略与护栏 | ⬜ 规划中 | 指数退避、多层校验 |
| Phase 6 | 自我校验器 | ⬜ 规划中 | 响应验证、置信度评分 |
| Phase 7 | 计划生成与修正 | ⬜ 规划中 | ReAct 模式、任务分解 |
| Phase 8 | 多步骤任务编排 | ⬜ 规划中 | DAG 调度、并行执行 |
| Phase 9 | 可观测性 | ⬜ 规划中 | 日志/指标/链路 |
| Phase 10 | 生产强化 | ⬜ 规划中 | 持久化、认证、Docker |

## 设计原则

1. **手写核心层**：不使用 AI SDK、LangChain 等黑盒封装
2. **渐进复杂度**：每个阶段在前一阶段基础上构建
3. **可运行交付**：每个阶段结束后有可运行、可演示的系统
4. **文档驱动**：每个阶段先写设计文档，再编码实现

## 当前进度

- ✅ Step 0：项目脚手架搭建
- ✅ Phase 1：最小 Agent 循环（已完成）
  - ✅ 手写 Anthropic SSE 流解析器
  - ✅ 手写 Ollama NDJSON 流解析器
  - ✅ LLMProvider 接口 + Strategy/Factory 模式
  - ✅ SSE 中继层（内部事件 → 客户端 StreamEvent）
  - ✅ Provider/Model 选择 UI
  - ✅ 端到端流式响应（fetch + ReadableStream）
- ✅ Phase 2：对话记忆与上下文管理（已完成）
  - ✅ SQLite 会话与消息持久化
  - ✅ Token 估算与上下文窗口构建
  - ✅ Running Summary 压缩器
  - ✅ 会话列表、切换、删除 UI
  - ✅ 会话恢复与多轮上下文验证
- 🚧 Phase 3：工具/能力插件系统（当前实现）
  - 🔜 Tool Registry 与工具执行器接口
  - 🔜 模型能力探测、缓存与 tools 加载策略
  - 🔜 Anthropic tool_use 增量解析与 Agent Loop
  - 🔜 内置工具与工具调用 UI
  - 🔜 工具调用单元测试与端到端验证

## 下一步

- Phase 3：工具/能力插件系统
  - 先补齐 `@myagent/protocol` 的可序列化工具契约和模型能力契约，并运行 `./app/codegen.sh build`
  - 再实现模型能力缓存/探测、服务端内部工具类型、Tool Registry、Agent Loop 与 Provider 工具映射
  - 最后接入前端能力提示和工具调用展示，并按 Phase 3 场景清单完成端到端验证
