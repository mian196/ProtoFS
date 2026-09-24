# Changelog

All notable changes to **ProtoFS** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### 🔧 Changed
- **User-Friendly Account Connection Label**:
  - Changed the account button status display in the sidebar from `"Testing..."` to `"Connecting..."` while MTProto connection checks are in progress.
- **Versioned Release CI Asset Packaging**:
  - Configured release workflow to inject the dynamic version string into binary and APK artifact filenames (e.g., `protofs-cli-v0.4.1-windows-x86_64.exe`, `protofs-portable-v0.4.1-windows-x86_64.exe`, `ProtoFS_v0.4.1_android.apk`).
  - Published Windows CLI, Portable GUI, and NSIS/MSI installers (`.exe` / `.msi`) directly as standalone assets without zip archive wrapping.
- **SSOT Version Bump Synchronization**:
  - Enhanced `scripts/bump-version.js` to automatically verify and synchronize `frontend/src/utils/version.ts` alongside root `package.json`, `Cargo.toml`, `frontend/package.json`, and `tauri.conf.json`.

### 🐛 Fixed
- **Android NDK Context Initialization for MTProto & DNS Resolution**:
  - Resolved Telegram login code request failure on Android where requests were dropped immediately due to `ndk-context` panicking (`android context was not initialized`).
  - Added JNI bridge `Java_com_protofs_app_MainActivity_initNdkContext` in [`crates/protofs-tauri/src/lib.rs`](crates/protofs-tauri/src/lib.rs) and invoked `initNdkContext(applicationContext)` in [`MainActivity.kt`](crates/protofs-tauri/gen/android/app/src/main/java/com/protofs/app/MainActivity.kt) on Android startup to initialize JavaVM and Context pointers for `hickory-resolver` / `ndk-context`.
- **Android APK Build & CI Packaging**:
  - Fixed root Tauri CLI script bindings for Gradle tasks and streamlined Android APK CI release workflow.
- **Linux and Cross-Platform Build**:
  - Fixed Linux and cross-platform compilation errors and linter warnings.
- **Real-Time Transfer Queue Tracking & Live Preview Synchronization**:
  - Fixed upload popup getting permanently stuck in `"uploading"` by synchronizing `transferId` across frontend [`useUploadManager.ts`](frontend/src/hooks/useUploadManager.ts) and Tauri backend [`transfers.rs`](crates/protofs-tauri/src/commands/transfers.rs).
  - Resolved event matching in [`useTransferListener.ts`](frontend/src/hooks/useTransferListener.ts) so completed and in-flight transfer progress events accurately match the active item by ID and name.
  - Added full queued items visibility (`status: 'queued'`) so all batch files appear immediately in the transfer queue drawer with accurate overall queue progress and remaining item counts.
- **Batch Upload Completion Flush & Pinned Manifest In-Place Editing**:
  - Resolved intermediate manifest uploads during large batch uploads (e.g. 1k+ files) by updating in-memory `VfsTree` and SQLite cache in real-time and deferring the remote manifest upload to a single final flush upon queue completion (`useUploadManager.ts`).
  - Fixed candidate message resolution in [`manifest.rs`](crates/protofs-core/src/mtproto/real/manifest.rs) by searching for `#protofs_manifest_v1` across channel history when recent message history consists of uploaded files.
  - Ensured `do_update_pinned_manifest` edits the existing pinned manifest message in-place with `messages.EditMessage` and automatically deletes any duplicate manifest messages, preventing channel clutter.
