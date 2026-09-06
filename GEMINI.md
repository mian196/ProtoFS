# ProtoFS Project Guidelines and Instructions

This document specifies the operational rules, architectural principles, build processes, and coding standards for the ProtoFS repository. All AI agents and developers working on this project must strictly adhere to these instructions.

---

## 1. Core Behavioral Rules

1. **Zero Em Dashes Rule**:
   - Strictly do not use em dashes (`—`) anywhere in this project: not in commit messages, documentation, code comments, UI copy, or agent responses.
   - Use standard hyphens (`-`), colons (`:`), or parentheses instead.

2. **Frequent Atomic Git Commits**:
   - Commit code immediately after completing each discrete feature, bug fix, or refactoring step.
   - Never batch multiple unrelated changes into a single commit.
   - Write clear, conventional commit messages (e.g., `feat(...)`, `fix(...)`, `ci(...)`, `chore(...)`).

3. **Production Completeness**:
   - Never leave placeholder buttons, empty stub handlers, or broken bypasses in user interfaces.
   - All features must adhere to the project specifications in `local-docs/PRD.md`.
   - The application must always support the full lifecycle: onboarding/login, drive creation, file/folder operations, search, offline caching, and trash management.

---

## 2. Project Architecture

ProtoFS is structured as a Cargo workspace with resolver 2 and a modern TypeScript frontend:

```
ProtoFS/
├── Cargo.toml                    # Root workspace manifest (resolver = "2")
├── crates/
│   ├── protofs-core/             # Core VFS, SQLite cache, Crypto, Sync Engine, MTProto
│   │   ├── src/cache/            # SQLite WAL cache with FTS5 search and LRU eviction
│   │   ├── src/crypto/           # 64KB chunked AES-256-GCM (STREAM) + Argon2id KDF
│   │   ├── src/manifest/         # Compressed Zstandard manifest snapshots (manifest.json.zst)
│   │   ├── src/mtproto/          # MTProto client abstraction and mock/real transport
│   │   ├── src/sync/             # Bidirectional sync engine and native OS watcher
│   │   └── src/vfs/              # Parent-ID based virtual file system tree
│   ├── protofs-cli/              # Command-line interface binary (mount, ls, upload, sync)
│   └── protofs-tauri/            # Tauri 2.0 desktop and mobile application shell
│       ├── src/commands.rs       # Native IPC commands exposed to the frontend
│       ├── src/main.rs           # Application entrypoint and IPC handler registry
│       ├── tauri.conf.json       # Tauri 2.0 configuration
│       └── build.rs              # Tauri build script
├── frontend/                     # Web application UI (Vite + TypeScript + Vanilla CSS)
│   ├── src/api.ts                # IPC bridge connecting UI to native Tauri commands
│   ├── src/main.ts               # Core app controller, login flow, and VFS explorer
│   ├── src/style.css             # Theme tokens, dark/light modes, and UI styles
│   └── src/types.ts              # TypeScript interface definitions
├── local-docs/                   # Specifications, PRD, and architectural documentation
└── .github/workflows/            # CI/CD workflows for linting, testing, and releases
```

---

## 3. Key Technical Invariants

1. **Virtual File System (Parent ID Pattern)**:
   - File and folder nodes store an immutable `parent_id`, never deep absolute paths in captions.
   - Renaming or moving folders does not alter child nodes, preventing massive cascade updates.

2. **Zero-Knowledge Stream Encryption**:
   - Files are encrypted into sequential 64KB chunks using `AES-256-GCM` with individual authentication tags and incrementing nonce counters (STREAM construction).
   - Enables random-access byte-range seeking (HTTP 206) for video streaming and document previews without decrypting the entire file.
   - Master key is derived using Argon2id from the user passphrase with salt.

3. **Fast-Path Manifest and SQLite Cache**:
   - Pinned `manifest.json.zst` provides sub-second cold starts from Telegram CDN.
   - In-memory VFS updates commit immediately to local SQLite in WAL mode with FTS5 indexing.
   - Fallback self-healing scanner reconstructs the tree from message captions if the manifest is damaged.

4. **Tauri Custom Protocol Requirement**:
   - In `crates/protofs-tauri/Cargo.toml`, `custom-protocol = ["tauri/custom-protocol"]` must remain enabled by default.
   - This ensures production builds embed `frontend/dist` directly into the binary rather than falling back to development devUrl (`localhost:5173`).

