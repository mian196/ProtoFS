# Security Policy

The **ProtoFS** team takes the security and privacy of our users and their data very seriously. This document outlines our vulnerability reporting process, supported versions, and security architecture guidelines.

---

## Supported Versions

We provide security updates and bug fixes for the latest active minor release. We recommend all users keep their client updated to the latest available version.

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| < 0.4.0 | :x:                |

---

## Reporting a Vulnerability

If you discover a security vulnerability or sensitive privacy issue in ProtoFS, please **do not open a public GitHub issue**.

Instead, please report vulnerabilities privately using one of the following methods:

1. **GitHub Private Vulnerability Reporting**: Submit a private advisory via [GitHub Security Advisories](https://github.com/mian196/ProtoFS/security/advisories/new).
2. **Email**: Send detailed vulnerability details, reproduction steps, and Proof of Concept (PoC) to the repository maintainer.

### What to Include in Your Report

To help us triage and resolve the issue quickly, please include:
- A clear description of the vulnerability and its potential impact.
- Affected components (e.g. `crates/protofs-core/crypto`, `crates/protofs-tauri/commands/vault.rs`, `LocalProxyBridge`, WebDAV server).
- Step-by-step reproduction steps or a minimal Proof-of-Concept (PoC).
- Platform and environment details (OS, ProtoFS version, Telegram MTProto session type).
- Any proposed remediation or patch, if available.

### Response Timelines

- **Initial Acknowledgment**: Within **48 hours** of report receipt.
- **Triage & Severity Assessment**: Within **5 business days**.
- **Fix & Coordinated Disclosure**: We aim to release a patched version within **14–30 days**, followed by a public advisory crediting the reporter (unless anonymity is requested).

---

## Security Architecture & Invariants

ProtoFS is designed with zero-knowledge cloud storage principles. Security audits and contributions should take into account the following architectural invariants:

### 1. Zero Plaintext Secrets
- Master keys, user passphrases, Telegram auth session strings, and proxy credentials must **never** be written to logs, console output, or plaintext database fields.
- Key buffers held in memory must use `zeroize::Zeroize` / `ZeroizeOnDrop` to purge cryptographic material upon deallocation.
- Master keys are persisted inside `VaultEnvelope` using platform-native hardware/OS encryption (Windows DPAPI / machine-id HKDF).

### 2. Authenticated Chunked Stream Encryption
- Files are encrypted client-side using `AES-256-GCM` in 64 KB authenticated chunks with independent Initialization Vectors (IVs) and Argon2id key derivation.
- Telegram servers only receive ciphertext blobs and cryptographic checksums; raw plaintext never traverses MTProto unencrypted.

### 3. MTProto Transport & Proxy Isolation
- In-process proxy bridges ([`LocalProxyBridge`](crates/protofs-core/src/mtproto/proxy/bridge.rs)) enforce proper frame delineation, padding stripping, and obfuscation headers for Fake-TLS and MTProto proxies to protect against traffic correlation and replay attacks.

### 4. IPC & Command Isolation
- The Tauri desktop shell enforces strict IPC command boundary validation, ensuring all filesystem paths, drive IDs, and channel references are validated against traversal attacks (`../`).

---

## Disclaimer

ProtoFS is an independent, open-source project and is **not affiliated with, endorsed by, or sponsored by Telegram FZ-LLC or Telegram Messenger Inc.**