- **MTProto Transport Framing Translation & Padding Stripping in LocalProxyBridge**:
  - Resolved the persistent `"Connecting..."` status where MTProto proxies connected successfully at the TCP/TLS level with active ping latency, but Telegram authentication and session requests never completed.
  - Implemented bidirectional transport framing translation between Grammers' TCP Full transport format (`[full_len (4)] [seq_no (4)] [payload] [crc32 (4)]`) and upstream MTProxy Intermediate / Padded Intermediate format (`[inter_len (4)] [payload]`).
  - Added dynamic MTProto padding stripper in [`LocalProxyBridge`](crates/protofs-core/src/mtproto/proxy/bridge.rs#L484-L525) to strip upstream random padding (0–15 bytes) from Padded Intermediate responses before returning Full transport frames, preventing AES-IGE decryption failures in Grammers.
  - Aligned AES-256-CTR keystream offsets across the initial 64-byte Obfuscated2 header and ensured correct transport protocol tag selection (`0xdddddddd` vs `0xeeeeeeee`) based on the proxy secret format.
- **End-to-End MTProto & Telegram Client Proxy Routing**:
  - Implemented in-process local proxy bridge ([LocalProxyBridge](crates/protofs-core/src/mtproto/proxy/bridge.rs)) and configured `grammers-mtsender` proxy parameters to route all active MTProto sessions, authentication handshakes, QR logins, channel queries, and background sync traffic through active MTProto (Fake-TLS / DD), HTTP CONNECT, and SOCKS5 proxies.
- **Automatic Startup Proxy Latency Measurement**:
  - Automatically measured and displayed active proxy round-trip latency (`ms`) in the header badge and auth modal upon opening the application without requiring a manual "Test Connection" button click.
- **Active Proxy Propagation for Session Reconnections**:
  - Fixed account connection check and session restoration failing under proxy environments. MTProto session reconnections (`check_telegram_connection_command`, startup, and account switches) now consistently route through the active proxy configuration with a fail-fast 5–10s timeout instead of attempting direct connection.
- **Proxy Diagnostic Draft Deserialization**:
  - Resolved `missing field 'type'` error when running proxy connection diagnostics by adding `DraftProxyConfig` to [crates/protofs-tauri/src/commands/proxy.rs](crates/protofs-tauri/src/commands/proxy.rs) and mapping frontend proxy drafts into core `ProxyConfig` instances safely.
- **Disaster Recovery False Positive on Connection Loss**:
  - Prevented Disaster Recovery mode and channel deleted warnings from triggering when offline, disconnected, or experiencing network/proxy restrictions. Channel inaccessibility checks now only execute when authenticated and actively connected to Telegram.
- **Dynamic Application Version in Sidebar**:
  - Fixed hardcoded `v0.3` badge in the sidebar header to dynamically read the application version (`v0.4.1`) via `getAppVersion()`.

---

## [0.4.1] - 2026-09-22

### ✨ Added
- **Live Update Checking Engine & Packaging Detection (`crates/protofs-tauri`)**:
  - Direct integration with GitHub Releases API (`https://api.github.com/repos/mian196/ProtoFS/releases/latest`) with semver comparison and asset matching.
  - Runtime packaging detector (`detect_package_type`) identifying Portable `.exe`, NSIS Installer, MSI, AppImage, Deb, and macOS bundles.
  - Automatic download URL resolution matching the running package type and operating system.
- **Single Source of Truth (SSOT) Versioning & Automation**:
  - Injected dynamic application version from `package.json` into Vite (`__APP_VERSION__`) and frontend runtime (`getAppVersion()`).
  - Added synchronized `npm run version:bump` and `npm run version:check` automation script updating `Cargo.toml`, `package.json`, `frontend/package.json`, and `tauri.conf.json`.
- **In-App Update Modal & Silent Startup Auto-Check**:
  - Added modern `UpdateModal` dialog displaying version transition badges, packaging indicators, release notes, asset metadata, and one-click direct download.
  - Silent startup auto-check that triggers only when an update is available without annoying up-to-date popups on boot.
- **Windows NSIS Installer Bundle**:
  - Full NSIS desktop installer configuration in `tauri.conf.json` with support for both current-user and per-machine installation modes.
  - Automatic Start Menu and Desktop shortcut generation with clean uninstaller integration.
- **Dual-Artifact Build Scripts**:
  - Added `npm run build:installer` (`tauri build`) for packaging native `.exe` setup installers.
  - Added `npm run build:portable` for building standalone single-file executables.
  - Added `npm run build:cli` for building the CLI tool binary.
- **Enhanced Release CI Workflow**:
  - Configured `.github/workflows/release.yml` to automatically build, package, and upload both portable binaries (`.zip` / `.exe`) and setup installers (`.exe` / `.msi` / `.AppImage` / `.deb` / `.dmg` / `.apk`) across all supported platforms.

---

## [0.4.0] - 2026-09-22

### 🚀 Highlights & Major Capabilities

- **Embedded WebDAV Server (`RFC 4918`)**: Cross-platform local HTTP WebDAV server with master-key on-the-fly streaming decryption, chunked transfers, custom Windows Explorer volume labeling (`ProtoFS`), and auto-mount / unmount cleanup.
- **Full MTProto Telegram Storage Engine**: Real Grammers client integration for direct Telegram RPC file transfers, supporting streaming uploads/downloads, dynamic channel `access_hash` resolution, and custom chat folder (dialog filter) synchronization.
- **Pre-Auth Proxy Subsystem**: SOCKS5, HTTP, and MTProto proxy client engine with real-time latency diagnostics, SQLite persistence, deep `tg://proxy` link parsing, and pre-login accessibility.
- **Cryptographic Master Key Vault**: Argon2id KDF key derivation, DPAPI / HKDF machine-bound envelope storage, BIP-39 12/24-word recovery phrase codec, and `ZeroizeOnDrop` memory protection.
- **Disaster Recovery & Manifest Self-Healing**: Zstd-compressed manifest snapshots pinned to Telegram channels, debounced batch flushing (20 ops / 30s timeout), and self-healing VFS hierarchy rebuild scans from self-describing message captions.
- **React 19 & Tailwind Modernized UI**: Completely modular React 19 architecture with shadcn Light/Dark theming, Sonner toast notifications, animated confirmation modals, real-time transfer telemetry with EMA smoothing, and full Trash lifecycle management (restore, permanent delete, empty trash).

---

### 📦 Detailed Changes

#### ✨ Added
- **Proxy Management**:
  - SOCKS5, HTTP (CONNECT), and MTProto proxy engine with async handshake layer.
  - Connection diagnostics ping testing with latency metrics.
  - SQLite proxy configuration persistence with active proxy toggling.
  - Pre-auth proxy modal access allowing QR login behind restricted networks.
  - Telegram proxy URI parser (`tg://proxy`, `https://t.me/proxy`) supporting secret/tag formats.
- **WebDAV & Drive Mounts**:
  - Embedded RFC 4918 WebDAV HTTP server with streaming byte-range support.
  - Native Windows drive letter mounting with automatic orphan `subst` cleanup.
  - Dual-action drive presentation in sidebar with live status transit badges.
  - User-friendly display names for channels and folders in network drive view.
- **Vault & Security**:
  - BIP-39 mnemonic seed phrase generation, validation, and restoration.
  - Master key envelope encryption with zeroized in-memory key buffers.
  - Vault IPC command suite (`init_vault`, `unlock_vault`, `export_recovery_phrase`).
- **Transfer Engine & Telemetry**:
  - Throttled transfer progress emitter with Exponential Moving Average (EMA) speed smoothing.
  - Multi-file queued background uploads and cancellation controls.
  - Conflict resolution modal with native drag-and-drop file ingestion.
  - On-the-fly streaming decryption for live media preview (`MediaPreviewModal`).
- **File System & Trash Management**:
  - Trash bin lifecycle with item restoration, permanent deletion, and empty trash actions.
  - Local folder scanning and background incremental synchronization.
  - Search keyboard shortcut (`Ctrl+K` / `Cmd+K`) and mobile search overlay.
- **Android Platform Support**:
  - Core Gradle wrapper, project templates, ProGuard rules, and TauriActivity runtime.
  - Custom ProtoFS application launcher icons.

#### 🔄 Changed & Refactored
- **Architectural Submodule Decomposition**:
  - Split monolithic `commands.rs` into focused submodules (`auth`, `drive`, `files`, `proxy`, `vault`, `settings`).
  - Modularized `crates/protofs-core` transport hub, session handling, and sync primitives.
  - Refactored monolithic frontend `api.ts` into strongly typed API modules with unified facade.
  - Decomposed settings modal shell into dedicated tab components (`useSettingsStore`).
- **UI/UX Refinements**:
  - Purged legacy tactical/HUD terminology in favor of clean privacy and storage indicators.
  - Modernized Header with pure breadcrumbs and responsive upload CTAs.
  - Integrated Sonner toaster notifications across all asynchronous workflows.
  - Replaced arbitrary borders with unified design tokens and modern typography (Plus Jakarta Sans, Geist, JetBrains Mono).

#### 🐛 Fixed
- **Sync & Telegram Reliability**:
  - Fixed manifest sync to edit existing pinned messages in-place instead of creating duplicate notifications.
  - Enforced 12-character title limits on Telegram chat folders to prevent MTProto `400 MESSAGE_TOO_LONG` errors.
  - Resolved dynamic `access_hash` discovery and normalized 64-bit Telegram channel IDs.
  - Handled `NewChannelMessage` updates with instant manifest detection.
  - Preserved local database cache with disaster recovery banner when remote Telegram channels are deleted.
  - Used `INSERT OR REPLACE` for manifest batch caching to eliminate `UNIQUE` constraint collisions.
  - Synchronized Telegram captions, local SQLite cache, and VFS tree during file deletion.
- **WebDAV & VFS**:
  - Fixed Windows volume label and MountPoints2 share naming to display `ProtoFS`.
  - Prevented auto-deletion of drives during startup and eliminated TOCTOU races in drive discovery.
  - Cleaned up orphan drive mount letters on application crash or clean exit.
- **Desktop & Build System**:
  - Eliminated command prompt window popups on app launch in Windows.
  - Fixed Tauri dev command configuration and dual `lib`/`bin` crate compilation targets.
  - Resolved workspace Clippy warnings and enforced strict `-D warnings` linter pass.

---

## [0.3.0] - 2026-09-07

### ✨ Added
- Android build integration and Gradle packaging pipeline.
- Cross-platform application data directory path resolution.
- Initial mobile launcher manifest and documents provider bindings.

---
