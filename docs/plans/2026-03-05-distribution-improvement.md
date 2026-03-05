# Distribution Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make TermiteCommander installable via `npm install -g termite-commander` and `curl | bash`, while fixing silent failures in the install command.

**Architecture:** Remove unused native dependency (better-sqlite3), add npm publishing metadata (files, engines, repository, prepublishOnly), add install.sh fallback script, and harden the `install` command with validation and error reporting.

**Tech Stack:** npm (publishing), TypeScript, bash (install.sh)

---

### Task 1: Remove unused better-sqlite3 dependency

**Files:**
- Modify: `commander/package.json:19` (remove better-sqlite3)
- Modify: `commander/package.json:27` (remove @types/better-sqlite3)

**Step 1: Remove dependencies from package.json**

Edit `commander/package.json` — remove these two lines:

```json
// In dependencies:
    "better-sqlite3": "^11.0.0",    // DELETE

// In devDependencies:
    "@types/better-sqlite3": "^7.0.0",  // DELETE
```

**Step 2: Reinstall to update node_modules and lockfile**

Run: `cd commander && npm install`
Expected: Clean install with no native compilation step

**Step 3: Build and test to confirm nothing breaks**

Run: `cd commander && npm run build && npm test`
Expected: All 50 tests pass, zero TypeScript errors

**Step 4: Commit**

```bash
git add commander/package.json
git commit -m "chore: remove unused better-sqlite3 native dependency"
```

---

### Task 2: Update package.json for npm publishing

**Files:**
- Modify: `commander/package.json`

**Step 1: Add publishing metadata to package.json**

Add these fields to `commander/package.json`:

```json
{
  "name": "termite-commander",
  "version": "0.1.0",
  "description": "Autonomous orchestration engine for the Termite Protocol — decomposes objectives into signals, dispatches to colony workers",
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
  "keywords": ["termite", "orchestration", "ai-agents", "colony", "multi-model"],
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

Key additions: `description`, `files`, `engines`, `repository`, `keywords`, `license`, `prepublishOnly`.

**Step 2: Verify npm pack includes the right files**

Run: `cd commander && npm pack --dry-run`
Expected: Output lists `dist/`, `skills/`, `plugins/`, `package.json` — no `src/`, no `node_modules/`, no test files.

**Step 3: Commit**

```bash
git add commander/package.json
git commit -m "chore: add npm publishing metadata (files, engines, repository)"
```

---

### Task 3: Add --version from package.json

**Files:**
- Modify: `commander/src/index.ts:18`

**Step 1: Verify current state**

The CLI already has `.version("0.1.0")` hardcoded at line 18. Change it to read from package.json dynamically.

**Step 2: Update index.ts to read version from package.json**

Replace the hardcoded version at line 18 with a dynamic import. Add this near the top of `commander/src/index.ts` after existing imports:

```typescript
import { readFileSync } from "node:fs";
```

Note: `readFileSync` is already imported at line 7. No new import needed.

Then add before the `program` setup:

```typescript
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8")
);
```

Then change line 18 from:

```typescript
  .version("0.1.0");
```

to:

```typescript
  .version(pkg.version);
