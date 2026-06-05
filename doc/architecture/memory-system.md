# Agent 记忆体系

本文档定义 MyAgent 项目的记忆架构——从最基础的对话历史到长期记忆蒸馏的完整设计。

---

## 1. 记忆体系全景

Agent 的"记忆"不是单一能力，而是一个 6 层递进体系。每层解决不同的问题，有不同的复杂度。

```
┌─────────────────────────────────────────────────────────┐
│                    Agent 记忆体系                         │
│                                                         │
│  L1  对话历史 (Conversation History)         Phase 2 ✅  │
│      原始消息数组，直接发给 LLM                          │
│                                                         │
│  L2  上下文窗口管理 (Context Window)         Phase 2 ✅  │
│      Token 计数 + 截断策略                               │
│                                                         │
│  L3  上下文压缩 (Context Compression)        Phase 2 ✅  │
│      Running Summary 模式，用 LLM 摘要旧消息             │
│                                                         │
│  L4  工作记忆 (Working Memory)               Phase 4 ⬜  │
│      结构化事实提取，Agent 主动读写                       │
│                                                         │
│  L5  跨会话记忆 (Cross-Session Memory)       Phase 4+ ⬜ │
│      会话结束提炼 → 新会话检索                            │
│                                                         │
│  L6  长期记忆 (Long-term Memory)             Phase 4+ ⬜ │
│      记忆蒸馏、用户画像、知识图谱                         │
└─────────────────────────────────────────────────────────┘
```

### 为什么分 6 层

| 层级 | 解决的问题 | 复杂度 | 依赖 |
|------|-----------|--------|------|
| L1 对话历史 | Agent 不记得上一轮说了什么 | 低 | 无 |
| L2 窗口管理 | 历史太长超出 LLM 限制 | 中 | L1 |
| L3 压缩 | 截断会丢失重要信息 | 中 | L1 + L2 |
| L4 工作记忆 | 原始消息里提取不出结构化知识 | 高 | L1 + 工具系统(Phase 3) |
| L5 跨会话 | 新会话不知道之前聊过什么 | 高 | L4 + Embedding |
| L6 长期记忆 | 事实太多需要整理/合并/遗忘 | 极高 | L5 + 记忆算法 |

每层都建立在前一层之上。不能跳过——没有 L1 就没有 L2，没有 Token 计数就不知道何时压缩。

---

## 2. 对话历史（L1）

### 核心概念

LLM 本身**没有记忆**。每次调用都是独立的——它只能看到你这次传给它的消息。所谓"对话上下文"，是调用方（我们的 Agent 服务）把之前的消息数组完整发给 LLM。

```
第 1 轮：messages = [user: "我叫小明"]
         → LLM 回复: "你好小明"

第 2 轮：messages = [user: "我叫小明", assistant: "你好小明", user: "我叫什么"]
         → LLM 回复: "你叫小明"
         ↑ 必须把第 1 轮的消息也发过去，LLM 才能"记住"
```

如果第 2 轮只发 `[user: "我叫什么"]`，LLM 会回答"我不知道你叫什么"——因为它没看到第 1 轮。

### 存储模型

Session 和 Message 是一对多关系：

```
Session ──1:N──► Message
  │                ├── id
  │                ├── sessionId (FK)
  │                ├── role: "user" | "assistant"
  │                ├── content: ContentBlock[] (JSON)
  │                ├── tokenCount: number
  │                └── createdAt: datetime
  │
  ├── id
  ├── model, provider
  ├── systemPrompt
  └── state
```

**为什么 `content` 是 JSON 而不是纯文本？**

因为一条 LLM 消息可以包含多个"内容块"：
- 文本块：`{ type: "text", text: "你好" }`
- 工具调用块：`{ type: "tool_use", id: "xxx", name: "search", input: {...} }`
- 工具结果块：`{ type: "tool_result", toolUseId: "xxx", content: "结果" }`

