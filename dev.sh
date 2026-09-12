#!/usr/bin/env bash
set -e

echo "========================================================"
echo "  Starting ProtoFS Live Development Environment"
echo "  Frontend: Vite HMR (http://localhost:5173)"
echo "  Backend:  Rust Tauri IPC (Debug Mode)"
echo "========================================================"

export RUST_LOG="protofs_core=debug,protofs_tauri=debug,info"
export RUST_BACKTRACE="1"

if [ ! -d "frontend/node_modules" ]; then
    echo "[*] Installing frontend dependencies..."
    npm --prefix frontend install
fi

echo "[*] Launching Tauri Live Dev..."
cd frontend
npx tauri dev --config ../crates/protofs-tauri/tauri.conf.json "$@"
