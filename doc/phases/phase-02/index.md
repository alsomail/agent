# Phase 2：对话记忆与上下文管理

> 状态：✅ 已完成
> 前置依赖：Phase 1（已完成 ✅）
> 预计工作量：3-4 天

---

## 一、目标

让 Agent 拥有会话记忆——能记住对话上下文、持久化消息历史、在上下文超出窗口时智能压缩。

验收标准：
- 发"我叫小明" → 发"我叫什么" → Agent 答"小明"
- 重启后端 → 会话和消息历史仍在
- 侧边栏切换会话 → 消息历史正确加载

---

## 二、前置阅读

| 文档 | 必读章节 | 内容 |
|------|---------|------|
| [记忆体系架构](../../architecture/memory-system.md) | 全部 | 6 层记忆体系、Token 计数原理、Running Summary、SQLite 设计 |
| [项目结构](../../architecture/project-structure.md) | §service | 新增 db/ 和 agent/ 目录 |
| [协议定义](../../../app/protocol/index.md) | session.ts, message.ts | 新增的 Schema |

---

## 三、协议变更

### 新增 Schema（`app/protocol/src/`）

| 文件 | 新增 | 说明 |
|------|------|------|
| `session.ts` | `SessionDetailSchema` | Session + messages 数组（会话详情响应） |
| `session.ts` | `SessionListItemSchema` | 会话列表条目（不含消息，含标题摘要） |
| `message.ts` | `StoredMessageSchema` | 带 id + createdAt + tokenCount 的持久化消息 |

### 新增 API 端点

| 方法 | 路径 | 说明 | Schema |
|------|------|------|--------|
| `GET` | `/api/sessions` | 会话列表（侧边栏用） | → `SessionListItemSchema[]` |
| `GET` | `/api/session/:id/messages` | 消息历史 | → `StoredMessageSchema[]` |

---

## 四、服务端模块（按实现顺序）

### 模块 1：Drizzle Schema（`service/src/db/schema.ts`）

