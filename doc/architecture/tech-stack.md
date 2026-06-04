# 技术选型与对比分析

本文档记录 MyAgent 项目每一项技术选择的理由。不只是"用了什么"，更重要的是"为什么选它、放弃了什么"。

---

## 包管理：pnpm workspaces

### 选了什么

pnpm 作为包管理器，使用其内置的 workspaces 功能管理 monorepo。

### 为什么选它

1. **磁盘效率**：pnpm 使用硬链接 + 内容寻址存储，同一个包只在磁盘上存一份。对比 npm/yarn 的扁平化 `node_modules`，空间节省显著。
2. **严格依赖**：pnpm 默认不做依赖提升（hoisting），你只能 import 自己 `package.json` 里声明过的包。这避免了"幽灵依赖"问题——某个包你没声明却能用，直到某天它被间接移除后突然崩溃。
3. **内置 workspaces 足够用**：对于 3 个包的小型 monorepo，pnpm workspaces 提供的功能完全够了：`workspace:*` 协议、`pnpm -r run` 递归执行、`--filter` 精确定位。

### 放弃了什么

| 工具 | 放弃原因 |
|------|----------|
| **Turborepo** | 它的价值在于构建缓存和任务编排。3 个包的项目没有复杂的构建拓扑，引入 Turborepo 是过度工程。 |
| **Nx** | 功能强大但学习曲线陡峭，配置繁重。对学习项目来说，理解 Nx 的时间应该花在理解 LLM 协议上。 |
| **yarn** | Berry (v4) 的 PnP 模式与部分工具链兼容性不好；classic yarn 没有 pnpm 的严格依赖优势。 |
| **npm workspaces** | 可用但缺少 pnpm 的磁盘效率和严格模式。 |

### 在本项目中怎么用

`pnpm-workspace.yaml` 声明了 3 个包：

```yaml
packages:
  - "app/protocol"
  - "app/service"
  - "app/web"
```

包之间通过 `workspace:*` 协议引用。例如 `@myagent/service` 的 `package.json`：

```json
{
  "dependencies": {
    "@myagent/protocol": "workspace:*"
  }
}
```

`workspace:*` 的含义：始终解析到本地工作区的 `@myagent/protocol`，而非从 npm 注册表下载。pnpm 会自动创建符号链接。

常用命令：

```bash
pnpm install                          # 安装所有包的依赖
pnpm --filter @myagent/protocol build  # 只构建 protocol
pnpm -r run typecheck                  # 递归对所有包执行 typecheck
```

---

## 前端：React 19 + Vite 6

### 选了什么

React 19 作为 UI 框架，Vite 6 作为构建工具，纯客户端 SPA 模式。

### 为什么选它

1. **不需要 SSR**：MyAgent 是一个 Agent 操作面板（类似 ChatGPT 界面），没有 SEO 需求，不需要服务端渲染。核心需求是实时流式更新——用户发送消息后看到 Agent 逐字输出。SPA 架构最适合这种"重交互、轻内容"的场景。
2. **React 19 的并发特性**：Transitions、Suspense 对流式 UI 场景有天然优势。当 SSE 事件高频到达时，React 的批量更新机制自动合并 re-render。
3. **Vite 的透明性**：Vite 的配置文件 (`vite.config.ts`) 简洁易懂。HMR 基于原生 ESM，改一行代码几十毫秒就能在浏览器生效。对于学习项目，构建工具越透明越好。

### 放弃了什么

| 方案 | 放弃原因 |
|------|----------|
| **Next.js** | App Router 的 Server Components、Server Actions、缓存策略增加了大量概念负荷。本项目的后端是 Hono，不需要 Next.js 的全栈能力。用 Next.js 等于同时维护两个后端。 |
| **Remix** | 同理，它的 loader/action 模型假设后端和前端紧耦合。 |
| **Vue/Svelte** | React 生态更成熟，TypeScript 支持最好。学习 Agent 本身已经够复杂，框架层面选最熟悉的。 |
| **webpack** | 配置复杂，HMR 慢。Vite 在 DX 上全面胜出。 |

