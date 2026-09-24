# Contributing to ProtoFS

Thank you for your interest in contributing to **ProtoFS**! We welcome contributions, bug reports, and feature proposals from the community.

Please take a few moments to review this guide before submitting code or opening pull requests.

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please be respectful, constructive, and collaborative in all discussions and code reviews.

---

## Development Environment Setup

### Prerequisites
- **Rust Toolchain**: 1.80+ (Rust 2024 edition, stable channel)
  ```bash
  rustup update stable
  rustup component add rustfmt clippy
  ```
- **Node.js**: 18+ and `npm`
- **Tauri Prerequisites**: Follow the [Tauri 2.0 Prerequisites Guide](https://v2.tauri.app/start/prerequisites/) for your operating system (C++ build tools on Windows, `webkit2gtk` dependencies on Linux).
- **Pre-commit** *(optional, recommended)*: `pip install pre-commit && pre-commit install`

### Repository Structure

```
ProtoFS/
├── crates/
│   ├── protofs-core/     # Core library: VFS, Crypto, WebDAV, MTProto, Proxy, Cache, Sync
│   ├── protofs-cli/      # Standalone CLI binary for terminal inspection & search
│   └── protofs-tauri/    # Tauri 2.0 application shell, native OS hooks & IPC commands
├── frontend/             # React 19 + TypeScript + Tailwind CSS v4 Vite client application
├── scripts/              # Version synchronization & release automation scripts
├── Cargo.toml            # Rust workspace definition
└── package.json          # Workspace development scripts
```

---

## Development Workflow

### 1. Running the App Locally
Start the frontend development server and Tauri shell concurrently:
```bash
# Using root npm script
npm run dev

# Or on Windows using PowerShell
.\dev.ps1
```

### 2. Building Standalone Targets
```bash
# Build desktop installer (NSIS .exe / MSI / AppImage / dmg)
npm run build:installer

# Build portable standalone binary
npm run build:portable

# Build standalone CLI tool
npm run build:cli

# Build Android APK (debug)
npm run android:build:debug
```

### 3. Running Verification & Tests
Before opening a pull request, verify that all tests, linters, and typechecks pass:
```bash
# 1. Rust workspace test suite
cargo test --workspace

# 2. Rust formatting check
cargo fmt --check

# 3. Strict Rust Clippy linter
cargo clippy --workspace --all-targets -- -D warnings

# 4. Frontend ESLint & TypeScript typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
```

---

## Code Quality & Architectural Rules

### Rust Backend (`crates/`)
- **Modularity**: Avoid monolithic files. Break large modules into sub-modules (`mod.rs`, `types.rs`, `handlers.rs`, `helpers.rs`) and re-export clean public APIs (`pub use`).
- **Error Handling**: Use strongly typed errors via `thiserror` (`ProtoFsError`). Avoid raw `.unwrap()` or `.expect()` calls in production paths.
- **Async Runtime**: Built on Tokio async streams. Never invoke blocking I/O calls directly inside async tasks; use `tokio::task::spawn_blocking` when required.
- **Formatting**: Adhere to [`rustfmt.toml`](rustfmt.toml) (`max_width = 100`, `reorder_imports = true`).

### Frontend (`frontend/`)
- **React & TypeScript**: React 19, TypeScript strict mode (`es2023`, `noEmit: true`).
- **Component Decomposition**: Keep components small and single-purpose. Extract sub-components, custom hooks, and focused Zustand store slices rather than accumulating logic in single files.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite`.
- **Logging**: Avoid direct `console.log` statements; use structured notifications (`sonner`) or IPC tracing events.

---

## Non-Negotiable Core Invariants

All pull requests must respect the following security and architectural invariants:

1. **Zero Plaintext Secrets**: Passwords, Telegram session tokens, proxy credentials, and master keys must never be logged or persisted unencrypted. Sensitive memory buffers must implement `zeroize::Zeroize` / `ZeroizeOnDrop`.
2. **Self-Describing Telegram Captions**: Uploaded file metadata must adhere to the disaster recovery caption format:
   `protofs:v1;parent:<PARENT_ID>;name:<FILE_NAME>;enc:<true|false>;iv:<BASE64_IV>;hash:<SHA256_HASH>;`
3. **Debounced Manifest Flushing**: Batch operations (uploads, moves, deletions) must never trigger synchronous Telegram manifest updates per item. Always route through debounced batch flushes to prevent `FLOOD_WAIT_X` rate limits.
4. **VFS Tree & SQLite Dual-Write Consistency**: In-memory `VfsTree` and SQLite `cache.db` must remain synchronized via `SyncEngine`.
5. **Pre-Auth Proxy Accessibility**: Proxy configurations and connection testing must remain operational before Telegram login.

---

## Submitting Pull Requests

1. **Branch Naming**: Use descriptive branch names:
   - `feat/feature-name`
   - `fix/bug-description`
   - `docs/documentation-update`
   - `refactor/subsystem-name`
2. **Changelog**: Keep [`CHANGELOG.md`](CHANGELOG.md) updated under the `## [Unreleased]` section following the [Keep a Changelog](https://keepachangelog.com/) format (e.g., Added, Changed, Fixed, Security). Never edit previous released version sections.
3. **Atomic Commits**: Provide clear, descriptive commit messages describing the *why* behind changes.
4. **CI Verification**: Ensure all GitHub Actions CI checks pass successfully on your branch.

---

## License

By contributing to ProtoFS, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
