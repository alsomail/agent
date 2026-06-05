# 项目结构与模块职责

本文档完整解释 MyAgent 项目的目录结构、每个模块的职责，以及三个核心包之间的依赖关系。

---

## 顶层目录

```
myAgent/
├── CLAUDE.md                 # Claude Code 行为规范（编辑后必须 lint/typecheck 等）
├── package.json              # 根工作区配置（scripts、devDependencies）
├── pnpm-workspace.yaml       # 声明 3 个 workspace 包
├── tsconfig.base.json        # 所有包共享的 TypeScript 基础配置
├── biome.json                # Biome lint + format 规则（全局生效）
├── lefthook.yml              # Git pre-commit hooks 配置
├── .env.example              # API 密钥模板（复制为 .env 后填入真实密钥）
├── .gitignore                # Git 忽略规则
│
├── doc/                      # 项目文档
│   ├── README.md             # 文档总入口
│   ├── architecture/         # 架构设计文档（本目录）
│   ├── phases/               # 分阶段学习路径（10 个阶段）
│   └── guides/               # 运行指南与环境配置
│
└── app/                      # 所有源码
    ├── protocol/             # @myagent/protocol — 共享类型包
    ├── service/              # @myagent/service — Hono 后端
    ├── web/                  # @myagent/web — React 前端
    ├── codegen.sh            # 协议编译与代码生成脚本
    └── dev.sh                # 一键启动开发环境
```

### 根配置文件说明

| 文件 | 作用 |
|------|------|
| `package.json` | 定义根级 scripts（`pnpm dev`、`pnpm run lint` 等）和共享 devDependencies（biome、lefthook、vitest） |
| `pnpm-workspace.yaml` | 告诉 pnpm 哪些目录是工作区包，启用 `workspace:*` 依赖协议 |
| `tsconfig.base.json` | 共享的 TypeScript 严格模式配置（`strict: true`、`composite: true`、ESM 输出），各包的 `tsconfig.json` 通过 `extends` 继承它 |
| `biome.json` | 全局 lint/format 规则：2 空格缩进、双引号、分号、100 字符行宽 |
| `lefthook.yml` | pre-commit 时并行运行 biome check 和 typecheck |

---

## 三个核心包的关系

这是理解整个项目的关键：

```
                    ┌─────────────────────┐
                    │  @myagent/protocol   │
                    │  (Zod Schemas + 类型) │
                    └──────────┬──────────┘
                               │
                    ╔══════════╧══════════╗
                    ║   workspace:*       ║
                    ║   两端共同依赖        ║
                    ╚══════════╤══════════╝
                               │
              ┌────────────────┼────────────────┐
              ▼                                  ▼
┌──────────────────────┐          ┌──────────────────────┐
│  @myagent/service     │          │  @myagent/web         │
│  (Hono 后端)          │◄────────│  (React 前端)          │
│  - Agent Loop         │  HTTP    │  - SSE 流客户端        │
│  - LLM 集成           │  SSE     │  - 聊天 UI             │
│  - 工具系统            │          │  - 状态管理            │
└──────────────────────┘          └──────────────────────┘
```

**数据流向**：
- `protocol` 定义数据契约（Schema + 类型），是两端的"唯一真相源"
- `service` 实现 Agent 逻辑，调用 LLM API，通过 SSE 推送事件
- `web` 消费 SSE 事件流，渲染聊天 UI

**依赖方向**：
- `service` → `protocol`（导入 Schema 做请求校验 + 类型）
- `web` → `protocol`（导入类型做编译期类型安全）
- `web` → `service`（运行时通过 HTTP/SSE 通信，开发时通过 Vite proxy 转发）

---

## @myagent/protocol — 共享类型包

```
app/protocol/
├── package.json              # 包名 @myagent/protocol，导出 dist/
├── tsconfig.json             # 继承 tsconfig.base.json，输出到 dist/
└── src/
    ├── index.ts              # 统一导出入口（re-export 所有模块）
    ├── agent-state.ts        # Agent 状态枚举
    ├── session.ts            # 会话相关 Schema
    ├── message.ts            # 消息 + 内容块 Schema（判别联合）
    ├── stream-event.ts       # SSE 事件 Schema（判别联合）
    └── tool.ts               # 工具定义、调用、结果 Schema
```

### 各文件职责

