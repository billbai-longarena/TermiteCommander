# Distribution Improvement Design

**Date**: 2026-03-05
**Status**: Approved

## Problem

TermiteCommander 当前只能通过手动 git clone + npm link 安装，存在以下问题：

1. 4 步手动操作（clone → npm install → build → link），容易出错
2. 符号链接脆弱，移动/删除仓库目录就断
3. 更新靠 `git pull && npm run build`，容易忘记 build
4. `npm link` 不会自动 build，可能运行过期的 dist/
5. `termite-commander install` 安装 skills/plugins 静默失败
6. `better-sqlite3` 是 native C++ 模块但代码里未使用，白增安装复杂度

## Solution

npm 发布为主要分发方式，install.sh 脚本为备选。同时修复静默失败等问题。

## Design

### 1. 移除无用依赖

`better-sqlite3` 在代码中未被 import。Commander 通过 shell 调用系统 `sqlite3` CLI 操作数据库。移除这个 native 依赖，npm install 零编译。

同时移除 `@types/better-sqlite3`。

### 2. package.json 改造

```json
{
  "name": "termite-commander",
  "version": "0.1.0",
  "description": "Autonomous orchestration engine for the Termite Protocol",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "termite-commander": "dist/index.js"
  },
  "files": [
    "dist/",
    "skills/",
    "plugins/"
  ],
  "engines": {
    "node": ">=18"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/billbai-longarena/TermiteCommander.git",
    "directory": "commander"
  },
  "keywords": ["termite", "orchestration", "ai-agents", "colony"],
  "license": "MIT",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build && npm test"
  }
}
```

关键字段：
- `files`: 明确列出发布内容。dist/（编译产物）+ skills/ + plugins/（安装到目标项目的资源）
- `engines`: 声明 Node >= 18
- `repository`: 指向 monorepo 中的 commander 子目录
- `prepublishOnly`: 发布前自动 build + test，防止发布损坏的包

### 3. 新增 --version 命令

在 CLI 入口添加 `termite-commander --version`，从 package.json 读取版本号。方便调试和确认安装版本。

### 4. 修复 install 命令静默失败

当前 `installSkills()` 在源文件缺失时静默跳过。改为：

- 检查 skills/plugins 源目录存在，缺失则报错退出
- 安装完成后汇报实际安装的文件清单
- 检查 OpenCode CLI 是否在 PATH 中，缺失则警告（不阻断，因为用户可能稍后安装）

### 5. install.sh 脚本

放在仓库根目录 `install.sh`。用法：

```bash
curl -fsSL https://raw.githubusercontent.com/billbai-longarena/TermiteCommander/master/install.sh | bash
```

逻辑：
1. 检查 Node >= 18，不满足则报错退出
2. 尝试 `npm install -g termite-commander`
3. 如果 npm 安装失败，回退到 clone + build + npm link
4. 验证 `termite-commander --version` 可执行
5. 打印安装成功信息和下一步指引

### 6. README 更新

安装说明改为：

```markdown
## Install

npm install -g termite-commander

# 或一键脚本
curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
```

## Not Included

- GitHub Actions CI/CD（当前手动 npm publish 即可，后续按需添加）
- 协议自动安装的改动（当前两级策略 local → GitHub 已足够）
- Docker 镜像（暂无需求）

## Implementation Order

1. 移除 better-sqlite3 + @types/better-sqlite3
2. 更新 package.json（files, engines, repository, prepublishOnly 等）
3. 添加 --version 命令
4. 修复 installSkills() 静默失败
5. 创建 install.sh 脚本
6. 更新 README 安装说明
7. npm publish