### 在本项目中怎么用

Vite 开发服务器运行在 `localhost:5173`，通过 proxy 把 `/api` 请求转发到 Hono 后端 `localhost:3001`：

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
```

前端直接 `fetch("/api/...")` 即可，不用关心跨域。

---

## 后端：Hono 4 + @hono/node-server

### 选了什么

Hono 4 作为 HTTP 框架，通过 `@hono/node-server` 运行在 Node.js 22 上。

### 为什么选它

1. **Web Standards 优先**：Hono 的核心 API 基于 Web 标准的 `Request`/`Response`（Fetch API）。这意味着你学到的知识可以直接迁移到 Cloudflare Workers、Deno、Bun 等任何支持 Web Standards 的运行时。
2. **内置 SSE 助手**：Hono 提供 `streamSSE()` 帮助函数，让 Server-Sent Events 的实现变得简洁。对于 LLM 流式输出场景，SSE 是核心能力。
3. **轻量且类型安全**：Hono 的路由系统支持类型推导，配合 `@hono/zod-validator` 可以在路由层直接校验请求体。
4. **中间件简洁**：CORS、日志、错误处理等用标准的 `app.use()` 注册，代码量少，易于理解。

### 放弃了什么

| 框架 | 放弃原因 |
|------|----------|
| **Express** | 基于 Node.js 原生 `req`/`res` API（非 Web Standards），没有内置类型推导，中间件模型老旧。可以用但学不到现代 Web 标准。 |
| **Fastify** | 性能出色，但 API 设计偏 Node.js 原生风格。Schema 校验用的是 JSON Schema，不如 Zod 直观。 |
| **tRPC** | tRPC 是前后端类型共享的好方案，但它封装了太多传输层细节。本项目的核心目标是手写 SSE 流，tRPC 的 subscription 会把这层藏起来。 |

### 在本项目中怎么用

```typescript
// app.ts — Hono 应用组装
const app = new Hono();
app.use("*", corsMiddleware);
app.use("*", loggerMiddleware);
app.route("/api/health", healthRoute);
app.route("/api/session", sessionRoute);
app.route("/api/session/:id/chat", chatRoute);
app.onError(errorHandler);
```

```typescript
// index.ts — 通过 @hono/node-server 启动
import { serve } from "@hono/node-server";
serve({ fetch: app.fetch, port: 3001 });
```

`serve({ fetch: app.fetch })` 这一行很关键：Hono 的 `app.fetch` 符合 Web Standards 的 `fetch` 签名，`@hono/node-server` 负责把 Node.js 的 `IncomingMessage` 转换成标准 `Request`。

---

## 协议层：Zod Schemas + 共享包

### 选了什么

用 Zod 定义所有前后端共享的数据结构，放在 `@myagent/protocol` 包中。

### 为什么选它

1. **一处定义，两端使用**：Zod Schema 既是运行时校验器，也是类型的唯一来源（通过 `z.infer<typeof Schema>` 推导出 TypeScript 类型）。不需要手动维护 `.d.ts` 文件。
2. **运行时校验**：API 边界处用 `zValidator` 在服务端校验请求体。如果请求不合法，自动返回 422 错误和详细的校验失败信息。
3. **判别联合**：Zod 的 `z.discriminatedUnion("type", [...])` 完美适配 SSE 事件流——每个事件通过 `type` 字段区分，TypeScript 编译器能自动缩窄类型。

### 放弃了什么

| 方案 | 放弃原因 |
|------|----------|
| **Protobuf** | 需要 `.proto` 文件 + 编译步骤，生成的 TypeScript 代码臃肿。适合微服务间通信，不适合前后端 TypeScript monorepo。 |
| **tRPC** | tRPC 把路由定义和类型推导绑在一起，很方便但不透明。本项目想让学习者看清数据是怎么从 Zod Schema 流转到 HTTP 请求的每一步。 |
| **OpenAPI** | YAML/JSON 格式的 Schema 不如 Zod 直观，且需要额外的代码生成步骤。Zod-to-JSON-Schema 可以在需要时导出。 |
| **手写接口 + 运行时不校验** | 类型安全只存在于编译期，运行时收到错误数据不会报错，只会在下游莫名崩溃。 |

### 在本项目中怎么用

类型安全的完整流转路径：

```
Zod Schema (protocol/src/message.ts)
  ↓ z.infer<typeof Schema>
