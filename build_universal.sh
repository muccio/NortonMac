#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# NortonMac - Universal Binary Build Automation Script
# Compatible with macOS Monterey, Ventura, Sonoma, and newer
# Supports: Apple Silicon (M1/M2/M3/M4 - aarch64) and Intel (x86_64)
# ==============================================================================

echo "=========================================================="
echo "    NORTON COMMANDER FOR macOS - UNIVERSAL BINARY BUILD   "
echo "=========================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# 1. Verify Prerequisites
echo ""
echo "[1/5] Verifying build tools and dependencies..."
command -v rustup >/dev/null 2>&1 || { echo "Error: rustup is required."; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "Error: cargo is required."; exit 1; }
command -v lipo >/dev/null 2>&1 || { echo "Error: macOS lipo tool is required."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required."; exit 1; }

# 2. Check and Add Rust Targets
echo ""
echo "[2/5] Checking Rust compilation targets..."
rustup target add aarch64-apple-darwin
rustup target add x86_64-apple-darwin

# 3. Build Frontend with relative base paths
echo ""
echo "[3/5] Building React/TypeScript frontend (Vite)..."
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi
npm run build

# 4. Build Universal Binary Bundle via Tauri CLI
echo ""
echo "[4/5] Building Universal macOS Application Bundle..."
npx tauri build --target universal-apple-darwin --bundles app

# Copy bundled application to dist-macos
OUTPUT_DIR="dist-macos"
APP_NAME="NortonMac.app"
APP_BUNDLE="${OUTPUT_DIR}/${APP_NAME}"
TAURI_BUNDLE="src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP_NAME}"

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"
cp -R "${TAURI_BUNDLE}" "${APP_BUNDLE}"

# Ensure binary is marked executable and signed
MAIN_BIN="${APP_BUNDLE}/Contents/MacOS/NortonMac"
chmod +x "${MAIN_BIN}"
codesign --force --deep --sign - "${APP_BUNDLE}" || true

# 5. Verification
echo ""
echo "[5/5] Verifying Universal Binary architecture..."
echo "----------------------------------------------------------"
lipo -info "${MAIN_BIN}"
echo "----------------------------------------------------------"
file "${MAIN_BIN}"
echo "----------------------------------------------------------"

echo ""
echo "=========================================================="
echo " BUILD SUCCESSFUL! "
echo " Application bundle created at: ${APP_BUNDLE}"
echo " Icon: $(ls -l ${APP_BUNDLE}/Contents/Resources/icon.icns)"
echo " You can test it by running: open \"${APP_BUNDLE}\""
echo "=========================================================="
