# MyAgent 项目文档

## 项目背景

MyAgent 是一个以学习为核心目的的 AI Agent 项目，采用 "Web 前端 + 服务端 Runtime" 架构。
项目从最小 Agent 循环开始，手写所有 LLM 集成层（流式解析、Tool Call、Agent Loop），
逐阶段演进到生产级别。

核心原则：**理解原理，手写每一层，不做"能用就行"的黑盒封装。**

## 技术栈

- 前端：React 19 + Vite 6
- 后端：Hono 4 + Node.js 22
- 协议：Zod Schemas 工作区共享
- LLM：手写 HTTP 客户端 + SSE 流解析（当前 Ollama/Anthropic，OpenAI 作为后续扩展槽）
- 工具链：Biome（lint/format）、lefthook（pre-commit）、Vitest（test）

### 文档索引

| 目录/文件 | 说明 |
|-----------|------|
| [phases/](./phases/index.md) | 分阶段学习与实现路径（10 个阶段） |
| [architecture/](./architecture/index.md) | 架构设计（技术选型、结构、数据流、LLM 层） |
| [guides/](./guides/index.md) | 运行指南与账号信息 |
| [references/](./references/index.md) | 外部 API 参考文档（Anthropic 等） |
| [../app/protocol/index.md](../app/protocol/index.md) | 前后端协议定义 |

### 快速开始

```bash
# 安装依赖
pnpm install

# 配置 API 密钥
cp .env.example .env
# 编辑 .env 填入你的 API Key

# 一键启动
./app/dev.sh
```
