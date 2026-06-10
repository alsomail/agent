# AGENTS.md - MyAgent 项目行为规范

## 项目概述

MyAgent 是一个以学习为核心目的的 AI Agent 项目。手写所有 LLM 集成层，
不使用 Vercel AI SDK、LangChain 等黑盒封装。

## Codex 子智能体派发约定

- 项目级子智能体定义放在 `.codex/agents/*.toml`。
- 每个可派发的子智能体 TOML 文件必须显式保留默认 `model` 与
  `model_reasoning_effort`。虽然 Codex 官方文档说明省略 `model` 时应继承主窗口
  model，但当前 Codex Desktop 的派发链路会先做 service tier validation；如果
  agent 文件里没有可解析的默认 `model`，可能在派发前失败：
  `spawn_agent could not resolve the child model for service tier validation`。
- 主窗口派发子智能体时，可以在 `spawn_agent` 调用中显式传入 `model` 覆盖 agent
  文件里的默认模型。例如 `phase-tester` 文件内默认 `model = "gpt-5.4"`，派发时传
  `model: "gpt-5.5"` 可以让该次任务使用 `gpt-5.5` 执行。
- 推荐实践：agent 文件里写稳定默认模型，具体任务需要更强或更便宜模型时，再由主窗口
  在派发参数中显式覆盖；不要为了依赖继承而删除 agent 文件中的 `model`。

## 代码规范（强制执行）

### 1. 编辑后必须检查
修改任何 `.ts`/`.tsx` 文件后，必须运行：
```bash
pnpm run lint        # Biome 检查 (lint + format)
pnpm run typecheck   # TypeScript 类型检查
```

### 2. 不可变模式（CRITICAL）
始终创建新对象，永远不要修改现有对象：
```typescript
// ❌ 错误
obj.field = newValue;

// ✅ 正确
const newObj = { ...obj, field: newValue };
```

### 3. 文件大小限制
- 单文件 ≤ 400 行（推荐）
- 硬上限 800 行
- 超过硬上限必须拆分模块

### 4. 错误处理
async 函数必须在合适的层级处理错误，不允许静默吞掉：
```typescript
// ❌ 错误：错误被静默吞掉
try {
  const result = await doSomething();
} catch { /* 什么都不做 */ }

// ✅ 正确（边界层）：在路由/入口处 catch 并返回有意义的错误
try {
  const result = await doSomething();
} catch (err) {
  console.error("[Module] 操作失败:", err);
  return c.json({ error: "操作失败" }, 500);
}

// ✅ 也正确（内部层）：不 catch，让错误冒泡到上层统一处理
const result = await doSomething(); // 调用方负责 catch
```
原则：**边界层（路由、入口）必须 catch；内部函数可以让错误冒泡**。

### 5. 协议优先
任何新的 API 端点或跨端数据结构，必须先在 `app/protocol/src/` 中定义 Zod schema：
1. 在 protocol 中定义 schema
2. 导出类型
3. 服务端用 `zValidator` 校验
4. 前端导入类型使用

### 6. 测试要求
- 新的公共函数必须编写测试
- 使用 Vitest，AAA 模式（Arrange-Act-Assert）
- 覆盖率目标：80%+

### 7. 全局检查
- [ ] `pnpm run lint` 通过
- [ ] `pnpm run typecheck` 通过
- [ ] 无硬编码密钥（.env 管理）
- [ ] 无 console.log 残留（使用结构化日志）
- [ ] 按功能/领域组织文件，非按类型
- [ ] 函数 ≤ 50 行
- [ ] 嵌套 ≤ 4 层
- [ ] 早返回优于深层嵌套

### 8. ESM import 路径
TypeScript ESM 模式下，相对导入必须带 `.js` 后缀：
```typescript
// ❌ 错误
import { foo } from "./utils";

// ✅ 正确
import { foo } from "./utils.js";
```

### 9. 环境变量
- 所有密钥通过 `.env` 文件管理，启动时校验必需变量是否存在
- 不要在代码中硬编码默认 API Key
- 新增环境变量时同步更新 `.env.example`

### 10. 新文件放置指引
- 新 API 端点 → `app/service/src/routes/`
- LLM 相关 → `app/service/src/llm/`（types/ 或 providers/）
- Agent 逻辑 → `app/service/src/agent/`
- 工具定义 → `app/service/src/tools/built-in/`
- React 组件 → `app/web/src/components/{功能}/`
- React Hook → `app/web/src/hooks/`
- 共享类型 → `app/protocol/src/`

### 11. 文档同步
新增功能时必须更新对应的 Phase 文档（`doc/phases/`），标记完成项。

## 项目结构与目录职责

### app/ — 源码目录