定义 3 张表：sessions, messages, summaries。
> 表结构设计见 [记忆体系 §2 持久化](../../architecture/memory-system.md#2-对话历史l1)

### 模块 2：SQLite 连接（`service/src/db/index.ts`）

创建 SQLite 连接（better-sqlite3）+ Drizzle 实例。数据库文件路径：`.data/myagent.db`。启动时自动创建 `.data/` 目录。

### 模块 3：数据库迁移（`service/src/db/migrate.ts`）

Drizzle Kit push 或自定义迁移脚本。Phase 2 首次建表，后续 Phase 增量迁移。

### 模块 4：会话/消息 CRUD（`service/src/store/session-store.ts` 更新）

从 Map 迁移到 SQLite。接口不变，实现替换：
- `createSession()` → INSERT INTO sessions
- `getSession()` → SELECT FROM sessions WHERE id
- `deleteSession()` → DELETE（级联删除 messages + summaries）
- `addMessage()` → INSERT INTO messages（新增）
- `getMessages()` → SELECT FROM messages WHERE sessionId ORDER BY createdAt（新增）

### 模块 5：Token 估算器（`service/src/agent/context.ts`）

> 估算算法见 [记忆体系 §3 Token 计数](../../architecture/memory-system.md#3-上下文窗口管理l2)

实现 `estimateTokenCount(text): number`，中文 ~1 token/字，英文 ~4 字符/token。

### 模块 6：上下文构建器（`service/src/agent/context.ts`）

> 完整算法见 [记忆体系 §5 上下文构建器](../../architecture/memory-system.md#5-上下文构建器)

职责：加载消息历史 → 计算 token → 判断是否需要压缩 → 返回 ContextWindow。

### 模块 7：Running Summary 压缩器（`service/src/agent/summarizer.ts`）

> 压缩策略和 Prompt 设计见 [记忆体系 §4](../../architecture/memory-system.md#4-上下文压缩--running-summaryl3)

当上下文超窗口 70% 时触发。调用当前会话的 LLM 生成摘要，存入 summaries 表。

### 模块 8：Chat 路由更新（`service/src/routes/chat.ts`）

核心变更：
1. 追加 user 消息到 DB（而非仅计数）
2. 调用 context builder 构建上下文窗口（而非只发单条）
3. 流式结束后追加 assistant 消息到 DB
4. 更新 session.messageCount 和 updatedAt

### 模块 9：Session 路由更新（`service/src/routes/session.ts`）

新增端点：
- `GET /api/sessions` — 查询所有会话，返回列表（按 updatedAt 倒序）
- `GET /api/session/:id/messages` — 查询消息历史

启动时初始化数据库（app.ts 或 index.ts）。

---

## 五、Web 前端

> 会话侧边栏组件设计见 [记忆体系 §6](../../architecture/memory-system.md#6-前端会话管理)

### 实现要点

| 要点 | 说明 |
|------|------|
| 切换会话先加载历史 | `GET /api/session/:id/messages` → setMessages |
| 新建会话清空 UI | 创建后 setMessages([])，sessionId 切换 |
| 修改当前会话模型立即生效 | `PATCH /api/session/:id` 更新当前会话的 provider/model，后续消息直接使用新配置 |
| 会话标题自动生成 | 取首条 user 消息前 30 字作为标题 |
| 侧边栏宽度固定 240px | flex 布局，主区域 flex: 1 |

### 文件清单

| # | 文件 | 职责 | 新建/更新 |
|---|------|------|----------|
| 1 | `web/src/api/client.ts` | fetchSessions, fetchMessages | 更新 |
| 2 | `web/src/hooks/useChat.ts` | 多会话状态管理 | 更新 |
| 3 | `web/src/components/session/SessionSidebar.tsx` | 侧边栏容器 | 新建 |
| 4 | `web/src/components/session/SessionItem.tsx` | 会话条目 | 新建 |
| 5 | `web/src/components/chat/ChatContainer.tsx` | 集成侧边栏 | 更新 |
| 6 | `web/src/App.tsx` | 布局调整 | 更新 |

---

## 六、验证清单

```
代码质量
- [ ] pnpm -w run lint 通过
- [ ] pnpm -w run typecheck 通过

多轮对话
- [ ] 发"我叫小明" → 发"我叫什么" → Agent 答"小明"
- [ ] 连续 5 轮对话，上下文保持连贯

持久化
- [ ] 重启后端 → 会话和消息历史仍在
- [ ] .data/myagent.db 文件存在且可查询

会话管理
- [ ] 侧边栏显示会话列表
- [ ] 新建会话 → 空聊天界面
- [ ] 切换会话 → 历史消息正确加载
- [ ] 删除会话 → 从列表消失 + DB 记录删除

上下文管理
- [ ] 大量消息超出窗口 → 不报错，Agent 仍正常响应
- [ ] 触发 Running Summary → 日志显示摘要生成
- [ ] 摘要后继续对话 → 上下文连贯（能回忆摘要中的关键事实）

边界
- [ ] .data/ 目录不存在时自动创建
- [ ] 空会话（0 条消息）能正常操作
```

### Phase 2 复盘补充场景

以下场景来自 Phase 2 实现后的缺陷复盘，后续 Phase 修改会话初始化、模型选择或持久化逻辑时必须回归：

1. 模型选择器未加载时创建会话 → 首次打开页面，延迟 `/api/models` 响应，立即触发新建会话 → 前端不得使用不存在的硬编码模型，必须等待真实模型或显示可操作错误。
2. 首次加载初始化链路 → 清空本地会话后刷新页面，观察 Provider 列表加载、模型列表加载、会话创建、消息输入可用的完整顺序 → 创建请求中的 provider/model 必须来自已加载列表。
3. 旧会话数据残留 → 数据库中保留旧 provider/model 的会话后重启服务并刷新页面 → 切换到旧会话时必须使用该会话保存的 provider/model；模型不存在时要返回可见错误，不得静默替换或调用错误模型。
4. 快速连续新建会话 → 在模型列表加载完成前后连续点击新建会话 → 最多创建一个当前选中模型的有效会话，UI 当前会话、侧边栏和数据库一致。
5. 切换会话时流式响应未结束 → 会话 A 正在响应时切换到会话 B → A 的后续流事件不得追加到 B 的消息列表。
6. 在已有会话中切换模型 → 当前会话先用模型 A 发一轮，再切到模型 B 继续提问 → 后端必须读取更新后的 session.provider/model，不能继续沿用旧配置。
7. 当前用户消息重复进入上下文 → chat route 已经先持久化 user 消息时，`buildContext` 只能从数据库读取历史，不得再额外追加同一条 newMessage，否则模型会把当前输入当成重复历史。

---

## 七、相关文档索引

| 主题 | 文档 |
|------|------|
| 记忆体系全景 | [memory-system.md](../../architecture/memory-system.md) §1 |
| 对话历史 + 持久化设计 | [memory-system.md](../../architecture/memory-system.md) §2 |
| Token 计数原理 | [memory-system.md](../../architecture/memory-system.md) §3 |
| Running Summary | [memory-system.md](../../architecture/memory-system.md) §4 |
| 上下文构建器算法 | [memory-system.md](../../architecture/memory-system.md) §5 |
| 会话管理 UI 设计 | [memory-system.md](../../architecture/memory-system.md) §6 |
| 协议定义 | [protocol/index.md](../../../app/protocol/index.md) |
| 项目结构 | [project-structure.md](../../architecture/project-structure.md) §service |
