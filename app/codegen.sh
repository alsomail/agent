#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTOCOL_DIR="$SCRIPT_DIR/protocol"
DIST_DIR="$PROTOCOL_DIR/dist"
SERVICE_GEN_DIR="$SCRIPT_DIR/service/src/generated"
WEB_GEN_DIR="$SCRIPT_DIR/web/src/generated"

print_help() {
  echo "MyAgent 协议代码生成工具"
  echo ""
  echo "用法: $0 <command> [options]"
  echo ""
  echo "命令:"
  echo "  build             编译 protocol 包（tsc → dist/）"
  echo "  generate          完整生成：build + 生成客户端类型"
  echo "  generate --client 生成 typed fetch 客户端到 web/src/generated/"
  echo "  clean             清理所有生成文件"
  echo "  validate          仅类型检查，不产出文件"
  echo ""
  echo "示例:"
  echo "  $0 build"
  echo "  $0 generate"
  echo "  $0 clean"
}

build_protocol() {
  echo "📦 编译 protocol 包..."
  cd "$PROTOCOL_DIR" && pnpm run build
  echo "✅ protocol 编译完成 → $DIST_DIR"
}

validate_protocol() {
  echo "🔍 类型检查 protocol 包..."
  cd "$PROTOCOL_DIR" && pnpm run typecheck
  echo "✅ 类型检查通过"
}

generate_client() {
  echo "🔧 生成客户端代码..."
  mkdir -p "$WEB_GEN_DIR"

  # 生成 SSE 客户端类型辅助文件
  cat > "$WEB_GEN_DIR/client-types.ts" << 'EOF'
// 自动生成 - 请勿手动编辑
// 生成时间: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
// 来源: app/protocol/src/

import type {
  StreamEvent,
  TextDeltaEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolResultEvent,
  StateChangeEvent,
  ErrorEvent,
  DoneEvent,
  Message,
  ChatRequest,
  Session,
  CreateSessionRequest,
  SendMessageRequest,
} from "@myagent/protocol";

export type {
  StreamEvent,
  TextDeltaEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolResultEvent,
  StateChangeEvent,
  ErrorEvent,
  DoneEvent,
  Message,
  ChatRequest,
  Session,
  CreateSessionRequest,
  SendMessageRequest,
};
EOF

  echo "✅ 客户端代码生成完成 → $WEB_GEN_DIR"
}

clean() {
  echo "🧹 清理生成文件..."

  if [ -d "$DIST_DIR" ]; then
    rm -rf "$DIST_DIR"
    echo "  已删除: $DIST_DIR"
  fi

  # 删除 tsc 增量编译缓存，否则下次 build 会跳过编译
  if [ -f "$PROTOCOL_DIR/tsconfig.tsbuildinfo" ]; then
    rm -f "$PROTOCOL_DIR/tsconfig.tsbuildinfo"
    echo "  已删除: tsconfig.tsbuildinfo"
  fi

  if [ -d "$SERVICE_GEN_DIR" ]; then
    rm -rf "$SERVICE_GEN_DIR"
    echo "  已删除: $SERVICE_GEN_DIR"
  fi

  if [ -d "$WEB_GEN_DIR" ]; then
    rm -rf "$WEB_GEN_DIR"
    echo "  已删除: $WEB_GEN_DIR"
  fi

  echo "✅ 清理完成"
}

# 主入口
case "${1:-help}" in
  build)
    build_protocol
    ;;
  generate)
    build_protocol
    if [[ "${2:-}" == "--client" ]]; then
      generate_client
    fi
    echo "✅ 完整生成完成"
    ;;
  clean)
    clean
    ;;
  validate)
    validate_protocol
    ;;
  help|--help|-h)
    print_help
    ;;
  *)
    echo "❌ 未知命令: $1"
    print_help
    exit 1
    ;;
esac
