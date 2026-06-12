# 运行方式

## 开发模式

### 一键启动（推荐）

```bash
./app/dev.sh
```

这会同时启动：
- 前端开发服务器：http://localhost:5173
- 后端服务：http://localhost:3001

### 分别启动

```bash
# 终端 1：后端
pnpm --filter @myagent/service dev

# 终端 2：前端
pnpm --filter @myagent/web dev
```

## 生产构建

```bash
# 构建所有包
pnpm -r run build

# 仅构建 protocol
./app/codegen.sh build
```

## 代码检查

```bash
# Lint + Format
pnpm run lint

# 类型检查
pnpm run typecheck

# 测试
pnpm run test
```

## 日志查看

服务端日志会同时输出到：

- 当前运行终端（开发时最直观）
- `.data/logs/service.log`（持久化日志文件）

常用查看方式：

```bash
# 持续追踪最新日志
tail -f .data/logs/service.log

# 只看最近 100 行
tail -n 100 .data/logs/service.log
```

关键日志类型：

- `HTTP request completed`：每个请求的 method、path、status、耗时
- `Outbound chat payload`：真正发送给模型的完整 payload
- `Recovering stale busy session`：自动恢复数据库里残留的 streaming 会话
- `Unhandled service error` / `Chat stream failed`：服务端异常
