# ProtoFS (Protocol File System)

ProtoFS is a high-performance, cross-platform virtual file system and cloud storage client backed by Telegram MTProto channels. It provides zero-knowledge encrypted cloud storage with local SQLite caching, fast-path Zstandard manifests, real-time directory synchronization, and a modern Tauri 2.0 desktop and mobile interface.

---

## Key Features

1. **Virtual File System (VFS)**:
   - Parent ID tree data model supporting instant O(1) file and folder renames and moves without rewriting deep path hierarchies.
   - Dual-mode metadata serialization with compressed snapshots and machine-readable message captions.

2. **Zero-Knowledge Stream Encryption**:
   - 64 KB chunked `AES-256-GCM` authenticated stream encryption.
   - Independent chunk IVs enabling random-access range reads and instant video seeking without decrypting entire multi-gigabyte payloads.
   - Argon2id key derivation from user passphrases with random salts.

3. **Fast-Path Zstandard Manifests & Self-Healing Sync**:
   - `manifest.json.zst` pinned channel attachments for sub-second cold starts.
   - Backward scan fallback that rebuilds the entire file tree from MTProto message captions if the pinned manifest is missing or damaged.

4. **Local SQLite WAL Cache & LRU Auto-Eviction**:
   - SQLite cache with Write-Ahead Logging (WAL) and memory-mapped I/O.
   - `FTS5` full-text search index for sub-millisecond filename queries.
   - Automated LRU cache eviction engine with pinned file protection.

5. **Bidirectional Native Sync Watcher**:
   - OS file watcher (via `notify`) monitoring registered local folders (e.g. Camera DCIM or workspace directories) and queuing upload tasks automatically.

6. **Tauri 2.0 Cross-Platform UI**:
   - Modern, responsive Vite + TypeScript frontend.
   - WCAG AA compliant color palettes (Nordic Frost, Cyberpunk Neon, Forest Slate, Obsidian Amber).
   - Seamless Desktop multi-pane explorer and Android mobile layout toggle.
   - Dynamic IPC bridge connecting frontend calls to the native Rust runtime.

---

## Workspace Architecture

```
ProtoFS/
├── crates/
│   ├── protofs-core/     # Core library: VFS, Crypto, Manifest, Cache, MTProto, Sync
│   ├── protofs-cli/      # Standalone CLI binary for terminal operations
│   └── protofs-tauri/    # Tauri 2.0 application shell and IPC commands
├── frontend/             # Vite + TypeScript + Vanilla CSS client application
├── local-docs/           # PRD specifications and interactive UI prototypes
└── README.md
```

---

## Getting Started

### Prerequisites
- Rust 1.80+ (MSVC toolchain on Windows)
- Node.js 18+ and npm

### 1. Running Workspace Tests
Run all unit and integration tests across all workspace crates:
```bash
cargo test --workspace
```

### 2. Using the CLI (`protofs-cli`)
Build and run the standalone command-line interface:
```bash
# View system info and supported features
cargo run -p protofs-cli -- info

# Mount a Telegram channel as a virtual drive
cargo run -p protofs-cli -- mount --channel-id -1001928472910 --mount-point X:

# List files in a drive
cargo run -p protofs-cli -- ls --drive-id personal --path /

# Upload an encrypted file
cargo run -p protofs-cli -- upload --file "D:\Backups\archive.tar.gz" --drive-id personal --encrypt

# Register an automated sync pair
cargo run -p protofs-cli -- sync --local "C:\Users\User\Pictures\Camera" --remote "f_camera" --mode one-way
```

### 3. Running the Frontend
Start the local Vite development server:
```bash
cd frontend
npm install
npm run dev
```

Build the production distribution bundle:
```bash
cd frontend
npm run build
```

---

## Design Principles

- **Zero-Knowledge Privacy**: Plaintext files and master encryption keys never touch Telegram servers unencrypted.
- **Strict Antislop Aesthetics**: High contrast typography, curated color palettes, responsive touch targets, and zero bloated frameworks.
- **Resilience**: Every channel operation contains cryptographic checksums (SHA-256) and fallback self-healing scanners.

---

## License
MIT License.
