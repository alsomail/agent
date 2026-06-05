# Phase 4：工作记忆 + 高级记忆系统

> 状态：⬜ 规划中
> 前置依赖：Phase 2（L1-L3 记忆基础）、Phase 3（工具系统）

---

## 目标

实现 Agent 记忆体系的 L4-L6 层级。Phase 2 已完成 L1-L3（对话历史、上下文窗口、Running Summary），本阶段在此基础上构建更高级的记忆能力。

> 记忆体系全景见 [记忆体系架构 §1](../../architecture/memory-system.md#1-记忆体系全景)

---

## L4 工作记忆 (Working Memory / Scratchpad)

### 是什么
Agent 在对话中**主动提取和存储**结构化事实，区别于 L1 的原始消息历史。

### 示例
```
对话历史（L1）:
  user: "我是北京的前端工程师，喜欢 React"
  assistant: "好的..."

工作记忆（L4）:
  { key: "用户职业", value: "前端工程师" }
  { key: "用户位置", value: "北京" }
  { key: "技术偏好", value: "React" }
```

### 为什么需要
- 对话历史会被压缩/截断，但关键事实不应丢失
- 结构化事实比原始文本更易检索和利用
- Agent 可以主动查询"我知道什么"

### 实现方向
- 工具：`remember_fact(key, value)`, `recall_facts(query)`
- 与 Phase 3 的工具系统集成（作为内置工具注册）
- 存储：SQLite `facts` 表（sessionId, key, value, confidence, createdAt）

---

## L5 跨会话记忆 (Cross-Session Memory)

### 是什么
L4 的工作记忆限于单个会话。L5 将记忆**跨会话共享**——新会话能想起旧会话学到的东西。

### 工作流
```
会话 A 结束
  → 提炼关键事实到"记忆库"

会话 B 开始
  → 检索记忆库中与当前话题相关的事实
  → 注入 system prompt 或上下文
```

### 技术要素
- Embedding 模型：将事实转为向量
- 向量检索：sqlite-vec（SQLite 向量扩展）或独立向量库
- 相关性排序：cosine similarity
- 注入策略：检索 top-K 相关记忆，拼入 system prompt

---

## L6 长期记忆 (Long-term Memory)

### 是什么
跨会话记忆的"蒸馏"——从大量事实中提炼出**规律和模式**。

### 示例
```
跨会话记忆（L5，原始事实）:
  - 用户在会话 A 说喜欢简洁的代码风格
  - 用户在会话 B 要求少用注释
  - 用户在会话 C 选择了 Biome 而非 ESLint

长期记忆（L6，提炼后）:
  - 用户偏好：极简编码风格，重视工具链效率
```

### 技术要素
- 定期整理：合并相似事实、解决冲突
- 遗忘机制：长期未引用的记忆降低权重
- 用户画像：从记忆中构建结构化的用户模型

### 复杂度评估
这是研究前沿领域，需要：
- 记忆合并算法
- 冲突解决策略
- 遗忘曲线建模
- 需要到 Phase 4 时再详细设计

---

## 依赖关系

```
Phase 2 (L1-L3) ── 必须 ──► Phase 4 (L4)
Phase 3 (工具系统) ── 必须 ──► Phase 4 (L4 的 remember/recall 是工具)
Phase 4 (L4) ── 必须 ──► L5 跨会话
L5 ── 必须 ──► L6 长期记忆
```