| 目录 | 作用 | 关键规则 |
|------|------|---------|
| `app/protocol/src/` | 前后端共享的 Zod Schemas，是数据契约的**唯一真相源** | 新增 API 端点必须先在此定义 Schema；两端都从这里 import 类型 |
| `app/service/src/` | Hono 后端：路由、手写 LLM 集成层、Agent 逻辑、工具系统 | LLM Provider 的内部类型（NormalizedStreamEvent 等）在此定义，不在 protocol 中 |
| `app/web/src/` | React + Vite 前端：聊天 UI、SSE 流消费、状态管理 | 从 `@myagent/protocol` 导入类型，不自行定义重复类型 |
| `app/codegen.sh` | 协议代码生成脚本（build/generate/clean/validate） | 修改 protocol 后运行 `./app/codegen.sh build` 重新编译 |
| `app/dev.sh` | 一键启动两端开发服务器 | — |

### doc/ — 文档目录

| 目录 | 作用 | 内容定位 |
|------|------|---------|
| `doc/architecture/` | 技术架构决策文档 | 选型理由、分层设计、数据流图、LLM 集成层架构。回答"为什么这样设计" |
| `doc/phases/` | 分阶段学习与实现路径 | 每个 Phase 的目标、模块清单、伪代码、验证清单。回答"实现什么、怎么实现" |
| `doc/references/` | 外部 API 参考文档 | Anthropic API 规范等，供离线查阅。不是项目自己的设计，是依赖的外部规范 |
| `doc/guides/` | 运行指南与环境配置 | 开发环境搭建、启动方式、API 密钥配置 |
| `doc/README.md` | 文档总入口 | 项目背景 + 所有文档目录的索引 |

### 文档唯一性原则

- **不要复制内容**：Phase 文档引用 architecture 文档（用相对链接），不把架构设计复制一遍
- **architecture/ 回答"为什么"**，phases/ 回答"做什么"，references/ 回答"外部怎么规定"
- **protocol/ 是代码中的契约**，protocol/index.md 是对它的说明文档

### 代码类型的分层

```
@myagent/protocol   → 前后端共享类型（客户端能看到的 SSE 事件、REST API 请求/响应）
service/llm/types/  → 服务端内部类型（NormalizedStreamEvent、LLMProvider 接口）
                       前端永远不会 import 这些类型
```

两层类型的映射关系：
- `NormalizedStreamEvent`（服务端内部）→ 经过 relay 翻译 → `StreamEvent`（protocol，客户端可见）
- `NormalizedMessage`（服务端内部）→ 经过 mapper 转换 → Anthropic/OpenAI API 格式

## 新对话入门：读取顺序

接手此项目的 Agent，按以下顺序快速了解上下文：

```
1. doc/README.md             → 项目是什么
2. doc/phases/index.md       → 当前进度（哪个 Phase 已完成/进行中）
3. doc/architecture/index.md → 架构设计入口
4. doc/architecture/project-structure.md → 目录结构 + 组件树
5. doc/architecture/llm-integration.md   → LLM 层设计（核心）
6. doc/architecture/data-flow.md         → 端到端数据流
7. app/protocol/index.md     → 前后端协议定义
8. doc/phases/{current}/     → 当前阶段的实现规格书
```

## 文档红线（不可违反）

### 唯一性原则

**同一个设计细节只能存在于一个地方，其余文档通过相对链接 + 章节锚点索引。**

```
architecture/  ← 架构设计的唯一来源（为什么这样设计、组件树、状态管理、数据流）
phases/        ← 实现规格书（做什么、怎么做、按什么顺序、怎么验证）
references/    ← 外部 API 规范（Anthropic、Ollama 的请求/响应格式）
protocol/      ← 代码中的数据契约（Zod Schema）
```

- Phase 文档中**不复制**架构设计细节 → 写 `> 详情见 [xxx](../../architecture/xxx.md#章节锚点)`
- Phase 文档中**不复制**外部 API 格式 → 写 `> 请求格式见 [xxx](../../references/xxx.md#锚点)`
- Phase 文档中**不复制**完整类型定义 → 写 `import { ... } from "@myagent/protocol"` 或指向源文件
- Architecture 文档中**不写**实现清单或验证步骤 → 那是 Phase 文档的职责

违反此原则的 PR 必须修正后才能合并。

### 其他红线

- **不可变模式**：永远创建新对象，不修改现有对象
- **协议优先**：新 API 端点必须先定义 Zod Schema
- **文件 ≤ 800 行**：超过必须拆分

## 技术栈

- 前端：React 19 + Vite 6
- 后端：Hono 4 + @hono/node-server
- 协议：Zod + TypeScript workspace references
- 不使用：AI SDK、LangChain

## 常用命令

```bash
pnpm dev              # 启动两端服务
pnpm run lint         # 代码检查
pnpm run lint:fix     # 自动修复
pnpm run typecheck    # 类型检查
pnpm run test         # 运行测试
./app/codegen.sh build  # 构建 protocol 包
```
