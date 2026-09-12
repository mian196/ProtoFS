# ProtoFS Live Development Launcher
# Starts Vite frontend HMR server and Rust Tauri debug backend

$Host.UI.RawUI.WindowTitle = "ProtoFS - Live Dev Environment"
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Starting ProtoFS Live Development Environment         " -ForegroundColor Cyan
Write-Host "  Frontend: Vite HMR (http://localhost:5173)           " -ForegroundColor Yellow
Write-Host "  Backend:  Rust Tauri IPC (Debug Mode)                 " -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

$env:RUST_LOG = "protofs_core=debug,protofs_tauri=debug,info"
$env:RUST_BACKTRACE = "1"

# Check node modules
if (-not (Test-Path "frontend/node_modules")) {
    Write-Host "[*] Installing frontend dependencies..." -ForegroundColor Green
    npm --prefix frontend install
}

Write-Host "[*] Launching Tauri Live Dev..." -ForegroundColor Green
npx --prefix frontend tauri dev --config crates/protofs-tauri/tauri.conf.json $args