| 文件 | 定义了什么 | 在哪里用 |
|------|-----------|---------|
| `agent-state.ts` | Agent 的 6 种状态：`idle`、`streaming`、`tool_executing`、`completed`、`error`、`aborted` | 服务端状态机、前端 UI 状态展示 |
| `session.ts` | `CreateSessionRequest`、`Session` | 服务端创建/查询会话、前端展示会话列表 |
| `message.ts` | `Message`、`ContentBlock`（text / tool_use / tool_result 判别联合）、`ChatRequest`、`SendMessageRequest` | 服务端消息存储、前端消息渲染 |
| `stream-event.ts` | 7 种 SSE 事件类型的判别联合：`text_delta`、`tool_call_start`、`tool_call_delta`、`tool_result`、`state_change`、`error`、`done` | 服务端 SSE 推送、前端 SSE 解析 |
| `tool.ts` | `ToolDefinition`、`ToolCall`、`ToolResult` | 服务端工具注册与执行、前端工具调用展示 |

### 为什么是判别联合

`stream-event.ts` 和 `message.ts` 大量使用 Zod 的 `z.discriminatedUnion("type", [...])`。这是因为 SSE 事件和消息内容块都是**多态**的——同一个字段（`type`）决定了其余字段的形状。判别联合让 TypeScript 在 `switch(event.type)` 时自动缩窄类型：

```typescript
function handleEvent(event: StreamEvent) {
  switch (event.type) {
    case "text_delta":
      // TypeScript 知道这里 event 是 TextDeltaEvent
      console.log(event.text);
      break;
    case "tool_call_start":
      // TypeScript 知道这里有 toolCallId 和 toolName
      console.log(event.toolName);
      break;
  }
}
```

---

## @myagent/service — Hono 后端

```
app/service/
├── package.json              # 依赖 @myagent/protocol (workspace:*)、hono、zod
├── tsconfig.json             # 继承 tsconfig.base.json
└── src/
    ├── app.ts                # Hono 应用组装（中间件 + 路由挂载）
    ├── index.ts              # 服务启动入口（@hono/node-server）
    │
    ├── routes/               # 路由层（HTTP 端点定义）
    │   ├── health.ts         # GET /api/health — 健康检查
    │   ├── session.ts        # POST/GET/DELETE /api/session — 会话 CRUD
    │   └── chat.ts           # POST /api/session/:id/chat — SSE 流式聊天
    │
    ├── middleware/            # 中间件
    │   ├── cors.ts           # CORS 配置（允许 localhost:5173）
    │   ├── logger.ts         # 请求日志（方法 + 路径 + 状态码 + 耗时）
    │   └── error-handler.ts  # 全局错误处理（HTTPException → JSON 响应）
    │
    ├── llm/                  # ★ 手写 LLM 集成层（Phase 1 核心实现）
    │   ├── types/            # 归一化类型（Provider 无关的事件接口）
    │   └── providers/        # 各 LLM Provider 的实现
    │       ├── anthropic/    #   Anthropic: HTTP client + stream parser + mapper
    │       └── openai/       #   OpenAI: HTTP client + stream parser + mapper
    │
    ├── db/                   # 数据库层（Phase 2+）
    │   ├── schema.ts         #   Drizzle Schema（sessions, messages, summaries）
    │   ├── index.ts          #   SQLite 连接 + Drizzle 实例
    │   └── migrate.ts        #   数据库迁移
    │
    ├── agent/                # Agent 核心逻辑（Phase 2+）
    │   ├── context.ts        #   上下文构建器（Token 计数 + 截断 + 压缩调度）
    │   └── summarizer.ts     #   Running Summary 压缩器
    │
    ├── tools/                # 工具系统
    │   └── (registry,        #   工具注册表、执行器、内置工具
    │        executor, builtins)
    │
    ├── relay/                # SSE 中继层
    │   └── (sse-relay)       #   将 LLM 归一化事件转发为客户端 SSE
    │
    └── store/                # 存储层
        └── session-store.ts  #   会话 CRUD（基于 SQLite，Phase 2+）
```

### 分层架构说明

service 包的设计遵循**从外到内**的分层：

```
HTTP 请求
  → routes/（路由层：URL 映射 + 请求校验）
    → agent/（业务层：Agent Loop 编排）
      → llm/（集成层：LLM Provider 调用 + 流解析）
      → tools/（执行层：工具注册 + 执行）
    → relay/（输出层：归一化事件 → SSE 推送）
  → middleware/（横切关注点：CORS、日志、错误处理）
```

