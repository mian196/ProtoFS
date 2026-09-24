# ProtoFS — AI Agent Directives & Repository Rules

This file defines the persistent instructions, architectural rules, code standards, and workflow preferences for AI assistants working within the **ProtoFS** repository.

---

## 1. Non-Negotiable Invariants & Security Rules

1. **Zero Plaintext Secrets:**

   - User passwords, Telegram auth tokens, proxy secrets, and master keys must **never** be stored as plaintext in SQLite or logs.
   - Use `zeroize::Zeroize` / `ZeroizeOnDrop` for memory buffers holding sensitive cryptographic keys.
   - Persist master secrets via platform-secure storage (Windows DPAPI / machine-id HKDF) and `VaultEnvelope`.

2. **Self-Describing Telegram Captions for Disaster Recovery:**

   - Every file uploaded to Telegram channels must include the structured caption format:
     `protofs:v1;parent:<PARENT_ID>;name:<FILE_NAME>;enc:<true|false>;iv:<BASE64_IV>;hash:<SHA256_HASH>;`
   - Never perform raw Telegram document uploads without valid metadata captions.

3. **Debounced Manifest Flushing:**

   - Bulk uploads, batch imports, and deletions must **never** trigger synchronous `flush_manifest` on each step.
   - Always route mutations through `debounced_flush_manifest` (20 ops or 30s timeout) to prevent Telegram `FLOOD_WAIT_X` rate limits.

4. **VFS Tree & SQLite Dual-Write Consistency:**

   - In-memory `VfsTree` and SQLite database (`cache.db`) must remain strictly synchronized. All structural edits must be coordinated via `SyncEngine`.

5. **Pre-Auth Accessibility for Proxies:**

   - MTProto, SOCKS5, and HTTP proxy configuration must remain usable and editable **before** the user logs in, enabling QR code fetching and auth under restricted network environments.

---

## 2. Code Quality & Standards

### Rust Backend (`crates/`)

- **Edition & Toolchain:** Rust 2024 edition, stable toolchain.
- **Modularity & Sub-Modules:** Never write massive monolithic files with thousands of lines. Split large modules into dedicated sub-modules (e.g., `feature/mod.rs`, `feature/types.rs`, `feature/handlers.rs`, `feature/helpers.rs`) and re-export clean public APIs (`pub use`).
- **Formatting:** Comply with `rustfmt.toml` (`max_width = 100`, `reorder_imports = true`).
- **Linter:** `cargo clippy --workspace --all-targets -- -D warnings` must pass with zero warnings.
- **Error Handling:** Use `thiserror` strongly-typed errors (`ProtoFsError`), avoid generic `.unwrap()` or `.expect()` in production paths.
- **Async Runtime:** Tokio with async stream abstractions; avoid blocking calls inside async tasks.

### Frontend (`frontend/`)

- **Framework & Language:** React 19, TypeScript strict mode (`es2023`, `moduleResolution: bundler`, `noEmit: true`).
- **Component & Module Decomposition:** Keep files concise and modular. Break large components and monolithic files into smaller sub-components, custom hooks, focused store slices, and domain-scoped type modules rather than piling thousands of lines into single files.
- **Styling:** Tailwind CSS v4 via `@tailwindcss/vite`.
- **State Management:** Modular Zustand stores (e.g. `useTransferStore`, `useAuthStore`).
- **Linting:** ESLint 10 + TypeScript ESLint (`npm run lint`).
- **Logging:** Direct `console.log` is disallowed; use structured notifications (`sonner`) or IPC event streaming.

### Architectural Modularity Invariants

- **File Length & Granularity:** Keep modules focused on single responsibilities. When a file grows beyond a reasonable size (~300–400 lines), extract sub-routines, helpers, and types into sub-modules.
- **Clean Interface Boundaries:** Sub-modules should expose distinct interfaces through their respective parent `mod.rs` (in Rust) or `index.ts` / barrel files (in React/TypeScript).

