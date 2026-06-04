#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "====================================="
echo "  🤖 MyAgent 开发环境启动"
echo "====================================="

# 检查前置依赖
command -v pnpm >/dev/null 2>&1 || { echo "❌ 需要 pnpm，请先安装: npm i -g pnpm"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ 需要 Node.js"; exit 1; }

# 检查 .env 文件
if [ ! -f "$PROJECT_ROOT/.env" ]; then
  echo "⚠️  未检测到 .env 文件，从 .env.example 复制..."
  cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
  echo "📝 请编辑 .env 文件填入你的 API 密钥"
fi

cd "$PROJECT_ROOT"

# 安装依赖（如果 node_modules 不存在）
if [ ! -d "node_modules" ]; then
  echo "📦 首次运行，安装依赖..."
  pnpm install
fi

# 构建 protocol 包（两端都依赖它的类型）
echo "📦 构建 protocol 包..."
pnpm --filter @myagent/protocol build

echo ""
echo "🚀 启动服务..."
echo "   前端: http://localhost:5173"
echo "   后端: http://localhost:3001"
echo "   健康检查: http://localhost:3001/api/health"
echo ""

# 并行启动，任一崩溃则全部停止
exec npx concurrently \
  --kill-others-on-fail \
  --names "web,svc" \
  --prefix-colors "cyan,magenta" \
  --prefix "[{name}]" \
  "pnpm --filter @myagent/web dev" \
  "pnpm --filter @myagent/service dev"