Phase 2 只用到文本块，但数据结构从一开始就为 Phase 3 的工具调用预留。

### 持久化：SQLite + Drizzle ORM

| 方案 | 优点 | 缺点 | 适用阶段 |
|------|------|------|---------|
| 纯内存 Map | 零复杂度 | 重启丢失 | Phase 1 ✅ |
| JSON 文件 | 可读，简单 | 并发写冲突，查询慢，无事务 | — |
| **SQLite** | 零服务器，单文件，SQL 查询，事务支持 | 需要 ORM | **Phase 2 ✅** |
| PostgreSQL | 生产级，扩展性强 | 需要运维 | Phase 10 考虑 |

**为什么选 SQLite 而不是 JSON 文件？**

1. **查询能力**：按 sessionId 查消息、按时间排序、分页——SQL 一行搞定，JSON 需要全量读取再过滤
2. **事务安全**：写入过程中崩溃不会损坏数据（SQLite 有 WAL 模式）
3. **并发安全**：多个请求同时写不会互相覆盖
4. **学习价值**：理解 ORM 映射、SQL 查询、数据库迁移，这些是通用技能

**为什么选 Drizzle ORM？**

| ORM | 特点 | 选择 |
|-----|------|------|
| **Drizzle** | TypeScript-first，schema 即代码，轻量，不需要代码生成 | ✅ |
| Prisma | 需要 `prisma generate` 代码生成步骤，黑盒较厚 | ❌ |
| TypeORM | 装饰器语法，与 ESM 兼容性差 | ❌ |
| 原生 sql | 无类型安全，手写 SQL 容易出错 | ❌ |

### Drizzle Schema 设计

```
数据库文件: .data/myagent.db

sessions 表
  id            TEXT PRIMARY KEY         -- UUID
  model         TEXT NOT NULL            -- 使用的模型名
  provider      TEXT NOT NULL            -- "ollama" | "anthropic"
  systemPrompt  TEXT                     -- 系统提示词（可选）
  state         TEXT NOT NULL DEFAULT 'idle'
  createdAt     TEXT NOT NULL            -- ISO 8601
  updatedAt     TEXT NOT NULL

messages 表
  id            TEXT PRIMARY KEY         -- UUID
  sessionId     TEXT NOT NULL            -- FK → sessions.id
  role          TEXT NOT NULL            -- "user" | "assistant"
  content       TEXT NOT NULL            -- JSON 序列化的 ContentBlock[]
  tokenCount    INTEGER                  -- 估算的 token 数
  createdAt     TEXT NOT NULL

summaries 表
  id            TEXT PRIMARY KEY
  sessionId     TEXT NOT NULL UNIQUE     -- FK → sessions.id，每个 session 最多一条
  content       TEXT NOT NULL            -- 摘要文本
  tokenCount    INTEGER
  createdAt     TEXT NOT NULL
  updatedAt     TEXT NOT NULL
```

---

## 3. 上下文窗口管理（L2）

### 上下文窗口是什么

LLM 的上下文窗口（Context Window）是它一次能处理的最大 token 数。超出这个限制，API 会报错。

```
┌──────────────── 上下文窗口（如 128K tokens）────────────────┐
│                                                            │
│  [system prompt]  [消息1] [消息2] ... [消息N] [新消息]       │
│  ──── 输入 ────────────────────────────────────────────    │
│                                                    [回复]  │
│                                            ──── 输出 ────  │
│                                                            │
└────────────────────────────────────────────────────────────┘
  ↑ 输入 + 输出 共享这个窗口，不是只算输入
```

| 模型 | 上下文窗口 | 备注 |
|------|-----------|------|
| Claude Sonnet 4 | 200K tokens | 约 15 万字中文 |
| Claude Haiku 4.5 | 200K tokens | — |
| Ollama llama3.2 (3B) | 128K tokens | 本地运行 |
| Ollama qwen2.5 (7B) | 128K tokens | 本地运行 |

