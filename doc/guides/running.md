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