每一层只依赖下一层的接口，不跨层调用。

### 关键文件说明

**app.ts** — 应用组装入口，负责把中间件和路由组合在一起。导出 `AppType` 供前端使用（虽然目前前端没有用 Hono 的 RPC 客户端）。

**routes/session.ts** — 目前使用内存 `Map` 存储会话，通过 `zValidator("json", CreateSessionRequestSchema)` 在路由层校验创建请求。这是 "协议优先" 原则的体现：Schema 定义在 protocol，校验在 route 层自动完成。

**routes/chat.ts** — Phase 1 的核心端点。当前是占位实现，完成后将：接收消息 → 调用 Agent Loop → 通过 SSE 推送流式事件。

---

## @myagent/web — React 前端

### 目录结构

```
app/web/
├── package.json              # @myagent/web，依赖 @myagent/protocol (workspace:*)、react、vite
├── tsconfig.json             # 继承 tsconfig.base.json，lib 增加 DOM
├── vite.config.ts            # Vite 配置（端口 5173，/api → :3001 proxy）
├── index.html                # SPA 入口
└── src/
    ├── main.tsx              # 应用入口（createRoot + StrictMode）
    ├── App.tsx               # 顶层布局，组合 ChatContainer
    │
    ├── api/
    │   └── client.ts         # SSE 流式客户端（fetch + ReadableStream）+ Provider/Model API
    │
    ├── hooks/
    │   └── useChat.ts        # 聊天状态管理 hook（唯一状态中心）
    │
    ├── components/
    │   └── chat/
    │       ├── ChatContainer.tsx    # 聊天区域容器（Header + MessageList + Input）
    │       ├── ProviderSelector.tsx # Provider 下拉选择器
    │       ├── ModelSelector.tsx    # 模型下拉选择器（动态拉取列表）
    │       ├── MessageList.tsx      # 消息列表 + 自动滚动
    │       ├── MessageBubble.tsx    # 单条消息渲染（用户/AI 不同样式）
    │       ├── StreamingMessage.tsx # 流式文本 + 闪烁光标动画
    │       └── ChatInput.tsx        # 输入框 + 发送按钮（Enter 发送）
    │
    └── styles/
        └── index.css         # 全局样式 + 深色主题 CSS 变量 + 光标动画
```

### Phase 1 组件树

组件层级与 Props 流向（箭头 = 数据传递方向）：

```
App.tsx
│  顶层布局（全屏 flex column）
│
└── ChatContainer.tsx
    │  useEffect 挂载时获取 Provider 列表
    │  调用 useChat() 获取全部状态和方法
    │
    ├── Header 区
    │   ├── ProviderSelector.tsx
    │   │   props: { providers, selected, onSelect }
    │   │   下拉选择器，不可用的 Provider 灰色禁用
    │   │
    │   └── ModelSelector.tsx
    │       props: { provider, selected, onSelect }
    │       选 Ollama 时 GET /api/models 动态拉取
    │       选 Anthropic 时使用预设列表
    │       加载中/错误状态各有提示
    │
    ├── MessageList.tsx
    │   props: { messages[], currentText, isStreaming }
    │   可滚动区域（flex: 1, overflow-y: auto）
    │   自动滚动：useRef + scrollIntoView
    │   空状态："输入消息开始对话"
    │   │
    │   ├── MessageBubble.tsx
    │   │   props: { message: { id, role, content } }
    │   │   用户消息：右对齐，var(--color-surface) 深色背景
    │   │   AI 消息：左对齐，var(--color-border) 边框
    │   │
    │   └── StreamingMessage.tsx
    │       props: { text: string, isActive: boolean }
    │       isActive 时尾部显示 █（@keyframes blink 0.8s）
    │
    ├── 状态指示区
    │   isStreaming → "⏳ Agent 正在思考..."
    │   error → 红色错误横幅 + 关闭按钮
    │
    └── ChatInput.tsx
        props: { onSend: (content) => void, disabled: boolean }
        Enter 发送，Shift+Enter 换行
        streaming/未选模型时 disabled
        发送后自动清空
```

### 状态管理

`useChat` hook 是前端唯一的业务状态中心，不引入全局状态库（如 Redux/Zustand），Phase 1 用 React 内置的 useState/useRef/useCallback 足够。

接口签名：

