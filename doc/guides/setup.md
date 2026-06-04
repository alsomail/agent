# 环境搭建

## 前置需求

### Node.js 22

MyAgent 需要 Node.js 22 LTS。推荐使用 `fnm`（Fast Node Manager）管理 Node.js 版本：

```bash
# 安装 fnm
curl -fsSL https://fnm.vercel.app/install | bash

# 安装并使用 Node.js 22
fnm install 22
fnm use 22
fnm default 22

# 验证版本
node --version   # 应输出 v22.x.x
npm --version    # 应输出 10.x.x
```

**备选方案：**

- **nvm**：`nvm install 22 && nvm use 22`
- **Volta**：`volta install node@22`
- **直接安装**：从 [nodejs.org](https://nodejs.org/) 下载 LTS 版本

### pnpm 11

```bash
# 通过 corepack 启用（推荐，Node.js 22 内置）
corepack enable pnpm

# 或全局安装
npm install -g pnpm@11

# 验证
pnpm --version   # 应输出 11.x.x
```

## 项目依赖安装

```bash
# 克隆项目后
cd myagent

# 安装所有依赖（protocol + service + web + 根目录）
pnpm install
```

## 验证安装

```bash
# 验证所有包可正常构建
pnpm -r run build

# 验证类型检查
pnpm run typecheck

# 验证 lint
pnpm run lint
```

## 常见问题

### Q: `pnpm install` 报错 "Unsupported engine"

检查 Node.js 版本是否 >= 22：

```bash
node --version
```

### Q: Biome 或 lefthook 安装失败

这些是可选的开发工具，不影响核心功能。可以临时跳过：

```bash
pnpm install --no-optional
```

### Q: macOS 上遇到 `gyp` 编译错误

确保安装了 Xcode Command Line Tools：

```bash
xcode-select --install
```

### Q: `tsx` 命令找不到

在 service 包目录下运行：

```bash
cd app/service && pnpm install
```

### Q: 端口 5173 或 3001 被占用

修改对应配置：
- 前端端口：编辑 `app/web/vite.config.ts` 中的 `server.port`
- 后端端口：编辑 `app/service/src/index.ts` 中的端口号