---

## 4. Build, Test, and Packaging Workflows

### A. Development Mode (Hot Reloading)
For active development with instant UI hot-reloading:
```powershell
# Terminal 1: Launch Vite development server (port 5173)
cd frontend
npm run dev

# Terminal 2: Run Tauri application in debug mode
cargo run -p protofs-tauri
```
*Note: Tauri dev mode connects directly to `http://localhost:5173`. Do not close the Vite dev server while the debug window is open.*

### B. Frontend Verification & Production Build
```powershell
cd frontend
npm run lint        # Type check without emission (TypeScript)
npm run build       # Validates types and compiles production bundle to frontend/dist
```

### C. Rust Workspace Verification
```powershell
cargo check --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

### D. Building the Standalone Portable GUI Application
To compile the standalone, portable GUI application (no installation required):
```powershell
# 1. Compile frontend distribution
cd frontend
npm run build
cd ..

# 2. Compile release binary with embedded assets
cargo build --release -p protofs-tauri
```
* **Output Binary**: `target/release/protofs-tauri.exe` (Windows) or `target/release/protofs-tauri` (Linux/macOS).
* The release binary embeds `frontend/dist` directly using Tauri custom-protocol and does not require Vite or any local server.

### E. Building Platform Installers (NSIS Setup, MSI, AppImage, DMG)
```powershell
cd frontend
npm run build
npm run tauri -- build --config ../crates/protofs-tauri/tauri.conf.json
```
* **Windows Outputs**:
  * `target/release/bundle/nsis/ProtoFS_*_x64-setup.exe`
  * `target/release/bundle/msi/ProtoFS_*_x64_en-US.msi`

### F. CLI Binary
```powershell
cargo build --release -p protofs-cli
```
* **Output**: `target/release/protofs-cli.exe`

---

## 5. UI/UX and Dynamic Interface Checklist

1. **Authentication Flow**:
   - Always verify session state on startup. Never bypass unauthenticated sessions with cached mock credentials.
   - If unauthenticated, show the Telegram MTProto onboarding screen (API ID, API Hash, phone number, verification code, optional 2FA password).
   - Provide a 1-click Quick Test / Demo Mode button for instant local evaluation without Telegram API keys.

2. **Account Management & Theme Customization**:
   - Header profile avatar displaying user initials and phone or handle.
   - Dropdown menu with account details, zero-knowledge encryption status, and logout button that returns to the onboarding screen.
   - Theme toggle (Dark / Light) and Palette cycler (Telegram Blue, Cyber Aurora, Emerald Glacier, Sunset Flare, Obsidian Pure).

3. **Dynamic UI Behaviors**:
   - **Floating Selection Action Bar**: Must appear dynamically only when one or more items are selected. Displays selection count, Download, Move, Pin, and Delete buttons. Auto-dismisses when selection is cleared.
   - **Reactive Transfer Progress Dock**: Slides up dynamically only during active file uploads or downloads. Shows item-by-item progress bars, transfer speeds, and status. Automatically dismisses when all transfers complete.
   - **Dynamic View Modes**: Seamless toggle between responsive Grid mode and structured List mode.
   - **Live Search Overlay**: Instant FTS5 search dropdown on `Ctrl+K` or search input, showing real-time file matches and navigation.

4. **File Browser & VFS Operations**:
   - Breadcrumbs navigation with root and child folder traversal.
   - Interactive modals for folder creation, file uploads with client-side encryption toggle, node renaming, and moving between folders.
   - In-app media preview for images, video seeking, documents, and code snippets.
   - Offline pin toggle to protect cached files from LRU auto-eviction.

5. **Trash & Safety Lifecycle**:
   - Soft-delete to Trash with 30-day retention countdown.
   - Restore action to return nodes to their original parent folder.
   - Empty Trash action for permanent purge.

6. **Sync Pairs & Storage Dashboard**:
   - Directory sync pairs with one-way and two-way modes, sync status, and manual "Sync Now" trigger.
   - Storage usage dashboard with category breakdowns (Photos, Videos, Documents, Archives, Audio, Other) and local cache quota stats.