### Token 计数

**为什么需要计数？**

不计数就不知道何时超出窗口。超出后：
- Anthropic API 返回 400 错误
- Ollama 可能截断输入或生成质量下降

**Token 是什么？**

Token 不等于字符，也不等于单词。LLM 使用 BPE（Byte Pair Encoding）分词：
- 英文常见词可能是 1 个 token："the" → 1 token
- 长词被拆分："uncomfortable" → "un" + "comfort" + "able" → 3 tokens
- 中文每个字约 1-2 个 token："你好" → 约 2 tokens
- 标点和空格也消耗 token

**Phase 2 的估算策略**

不引入外部 tokenizer 库（如 tiktoken），用字符数估算：

```typescript
function estimateTokenCount(text: string): number {
  // 中文字符数（每个约 1 token）
  const cjkChars = (text.match(/[一-鿿]/g) || []).length;
  // 非中文字符数（每 4 个约 1 token）
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars + otherChars / 4);
}
```

为什么用估算而不是精确计数？
- 学习阶段重点是理解"为什么要计数"和"超出时怎么处理"
- 估算精度约 80-90%，足够做截断决策
- 后续可替换为精确 tokenizer

### 截断策略

当消息历史超出窗口时，有三种策略：

| 策略 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| 丢弃最旧 | 保留 system + 最近 N 轮 | 简单 | 丢失重要早期上下文 |
| **滑动窗口** | 保留 system + 摘要 + 最近 N 轮 | 平衡 | 需要摘要能力 |
| 全量摘要 | 每次都摘要全部历史 | 最完整 | LLM 调用成本高 |

**Phase 2 采用"滑动窗口"策略**——结合了 L2 截断和 L3 压缩。

---

## 4. 上下文压缩 — Running Summary（L3）

### 核心思想

不是简单丢弃旧消息，而是用 LLM 将旧消息**压缩为一段摘要**。这样旧信息不会完全丢失，只是变成了更紧凑的形式。

### 工作流程

```
触发条件：当前 token 总数 > 窗口限制 × 70%

步骤：
1. 计算最近 N 轮消息的 token 数（这部分保留不动）
2. 计算 system prompt 的 token 数
3. 剩余的旧消息 → 交给 LLM 生成摘要
4. 替换消息序列：[system] + [摘要] + [最近 N 轮]

示意图：

压缩前（总计 1350 tokens，窗口限制 1000）：
  [system: 200t] [msg1: 100t] [msg2: 300t] [msg3: 150t] [msg4: 400t] [msg5: 200t]
                 ──────── 旧消息 ────────   ────── 保留最近 2 轮 ──────

压缩后（总计 900 tokens）：
  [system: 200t] [摘要: ~100t] [msg4: 400t] [msg5: 200t]
                 ↑ LLM 生成     ────── 保留不变 ──────
```

### 摘要 Prompt

```
你是一个对话摘要助手。请将以下对话历史压缩为简洁的摘要。

要求：
- 保留关键事实（人名、数字、结论）
- 保留用户偏好和未完成的任务
- 不超过 200 字
- 使用第三方视角描述

对话历史：
{messages}
```

**为什么要限制 200 字？** 摘要本身也消耗 token。如果摘要太长，压缩就没意义了。200 字约 100-150 tokens，是合理的压缩比。

### 摘要的存储

每个 session 最多一条活跃摘要（存在 `summaries` 表，sessionId 是 UNIQUE 的）。每次触发压缩时，**覆盖**旧摘要——不保存历史版本。

为什么不保存历史版本？
- 摘要是"当前认知的快照"，旧的摘要已经被新的包含
- 原始消息始终保留在 `messages` 表——摘要只是查询时的优化，不是数据删除

### 成本分析