TypeScript 类型 (编译期)
  ↓ 导出到 @myagent/protocol
服务端：zValidator("json", Schema)  → 运行时校验请求体
前端：import type { Message }       → 编译期类型安全
```

示例——SSE 事件的判别联合：

```typescript
// protocol/src/stream-event.ts
export const StreamEventSchema = z.discriminatedUnion("type", [
  TextDeltaEventSchema,     // { type: "text_delta", text: string }
  ToolCallStartEventSchema, // { type: "tool_call_start", toolCallId, toolName }
  ToolCallDeltaEventSchema, // { type: "tool_call_delta", toolCallId, partialJson }
  ToolResultEventSchema,    // { type: "tool_result", toolCallId, result, isError }
  StateChangeEventSchema,   // { type: "state_change", state }
  ErrorEventSchema,         // { type: "error", code, message, retryable }
  DoneEventSchema,          // { type: "done", usage }
]);
```

`codegen.sh build` 的角色：运行 `tsc` 编译 protocol 包，输出 `.js` + `.d.ts` 到 `dist/`。service 和 web 包通过 `workspace:*` 直接依赖编译产物。

---

## LLM 集成：手写（核心学习点）

### 选了什么

完全手写 LLM HTTP 客户端、SSE 流解析器、归一化事件层和 Agent Loop。

### 为什么选它

这是整个项目存在的理由。

市面上的 SDK 把以下能力封装成黑盒：
- **Vercel AI SDK**：一行 `streamText()` 搞定流式输出，但你看不到 SSE 是怎么解析的、Tool Call 是怎么从 `input_json_delta` 一块块拼起来的。
- **LangChain**：提供了 Agent / Chain / Memory 等高级抽象，但底层的 HTTP 调用、重试、流解析全被藏起来了。

手写这些层能学到的东西：

| 你会学到 | SDK 帮你藏了 |
|----------|------------|
| SSE 协议格式（`data:` 前缀、`\n\n` 分隔） | 自动解析 |
| HTTP 流式传输（chunked transfer encoding） | `fetch` + `ReadableStream` 都帮你封装了 |
| Anthropic 和 OpenAI 的事件格式差异 | 统一接口屏蔽 |
| Tool Call 的增量 JSON 拼接 | 自动拼接 |
| Agent Loop 的状态机设计 | `maxSteps` 一个参数搞定 |
| 错误处理和重试策略 | 内置重试 |

### 放弃了什么

| SDK | 放弃原因 |
|-----|----------|
| **Vercel AI SDK** | 生产项目首选，但它的抽象层太厚，学习者无法理解底层机制。 |
| **LangChain** | 抽象层更厚，且引入 Python 风格的 Chain 概念，在 TypeScript 项目中不够自然。 |
| **OpenAI Node SDK** | 它只处理 OpenAI 协议，不支持 Anthropic。且流解析也被封装了。 |
| **Anthropic Node SDK** | 同上，只处理 Anthropic 协议。 |

### 在本项目中怎么用

详见 [llm-integration.md](./llm-integration.md)。

---

## Lint/Format：Biome

### 选了什么

Biome 作为唯一的代码检查和格式化工具，替代 ESLint + Prettier 组合。

### 为什么选它

1. **单工具**：一个二进制文件同时做 lint 和 format。不需要配 ESLint 规则集、不需要 Prettier 插件、不需要处理两者的冲突（`eslint-config-prettier`）。
2. **速度**：Biome 用 Rust 编写，比 ESLint + Prettier 快 10-25 倍。在 pre-commit hook 中尤为重要——开发者不会因为慢而跳过检查。
3. **配置简洁**：一个 `biome.json` 文件包含所有规则。对比 ESLint 的 `.eslintrc` + 插件 + extends 链条，心智负担低。

### 放弃了什么

| 工具 | 放弃原因 |
|------|----------|
| **ESLint + Prettier** | 经典组合但配置繁琐。需要 `eslint-config-prettier` 解决冲突，插件生态虽然丰富但很多规则已被 TypeScript 编译器覆盖。 |
| **dprint** | 速度同样快，但生态和规则覆盖不如 Biome 完整。 |

### 在本项目中怎么用

```json
// biome.json（关键配置）
{
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": { "quoteStyle": "double", "semicolons": "always" }
  }
}
```

```bash
pnpm run lint      # 检查（不修改）
pnpm run lint:fix  # 检查 + 自动修复
```

---

## Pre-commit：lefthook

### 选了什么

lefthook 管理 Git hook，在 `pre-commit` 阶段自动执行 lint 和 typecheck。

### 为什么选它

1. **单二进制，无依赖**：lefthook 用 Go 编写，`npm install` 后直接可用，不需要额外的 `.husky/` 目录或 `npx` 调用链。
2. **并行执行**：lefthook 的 `parallel: true` 让 lint 和 typecheck 同时运行，节省 pre-commit 等待时间。
3. **配置直观**：YAML 格式，`glob` + `run` 两个字段搞定。

### 放弃了什么

| 工具 | 放弃原因 |
|------|----------|
| **husky + lint-staged** | 主流方案但需要两个包配合。husky v9 改了安装方式，需要 `.husky/` 目录和 `prepare` script。lint-staged 在大仓库中偶尔有性能问题。 |
| **simple-git-hooks** | 更简单但功能少，不支持并行执行。 |

### 在本项目中怎么用

```yaml
# lefthook.yml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{ts,tsx,js,jsx,json}"
      run: npx biome check --write {staged_files}
    typecheck:
      glob: "*.{ts,tsx}"
      run: pnpm -r run typecheck
