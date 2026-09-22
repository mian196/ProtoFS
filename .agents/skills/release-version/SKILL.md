---
name: release-version
description: Automate version releases for ProtoFS: updates CHANGELOG from Unreleased, syncs version across all config files (Cargo.toml, package.json, tauri.conf.json), commits changes, tags the release (vX.Y.Z), and pushes to GitHub to trigger CI release builds.
---

# ProtoFS Release Automation Skill

Use this skill whenever the user instructs to release a new version (e.g. "release v0.4.0", "bump version to 0.4.1", "cut a release", "trigger release workflow").

---

## Target Version Files

When releasing version `<VERSION>` (e.g. `0.4.0`):

| File | Target Location / Key | Replacement |
|---|---|---|
| `Cargo.toml` | `[workspace.package]` -> `version = "..."` | `version = "<VERSION>"` |
| `package.json` | `"version": "..."` | `"version": "<VERSION>"` |
| `frontend/package.json` | `"version": "..."` | `"version": "<VERSION>"` |
| `crates/protofs-tauri/package.json` | `"version": "..."` | `"version": "<VERSION>"` |
| `crates/protofs-tauri/tauri.conf.json` | `"version": "..."` | `"version": "<VERSION>"` |
| `CHANGELOG.md` | `## [Unreleased]` | Convert to `## [<VERSION>] - <TODAY>` & prepend fresh empty `## [Unreleased]` |

---

## Release Execution Steps

### Step 1: Determine the Target Version
- If user specifies a version (e.g., `0.4.0` or `v0.4.0`), strip any leading `v` to obtain `<VERSION>`.
- If no version is specified, read the current version from `Cargo.toml` and increment the minor or patch version (semver).
- Get the current date in `YYYY-MM-DD` format (e.g., `2026-09-22`).

### Step 2: Update `CHANGELOG.md`
1. Locate `## [Unreleased]` in `CHANGELOG.md`.
2. Transform `## [Unreleased]` into:
```markdown
## [Unreleased]

---

## [<VERSION>] - <YYYY-MM-DD>
```
3. Keep existing release sections unchanged (dated releases are immutable).

### Step 3: Synchronously Bump Version Across All Manifests
Execute the SSOT version synchronization script:
```bash
npm run version:bump <VERSION>
```
Verify that all workspace manifests are in sync:
```bash
npm run version:check
```
This automatically updates `Cargo.toml`, `package.json`, `frontend/package.json`, `crates/protofs-tauri/tauri.conf.json`, and `crates/protofs-tauri/package.json` simultaneously.

### Step 4: Refresh Cargo.lock and Workspace Quality Gates
Run the following to ensure dependencies, workspace locks, and frontend builds are clean:
```bash
cargo check --workspace
npm --prefix frontend run build
```

### Step 5: Git Commit & Tag
Stage and commit the modified files:
```bash
git add Cargo.toml Cargo.lock package.json frontend/package.json crates/protofs-tauri/package.json crates/protofs-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore(release): bump version to v<VERSION>"
git tag -a "v<VERSION>" -m "Release v<VERSION>"
```

### Step 6: Push Commit and Tag to GitHub
Push the commit and the new tag to trigger `.github/workflows/release.yml`:
```bash
git push origin <CURRENT_BRANCH>
git push origin "v<VERSION>"
```

---

## Verification & Output
- Confirm git status is clean.
- Provide a summary table of updated files and the tag created.
- Provide the GitHub Actions workflow link where the release build is running.
