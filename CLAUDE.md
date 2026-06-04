# CLAUDE.md - MyAgent 项目行为规范

## 项目概述

MyAgent 是一个以学习为核心目的的 AI Agent 项目。手写所有 LLM 集成层，
不使用 Vercel AI SDK、LangChain 等黑盒封装。

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

## 项目结构约定

```
app/protocol/src/   → 前后端共享的 Zod schemas
app/service/src/    → 后端（Hono + 手写 LLM 层）
app/web/src/        → 前端（React + Vite）
doc/                → 文档（设计、学习笔记、指南）
```

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
