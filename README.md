# ProtoFS (Protocol File System)

[![Rust](https://img.shields.io/badge/Rust-2024%20Edition-orange?logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8D8?logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.4.2-emerald.svg)](CHANGELOG.md)

**ProtoFS** is a high-performance, cross-platform virtual file system and encrypted cloud storage client backed by Telegram MTProto channels. It provides zero-knowledge authenticated encryption, local SQLite WAL caching, fast-path Zstandard manifests, embedded WebDAV drive mounting, pre-auth proxy routing, bidirectional folder sync, and a modern Tauri 2.0 desktop & mobile interface.

> [!WARNING]
> **Disclaimer**: ProtoFS is an independent, open-source project and is in **no way affiliated, associated, authorized, endorsed by, or in any way officially connected with Telegram FZ-LLC, Telegram Messenger Inc., or any of its subsidiaries or affiliates**. The official Telegram website can be found at [https://telegram.org](https://telegram.org).

---

## Key Features & Architecture

### 1. Zero-Knowledge Cryptography & Master Key Vault
- **Chunked AEAD Encryption**: 64 KB chunked `AES-256-GCM` authenticated stream encryption with independent chunk IVs, enabling random-access byte-range reads and instant media seeking without decrypting whole files.
- **Argon2id Key Derivation**: Hardened passphrase key derivation with randomized salts.
- **BIP-39 Recovery Phrase**: 12/24-word mnemonic seed phrase generation, validation, and disaster recovery.
- **Vault Envelope & Zeroization**: Master secret persistence via platform-secure storage (Windows DPAPI / machine-id HKDF) with memory buffers protected by `Zeroize` / `ZeroizeOnDrop`.

### 2. Virtual File System (VFS) & Embedded WebDAV
- **Parent ID Hierarchy**: $O(1)$ instantaneous moves and renames without recursive path mutations.
- **Embedded WebDAV Server (`RFC 4918`)**: Local HTTP WebDAV endpoint with on-the-fly master-key streaming decryption and byte-range support.
- **Native OS Drive Mounting**: Mount Telegram storage channels as standard Windows virtual network drives (`ProtoFS (X:)`) with automatic orphan mount cleanup on shutdown.

### 3. Telegram MTProto Engine & Chat Folder Sync
- **Real MTProto Client**: Native RPC integration via Grammers (`grammers-client`, `grammers-mtsender`) supporting direct chunked uploads, downloads, and channel creation.
- **Flexible Authentication**: Secure QR code login (`export_login_token`), SMS/Phone verification, and Telegram 2FA (Two-Step Verification) password support.
- **Chat Folder (Dialog Filter) Sync**: Automatic grouping and discovery of storage drives in dedicated Telegram chat folders.

### 4. Fast-Path Manifests & Self-Healing Disaster Recovery
- **Zstandard Compressed Manifest**: Sub-second cold starts by syncing `manifest.json.zst` pinned channel attachments tagged with `#protofs_manifest_v1` (updated in-place).
- **Debounced Manifest Flushing**: Batch operations routed through debounced flushes (20 ops or 30s timeout) to prevent Telegram `FLOOD_WAIT_X` rate limits.
- **Caption-Based Disaster Recovery**: Every file upload contains structured metadata:
  `protofs:v1;parent:<PARENT_ID>;name:<FILE_NAME>;enc:<true|false>;iv:<BASE64_IV>;hash:<SHA256_HASH>;`
  If a pinned manifest is lost or damaged, ProtoFS automatically scans channel message captions to reconstruct the full VFS hierarchy.

### 5. Multi-Protocol Pre-Auth Proxy Subsystem
- **In-Process Proxy Bridge**: In-process proxy translation layer supporting MTProto (Fake-TLS / DD / Padded Intermediate with automatic padding stripping), SOCKS5, and HTTP CONNECT proxies.
- **Pre-Auth Accessibility**: Configure and test proxies before logging in to access QR codes in restricted network environments.
- **Live Latency Diagnostics & Deep Links**: Real-time round-trip ping metrics and one-click import from `tg://proxy` or `https://t.me/proxy` URLs.

### 6. Local SQLite WAL Cache & Full-Text Search
- **SQLite WAL & Memory-Mapped I/O**: High-speed metadata and thumbnail caching with concurrent read/write transactions.
- **FTS5 Full-Text Search**: Sub-millisecond filename queries across millions of indexed files.
- **LRU Auto-Eviction**: Automatic cache disk management with pinned file protection.

### 7. Bidirectional Folder Sync & Real-Time Telemetry
- **OS File Watcher**: Incremental file synchronization using `notify` to track local directories and queue remote sync operations.
- **Transfer Engine**: High-frequency transfer progress streaming with Exponential Moving Average (EMA) speed smoothing, active queue management, and pause/cancel controls.
- **Media Preview**: Streaming decryption modal for instant viewing of audio, video, image, and text files.

---

## Workspace Structure

```
ProtoFS/
├── crates/
│   ├── protofs-core/     # Core engine: VFS, Crypto, WebDAV, MTProto, Proxy, Cache, Sync
│   ├── protofs-cli/      # Standalone CLI binary for diagnostics, manifest inspection & search
│   └── protofs-tauri/    # Tauri 2.0 desktop shell, native platform hooks & IPC commands
├── frontend/             # React 19 + TypeScript + Tailwind CSS v4 Vite client application
├── scripts/              # Version synchronization & release automation scripts
├── Cargo.toml            # Rust workspace definition
└── package.json          # Root workspace scripts & tooling
```

---

## Getting Started

### Prerequisites
- **Rust**: 1.80+ (2024 edition compatible, MSVC toolchain on Windows)
- **Node.js**: 18+ and npm

### 1. Running Desktop App (Development)
Start the frontend Vite server and native Tauri desktop shell:
```bash
# Using root npm script
npm run dev

# Or using the PowerShell dev helper (Windows)
.\dev.ps1
```

### 2. Building Packages

```bash
# Build desktop setup installer (NSIS .exe / MSI / AppImage / dmg)
npm run build:installer

# Build portable standalone executable
npm run build:portable

# Build standalone CLI binary
npm run build:cli

# Build Android APK (requires Android SDK / NDK setup)
npm run android:build:debug
```

### 3. Running Workspace Tests & Verification

```bash
# Run all Rust workspace unit and integration tests
cargo test --workspace

# Run frontend linter and TypeScript typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

---

## CLI Reference (`protofs-cli`)

The repository includes a dedicated CLI utility for low-level diagnostics, manifest inspection, and offline cache search:

```bash
# Display system architecture, version, and crypto capabilities
cargo run -p protofs-cli -- info

# Inspect a compressed Zstandard manifest snapshot
cargo run -p protofs-cli -- manifest inspect --path "path/to/manifest.json.zst"

# Search offline SQLite cache using FTS5 index
cargo run -p protofs-cli -- search --db "%APPDATA%/ProtoFS/cache.db" --drive "personal" --query "document"
```

---

## Security & Invariants

ProtoFS enforces strict zero-knowledge security guarantees:
- **Zero Plaintext Secrets**: Passwords, Telegram session strings, and master keys are never stored unencrypted. Memory buffers use `ZeroizeOnDrop`.
- **Self-Describing Captions**: Every remote Telegram message contains structured caption metadata for disaster recovery.
- **Debounced Sync**: Batch file uploads defer manifest updates to a single completion flush, preventing Telegram flood wait limits.
- **VFS & SQLite Dual-Write Consistency**: In-memory VFS trees and on-disk SQLite database caches are strictly synchronized via `SyncEngine`.

For our complete security policy and responsible disclosure guidelines, see [SECURITY.md](SECURITY.md).

---

## Contributing

We welcome contributions! Please review [CONTRIBUTING.md](CONTRIBUTING.md) for local development setup, code standards, and pull request guidelines.

---

## Disclaimer & Terms of Use

ProtoFS utilizes the Telegram API and MTProto protocol as an encrypted object storage backend. This project is not affiliated with, maintained by, or endorsed by Telegram. Users are responsible for adhering to Telegram's [Terms of Service](https://telegram.org/tos).

---

## License

This project is licensed under the [MIT License](LICENSE).