```typescript
function useChat() {
  return {
    // 状态
    messages: ChatMessage[],        // 完成的消息列表 { id, role: "user"|"assistant", content }
    currentText: string,            // 流式中累积的文本（未完成，real-time 显示）
    isStreaming: boolean,           // 是否正在接收 SSE 流
    error: string | null,           // 最近错误信息
    providers: ProviderInfo[],      // 可用 Provider 列表
    selectedProvider: string,       // 当前选择的 Provider ID
    selectedModel: string,          // 当前选择的模型名
    models: ModelInfo[],            // 当前 Provider 的模型列表

    // 方法
    send(content: string): void,       // 发送消息（含竞态保护）
    dismissError(): void,              // 关闭错误提示
    handleProviderChange(id): void,    // 切换 Provider
    fetchProvidersAndModels(): void,   // 初始化拉取
  }
}
```

组件数据流：

```
useChat ──► ChatContainer
              ├── providers + selectedProvider ──► ProviderSelector
              ├── selectedProvider + selectedModel ──► ModelSelector
              ├── messages + currentText + isStreaming ──► MessageList
              │                                              ├── MessageBubble × N
              │                                              └── StreamingMessage
              ├── isStreaming + error ──► 状态指示区
              └── send + isStreaming ──► ChatInput
```

关键实现细节：
- `send()` 中用局部变量 `accumulated` 累积文本，不直接读 React state（避免闭包旧值）
- `AbortController` 防竞态：发送新消息时 abort 旧请求
- `createSession()` 携带 `selectedProvider` + `selectedModel`
- 选 Ollama 后自动 `GET /api/models?provider=ollama`

### 视觉布局

```
┌──────────────────────────────────────────────────────┐
│ 🤖 MyAgent  提供: [Ollama ▼] 模型: [llama3.2 ▼]     │ ← header (固定)
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ 👤 你好                                  │       │ ← 用户消息（右对齐/深色背景）
│  └──────────────────────────────────────────┘       │
│                                                      │
│  ┌──────────────────────────────────────────┐       │
│  │ 🤖 你好！我是 AI Agent，有什么可以帮      │       │ ← AI 消息（左对齐/边框）
│  │    你的吗？█                             │       │ ← streaming 时尾部闪烁光标
│  └──────────────────────────────────────────┘       │
│                                                      │ ← 可滚动区域
│  ⏳ Agent 正在思考...                                │ ← 状态提示
│                                                      │
├──────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────┐ [发送]        │ ← footer (固定)
│  │ 输入消息...                       │              │
│  └──────────────────────────────────┘              │
└──────────────────────────────────────────────────────┘
```

深色主题 CSS 变量定义在 `src/styles/index.css`：`--color-bg`、`--color-surface`、`--color-border`、`--color-text`、`--color-accent`、`--color-error`、`--radius-sm/md`。

### Vite Proxy 机制

开发环境下，前端 `fetch("/api/...")` 的请求被 Vite proxy 转发到 `http://localhost:3001`。前端代码不硬编码后端地址，生产环境通过反向代理实现同样路由。

---

## 辅助脚本

### codegen.sh — 协议编译与代码生成

```bash
./app/codegen.sh build      # 编译 protocol（tsc → dist/）
./app/codegen.sh generate   # 编译 + 可选生成客户端类型
./app/codegen.sh clean      # 清理所有生成文件
./app/codegen.sh validate   # 只做类型检查，不产出文件
```

这个脚本的核心作用：确保 `protocol/dist/` 是最新的。service 和 web 都依赖这个编译产物。

### dev.sh — 一键启动

```bash
./app/dev.sh
```

做了什么：
1. 检查 pnpm 和 Node.js 是否安装
2. 如果没有 `.env` 文件，从 `.env.example` 复制一份
3. 如果没有 `node_modules`，运行 `pnpm install`
4. 构建 protocol 包（两端都依赖它）
5. 用 `concurrently` 并行启动前端（Vite，端口 5173）和后端（tsx watch，端口 3001）

---

## 目录组织原则

1. **按功能/领域组织，不按类型**：`llm/providers/anthropic/` 而不是 `clients/anthropic-client.ts` + `parsers/anthropic-parser.ts`
2. **就近原则**：中间件放在 service 的 `middleware/` 下，不放在根目录
3. **占位明确**：Phase 1 未实现的文件用注释说明"后续实现"和具体内容，而不是留空文件
4. **共享只放 protocol**：任何两端都需要的类型/Schema 必须放在 protocol 包，不允许在 service 或 web 中重复定义
