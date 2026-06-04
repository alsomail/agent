# 架构文档

本目录记录 MyAgent 项目的技术架构决策，包括选型理由、项目结构、数据流设计。

## 文档索引

| 文件 | 内容 |
|------|------|
| [tech-stack.md](./tech-stack.md) | 技术选型与对比分析 |
| [project-structure.md](./project-structure.md) | 项目结构与模块职责 |
| [data-flow.md](./data-flow.md) | 端到端数据流设计 |
| [llm-integration.md](./llm-integration.md) | 手写 LLM 集成层架构 |

## 设计原则

1. **手写核心层** — 不使用 AI SDK、LangChain 等封装库，亲手实现 LLM 调用、流解析、Tool Call
2. **渐进复杂度** — 从最小循环开始，每个阶段只增加一个核心能力
3. **协议优先** — 前后端通过 Zod Schema 共享类型，Protocol 包是唯一真相源
4. **不可变数据** — 所有状态更新返回新对象，不就地修改
