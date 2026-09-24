## Description

<!-- Provide a brief description of the changes introduced by this PR. Include motivation and context. -->

Fixes #(issue number) <!-- If applicable -->

---

## Type of Change

<!-- Please check the options that apply. -->

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [ ] ✨ New feature (non-breaking change which adds functionality)
- [ ] ⚡ Performance improvement
- [ ] 🔨 Refactoring or code quality improvement
- [ ] 📚 Documentation update
- [ ] 🔧 CI / Build / Tooling change

---

## Areas Affected

- [ ] Frontend UI (`frontend/`)
- [ ] Tauri Shell & Backend Commands (`crates/protofs-tauri/`)
- [ ] Core Engine / VFS / Crypto (`crates/protofs-core/`)
- [ ] Standalone CLI (`crates/protofs-cli/`)
- [ ] Android Mobile App (`crates/protofs-tauri/gen/android/`)
- [ ] CI / Workflows / Scripts

---

## Checklist

- [ ] My code adheres to the project's code quality standards and formatting (`cargo fmt`, `rustfmt.toml`).
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` passes with zero warnings.
- [ ] Frontend linting and typechecking pass (`npm --prefix frontend run lint && npm --prefix frontend run build`).
- [ ] Workspace tests pass locally (`cargo test --workspace`).
- [ ] Security Invariants: No plaintext secrets, tokens, or encryption keys are logged or persisted unencrypted (`Zeroize` used where applicable).
- [ ] Changes are documented in [`CHANGELOG.md`](CHANGELOG.md) under `## [Unreleased]`.
- [ ] I have tested these changes on my local setup.
