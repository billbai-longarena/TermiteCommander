#!/usr/bin/env bash
set -euo pipefail

# Termite Commander Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/billbai-longarena/TermiteCommander/master/install.sh | bash

PACKAGE_NAME="termite-commander"
REPO="https://github.com/billbai-longarena/TermiteCommander.git"
INSTALL_DIR="${TERMITE_INSTALL_DIR:-$HOME/tools/TermiteCommander}"
INSTALL_REF="${TERMITE_INSTALL_REF:-}"

resolve_install_ref() {
  if [ -n "$INSTALL_REF" ]; then
    echo "$INSTALL_REF"
    return
  fi

  if command -v npm &>/dev/null; then
    local latest
    latest=$(npm view "$PACKAGE_NAME" version 2>/dev/null || true)
    if [ -n "$latest" ]; then
      echo "v$latest"
      return
    fi
  fi

  echo "master"
}

echo "=== Termite Commander Installer ==="
echo ""

# 1. Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found. Install Node.js >= 18 first."
  exit 1
fi

if ! command -v npm &>/dev/null; then
  echo "Error: npm not found. Install npm first."
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js >= 18 required (found: $(node --version))."
  exit 1
fi

# 2. Try npm install -g first (fastest path)
echo "Installing ${PACKAGE_NAME}@latest via npm..."
set +e
npm install -g "${PACKAGE_NAME}@latest"
NPM_INSTALL_EXIT_CODE=$?
set -e
if [ "$NPM_INSTALL_EXIT_CODE" -eq 0 ]; then
  echo ""
  echo "Installed via npm."
  termite-commander --version
  echo ""
  echo "Done! Run 'termite-commander --help' to get started."
  exit 0
fi

echo "npm global install failed (exit code: ${NPM_INSTALL_EXIT_CODE})."
echo "If this was a permission (EACCES) error, configure npm to use a user-owned global prefix or use a Node version manager."
echo "Reference: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
echo ""
echo "Falling back to git checkout + npm global install from local package..."
echo ""

# 3. Fallback: clone and install as a global package
if ! command -v git &>/dev/null; then
  echo "Error: git not found. Install git first."
  exit 1
fi

RESOLVED_INSTALL_REF=$(resolve_install_ref)

if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation at $INSTALL_DIR..."
  if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo "Error: $INSTALL_DIR exists but is not a git repository."
    exit 1
  fi
  git -C "$INSTALL_DIR" fetch --tags --prune
  if git -C "$INSTALL_DIR" rev-parse --verify "$RESOLVED_INSTALL_REF^{commit}" &>/dev/null; then
    git -C "$INSTALL_DIR" checkout "$RESOLVED_INSTALL_REF"
  elif git -C "$INSTALL_DIR" rev-parse --verify "origin/$RESOLVED_INSTALL_REF^{commit}" &>/dev/null; then
    git -C "$INSTALL_DIR" checkout -B "$RESOLVED_INSTALL_REF" "origin/$RESOLVED_INSTALL_REF"
  else
    echo "Warning: ref '$RESOLVED_INSTALL_REF' not found in local checkout. Keeping current branch."
  fi
  git -C "$INSTALL_DIR" pull --ff-only || true
else
  echo "Cloning to $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if git ls-remote --exit-code --heads "$REPO" "$RESOLVED_INSTALL_REF" >/dev/null 2>&1 || \
     git ls-remote --exit-code --tags "$REPO" "$RESOLVED_INSTALL_REF" >/dev/null 2>&1; then
    git clone --depth 1 --branch "$RESOLVED_INSTALL_REF" "$REPO" "$INSTALL_DIR"
  else
    echo "Warning: ref '$RESOLVED_INSTALL_REF' not found on remote. Cloning default branch."
    git clone --depth 1 "$REPO" "$INSTALL_DIR"
  fi
fi

cd "$INSTALL_DIR/commander"
if [ ! -f "dist/index.js" ]; then
  echo "dist/ not found. Building from source..."
  npm install
  npm run build
fi
echo "Installing global package from local checkout..."
npm install -g .

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
echo "Update later with: npm update -g termite-commander"
echo ""
echo "Next steps:"
echo "  cd your-project"
echo "  termite-commander install --colony ."
