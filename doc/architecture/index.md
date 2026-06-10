# 架构文档

本目录记录 MyAgent 项目的技术架构决策，包括选型理由、项目结构、数据流设计。

## 文档索引

| 文件 | 内容 |
|------|------|
| [tech-stack.md](./tech-stack.md) | 技术选型与对比分析 |
| [project-structure.md](./project-structure.md) | 项目结构与模块职责 |
| [data-flow.md](./data-flow.md) | 端到端数据流设计 |
| [llm-integration.md](./llm-integration.md) | 手写 LLM 集成层架构 |
| [memory-system.md](./memory-system.md) | Agent 记忆体系（6 层架构、上下文管理、压缩、持久化） |
| [tool-system.md](./tool-system.md) | 工具/能力插件系统架构（协议分层、Tool Registry、Agent Loop 工具循环） |

## 设计原则

1. **手写核心层** — 不使用 AI SDK、LangChain 等封装库，亲手实现 LLM 调用、流解析、Tool Call
2. **渐进复杂度** — 从最小循环开始，每个阶段只增加一个核心能力
3. **协议优先** — 前后端通过 Zod Schema 共享类型，Protocol 包是唯一真相源
4. **不可变数据** — 所有状态更新返回新对象，不就地修改
5. **文档唯一性** — 同一设计细节只存在于一处，其余通过相对链接 + 章节锚点索引。本目录是架构设计的唯一来源