```

`{staged_files}` 是 lefthook 的内置变量，只对暂存区的文件执行检查，不影响未提交的改动。

---

## 测试：Vitest

### 选了什么

Vitest 作为测试框架，运行单元测试和集成测试。

### 为什么选它

1. **与 Vite 共享配置**：Vitest 复用 Vite 的转换管线（ESM、TypeScript、JSX），不需要额外的 `ts-jest` 或 `babel-jest` 配置。
2. **API 兼容 Jest**：`describe`、`it`、`expect` 的用法几乎一致，迁移成本为零。
3. **速度快**：基于 esbuild 转换 TypeScript，测试启动和执行速度显著优于 Jest。
4. **内置功能丰富**：覆盖率报告、快照测试、mock 能力、watch 模式都内置，不需要额外安装插件。

### 放弃了什么

| 工具 | 放弃原因 |
|------|----------|
| **Jest** | 需要 `ts-jest` 或 `@swc/jest` 来处理 TypeScript，配置 ESM 支持比较折腾。功能等价但 DX 不如 Vitest。 |
| **Playwright Test** | 它是 E2E 测试框架，不适合做单元/集成测试。后续阶段会引入 Playwright 做端到端测试。 |

### 在本项目中怎么用

```bash
pnpm run test       # 运行所有测试
pnpm run test:watch # watch 模式
```

Vitest 自动发现 `*.test.ts` 和 `*.spec.ts` 文件。使用 AAA 模式（Arrange-Act-Assert）编写测试：

```typescript
import { describe, it, expect } from "vitest";

describe("StreamEventSchema", () => {
  it("correctly parses a text_delta event", () => {
    // Arrange
    const raw = { type: "text_delta", text: "hello" };

    // Act
    const result = StreamEventSchema.parse(raw);

    // Assert
    expect(result.type).toBe("text_delta");
  });
});
```