| 场景 | 额外 LLM 调用 | 说明 |
|------|-------------|------|
| 对话未超窗口 | 0 次 | 不触发压缩 |
| 首次超窗口 | 1 次 | 生成第一份摘要 |
| 后续每次超窗口 | 1 次 | 更新摘要（将旧摘要 + 新的旧消息合并） |

摘要调用使用**当前会话的同一个模型和 Provider**，不单独配置。

---

## 5. 上下文构建器

上下文构建器是协调 L1-L3 的核心模块（`agent/context.ts`）。

### 算法

```
function buildContext(session, newMessage, maxTokens):
  1. 从 DB 加载 session 的所有 messages
  2. 追加 newMessage 到列表
  3. 计算总 token 数（system + 所有消息）
  4. 如果 totalTokens < maxTokens × 0.7:
       → 直接返回全部消息（无需压缩）
  5. 否则（需要压缩）:
       a. 加载现有 summary（如果有）
       b. 确定保留最近 N 轮（从后往前，直到累积到 maxTokens × 40%）
       c. 其余旧消息 + 旧 summary → 调用 summarizer 生成新 summary
       d. 保存新 summary 到 DB
       e. 返回：[summary 作为 system 补充] + [最近 N 轮]
  6. 返回 ContextWindow { systemPrompt, summary?, messages, totalTokens }
```

### ContextWindow 数据结构

```typescript
interface ContextWindow {
  systemPrompt: string | undefined;
  summary: string | null;           // Running Summary（如果有）
  messages: NormalizedMessage[];     // 要发给 LLM 的消息（可能不是全部历史）
  totalTokens: number;              // 当前窗口的估算 token 总数
}
```

发给 LLM 时：
- `system`：systemPrompt + (summary ? `\n\n之前的对话摘要：${summary}` : "")
- `messages`：ContextWindow.messages

---

## 6. 前端会话管理

### 布局变化

Phase 1 → Phase 2 的布局升级：

```
Phase 1（全屏聊天）：
┌──────────────────────────────────────────────┐
│ ChatContainer（独占全屏）                     │
└──────────────────────────────────────────────┘

Phase 2（侧边栏 + 主区域）：
┌──────────────┬───────────────────────────────┐
│ SessionSidebar│ ChatContainer                │
│ (240px 固定)  │ (flex: 1)                    │
└──────────────┴───────────────────────────────┘
```

### 组件树

```
App.tsx
├── SessionSidebar
│   ├── NewSessionButton
│   │   点击 → POST /api/session → 创建新会话 → 切换到新会话
│   │
│   └── SessionItem × N
│       props: { session, isActive, onSelect, onDelete }
│       显示：会话标题（首条消息截取）、最后活跃时间、消息数
│       点击 → switchSession(id)
│       删除 → DELETE /api/session/:id → 从列表移除
│
└── ChatContainer（现有，不变）
    └── ... (ProviderSelector, ModelSelector, MessageList, ChatInput)
```

### 会话切换流程

```
1. 用户点击侧边栏的某个会话条目
2. 前端调用 GET /api/session/:id/messages
3. 返回该会话的完整消息历史
4. setMessages(loaded) 替换当前 messages 状态
5. 聊天界面显示该会话的历史消息
6. 用户继续对话，新消息追加到已有历史
```

### 新增 API

| 端点 | 用途 |
|------|------|
| `GET /api/sessions` | 获取所有会话列表（不含消息体，用于侧边栏） |
| `GET /api/session/:id/messages` | 获取指定会话的消息历史 |

### useChat 状态扩展

```typescript
// Phase 2 新增状态
sessions: SessionInfo[]          // 所有会话列表（侧边栏用）
activeSessionId: string | null   // 当前活跃会话

// Phase 2 新增方法
loadSessions(): void              // 加载会话列表
switchSession(id: string): void   // 切换会话（加载消息历史）
createNewSession(): void          // 新建会话
deleteSession(id: string): void   // 删除会话
```