```

**Step 3: Build and test**

Run: `cd commander && npm run build`
Expected: No errors

Run: `node dist/index.js --version`
Expected: `0.1.0`

**Step 4: Commit**

```bash
git add commander/src/index.ts
git commit -m "feat: read CLI version from package.json instead of hardcoded string"
```

---

### Task 4: Fix installSkills() silent failures

**Files:**
- Modify: `commander/src/colony/opencode-launcher.ts:57-90`
- Modify: `commander/src/index.ts:24-37`

**Step 1: Add validation to installSkills()**

Replace the `installSkills()` method in `commander/src/colony/opencode-launcher.ts` (lines 57-90). The new version:

1. Validates that source directories exist before copying
2. Counts installed files
3. Warns about missing OpenCode CLI
4. Throws on critical failures (missing termite skills source)

```typescript
  installSkills(): void {
    let installedCount = 0;

    // 1. Copy termite protocol skills → .opencode/skill/termite/
    const termiteDest = join(this.config.colonyRoot, ".opencode", "skill", "termite");
    mkdirSync(termiteDest, { recursive: true });

    const files = ["SKILL.md", "arrive.md", "deposit.md", "molt.md"];
    const missingFiles: string[] = [];
    for (const file of files) {
      const src = join(this.config.skillSourceDir, file);
      const dst = join(termiteDest, file);
      if (existsSync(src)) {
        copyFileSync(src, dst);
        installedCount++;
      } else {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length === files.length) {
      throw new Error(
        `Termite skills source not found at ${this.config.skillSourceDir}. ` +
        `Reinstall termite-commander: npm install -g termite-commander`
      );
    }
    if (missingFiles.length > 0) {
      console.warn(`[launcher] Warning: missing skill files: ${missingFiles.join(", ")}`);
    }
    console.log(`[launcher] Installed ${installedCount} termite skills to ${termiteDest}`);

    // Resolve plugins base dir (relative to skillSourceDir: ../../plugins)
    const pluginsBase = resolve(this.config.skillSourceDir, "../../plugins");

    // 2. Copy OpenCode commander skill → .opencode/skill/commander/
    const opencodeSrc = join(pluginsBase, "opencode");
    if (existsSync(opencodeSrc)) {
      const opencodeDest = join(this.config.colonyRoot, ".opencode", "skill", "commander");
      this.copyDirRecursive(opencodeSrc, opencodeDest);
      console.log(`[launcher] Installed commander skill to ${opencodeDest}`);
      installedCount++;
    } else {
      console.warn(`[launcher] Warning: OpenCode skill not found at ${opencodeSrc}`);
    }

    // 3. Copy Claude Code plugin → .claude/plugins/termite-commander/
    const claudeCodeSrc = join(pluginsBase, "claude-code");
    if (existsSync(claudeCodeSrc)) {
      const claudeCodeDest = join(this.config.colonyRoot, ".claude", "plugins", "termite-commander");
      this.copyDirRecursive(claudeCodeSrc, claudeCodeDest);
      console.log(`[launcher] Installed Claude Code plugin to ${claudeCodeDest}`);
      installedCount++;
    } else {
      console.warn(`[launcher] Warning: Claude Code plugin not found at ${claudeCodeSrc}`);
    }

    console.log(`[launcher] Installation complete: ${installedCount} components installed`);
  }
```

**Step 2: Add OpenCode check and summary to install command in index.ts**

Update the `install` action in `commander/src/index.ts` (lines 24-37):

```typescript
  .action(async (opts: { colony: string }) => {
    const { OpenCodeLauncher } = await import("./colony/opencode-launcher.js");
    const launcher = new OpenCodeLauncher({
      colonyRoot: opts.colony,
      skillSourceDir: resolve(import.meta.dirname ?? ".", "../skills/termite"),
      workerSpecs: [],
      defaultWorkerModel: "",
    });

    try {
      launcher.installSkills();
    } catch (err: any) {
      console.error(`\nInstallation failed: ${err.message}`);
      process.exit(1);
    }

    // Check OpenCode availability
    const hasOpenCode = await launcher.checkOpenCode();
    if (!hasOpenCode) {
      console.warn("\nWarning: 'opencode' CLI not found in PATH.");
      console.warn("Workers need OpenCode to run. Install: https://github.com/nicepkg/opencode");
    }

    console.log("\nCommander skills installed. Available commands:");
    console.log("  Claude Code: /commander <objective>");
    console.log("  OpenCode:    /commander <objective>");
    console.log("\nTrigger phrases: /commander, 让蚁群干活, 让白蚁施工, deploy termites");
  });
```

**Step 3: Build and test**

Run: `cd commander && npm run build && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add commander/src/colony/opencode-launcher.ts commander/src/index.ts
git commit -m "fix: report errors instead of silently skipping during skill installation"
```

---

### Task 5: Create install.sh script

**Files:**
- Create: `install.sh` (repository root)

**Step 1: Write the install script**

Create `install.sh` at the repository root:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Termite Commander Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/billbai-longarena/TermiteCommander/master/install.sh | bash

REPO="https://github.com/billbai-longarena/TermiteCommander.git"
INSTALL_DIR="${TERMITE_INSTALL_DIR:-$HOME/tools/TermiteCommander}"

echo "=== Termite Commander Installer ==="
echo ""

# 1. Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found. Install Node.js >= 18 first."
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js >= 18 required (found: $(node --version))."
  exit 1
fi

# 2. Try npm install -g first (fastest path)
echo "Trying npm install -g termite-commander..."
if npm install -g termite-commander 2>/dev/null; then
  echo ""
  echo "Installed via npm."
  termite-commander --version
  echo ""
  echo "Done! Run 'termite-commander --help' to get started."
  exit 0
fi

echo "npm registry install failed. Falling back to git clone..."
echo ""

# 3. Fallback: clone + build + link
if ! command -v git &>/dev/null; then
  echo "Error: git not found. Install git first."
  exit 1
fi

if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning to $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/commander"
echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo "Linking globally..."
npm link

echo ""

# 4. Verify
if command -v termite-commander &>/dev/null; then
  echo "Installed successfully: $(termite-commander --version)"
else
  echo "Warning: termite-commander not in PATH. You may need to restart your shell."
fi

echo ""
echo "Done! Run 'termite-commander --help' to get started."
echo ""
echo "Next steps:"
echo "  cd your-project"
echo "  termite-commander install --colony ."
```

**Step 2: Make it executable**

Run: `chmod +x install.sh`

**Step 3: Test the script syntax**

Run: `bash -n install.sh`
Expected: No output (syntax valid)

**Step 4: Commit**

```bash
git add install.sh
git commit -m "feat: add one-line install script (npm with git fallback)"
```

---

### Task 6: Update README install section

**Files:**
- Modify: `README.md:209-236` (Quick Start / Step 0 section)

**Step 1: Replace the Step 0 install instructions**

Replace the "Step 0" section (lines 218-236) with:

```markdown
### Step 0: Install Commander (one-time, global)

Commander 是全局 CLI 工具，安装一次，任何项目都能用。
Commander is a global CLI tool. Install once, use in any project.

```bash
# 推荐：npm 一键安装
npm install -g termite-commander

# 或：一键脚本（自动检测 npm，失败则 clone + build）
curl -fsSL https://raw.githubusercontent.com/billbai-longarena/TermiteCommander/master/install.sh | bash
```

验证安装：
```bash
termite-commander --version
```

> **关于 Termite Protocol**：不需要手动安装。Commander 首次运行 `--run` 时自动检测，如果目标项目没有白蚁协议，Commander 会自动从 GitHub 克隆并安装。
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update install instructions (npm + curl script)"
```

---

### Task 7: Publish to npm

**Step 1: Verify package contents one final time**

Run: `cd commander && npm pack --dry-run`
Expected: Lists dist/, skills/, plugins/, package.json. No src/, no tests, no node_modules.

**Step 2: Login to npm (if not already)**

Run: `npm login`
Expected: Authenticated

**Step 3: Publish**

Run: `cd commander && npm publish`
Expected: Package published as `termite-commander@0.1.0`

Note: `prepublishOnly` will auto-run `npm run build && npm test` before publishing.

**Step 4: Verify global install from npm**

Run: `npm install -g termite-commander && termite-commander --version`
Expected: `0.1.0`

**Step 5: Commit and push all**

```bash
git push origin master
```
