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