---

## 3. Logging & Telemetry Conventions

### 3.1 Rust Tracing Subsystem (`crates/protofs-tauri/src/lib.rs`)

- **Dual Log Dispatch:** Logs are written concurrently to `stdout` and persisted to `%APPDATA%/ProtoFS/logs/protofs.log`.
- **Environment Filtering:** Configured with `protofs_core=debug,protofs_tauri=debug,info`.
- **Logging Macros:** Use `tracing::{trace, debug, info, warn, error}` across crates; avoid raw `println!` / `eprintln!`.

### 3.2 Frontend Logging & Transfer Telemetry

- **Console Standards:** Direct usage of `console.log` is guarded by ESLint; `console.warn`, `console.error`, and `console.info` are reserved for IPC tracing.
- **Transfer Progress Streaming:** High-frequency transfer updates are streamed over Tauri event channels and aggregated in `useTransferStore` (`frontend/src/stores/useTransferStore.ts`) to calculate aggregate speed, percentage, active count, and ETAs.

---

## 4. Diagnostic & Debugging Protocol

When addressing bugs, unexpected errors, or regression reports:

1. **Investigate & Diagnose First:**
   - Inspect log outputs, active trace events, and relevant code paths.
   - State the **root cause** clearly before suggesting changes.
2. **Present Structured Solutions:**
   - Explain the trade-offs of the proposed solution.
   - When multiple paths exist, present a pros/cons comparison table.
3. **Verify & Test:**
   - Run unit/integration tests (`cargo test --workspace`, `npm --prefix frontend run lint`).
   - Validate pre-commit requirements before finalizing changes.

---

## 5. Common Development Commands

| Task                          | Command                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| **Run Desktop App (Dev)**     | `npx --prefix frontend tauri dev` or `dev.ps1` / `dev.bat` |
| **Check Rust Formatting**     | `cargo fmt --check`                                        |
| **Auto-Format Rust Code**     | `cargo fmt`                                                |
| **Rust Clippy (Strict)**      | `cargo clippy --workspace --all-targets -- -D warnings`    |
| **Run Backend Tests**         | `cargo test --workspace`                                   |
| **Frontend Lint & Typecheck** | `npm --prefix frontend run lint`                           |
| **Build Frontend**            | `npm --prefix frontend run build`                          |
| **Run Pre-Commit Hooks**      | `pre-commit run --all-files`                               |

---

## 6. AI Assistant Rules of Engagement

- **Preserve Existing Code & Comments:** Never delete unrelated comments, docstrings, or working logic unless explicitly directed.
- **Clickable Links:** Always provide clickable markdown links with line references (e.g., `[server.rs:L150-180](crates/protofs-core/src/webdav/server.rs#L150-L180)`).
- **Maintain Changelog (`CHANGELOG.md`):** Keep [CHANGELOG.md](CHANGELOG.md) updated adhering to [Keep a Changelog](https://keepachangelog.com/) format (e.g., Added, Changed, Fixed, Security).
  - **Codebase Changes Only:** Only log meaningful changes to the main codebase (core logic in `crates/`, frontend application features/fixes in `frontend/src/`, and public CLI/VFS APIs).
  - **Exclude Meta & Non-Codebase Edits:** Do **NOT** add entries for CI/CD workflow adjustments (`.github/`), README or documentation edits, developer scripts, repo configurations, or internal tooling changes.
  - **Immutable Releases vs. Unreleased:** Any version section with a release date in its title (e.g. `## [0.4.0] - 2026-09-22`) is a released, immutable version and must **never** be edited. All new features, changes, fixes, and improvements must strictly be recorded under the `## [Unreleased]` section at the top of the file.
- **No Scope Creep:** Keep modifications tightly scoped to the user's prompt.
- **Do Not Commit Unprompted:** Propose changes and prepare artifacts first; only modify files or commit to the repo when instructed.

---
