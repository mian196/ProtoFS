@echo off
title ProtoFS - Live Dev Environment
echo ========================================================
echo   Starting ProtoFS Live Development Environment
echo   Frontend: Vite HMR (http://localhost:5173)
echo   Backend:  Rust Tauri IPC (Debug Mode)
echo ========================================================

set RUST_LOG=protofs_core=debug,protofs_tauri=debug,info
set RUST_BACKTRACE=1

if not exist frontend\node_modules (
    echo [*] Installing frontend dependencies...
    call npm --prefix frontend install
)

echo [*] Launching Tauri Live Dev...
call npx --prefix frontend tauri dev --config crates/protofs-tauri/tauri.conf.json %*
