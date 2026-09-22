#!/usr/bin/env node

/**
 * ProtoFS Single Source of Truth (SSOT) Version Synchronization Script.
 * Synchronously bumps or verifies version consistency across all workspace manifests:
 * - Cargo.toml ([workspace.package].version)
 * - package.json (root)
 * - frontend/package.json
 * - crates/protofs-tauri/tauri.conf.json
 * - crates/protofs-tauri/package.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const filesToSync = [
  {
    path: path.join(rootDir, 'Cargo.toml'),
    type: 'toml',
    replace: (content, version) =>
      content.replace(/(^\[workspace\.package\][\s\S]*?version\s*=\s*)"[^"]+"/m, `$1"${version}"`),
    extract: (content) => {
      const match = content.match(/^\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/m);
      return match ? match[1] : null;
    },
  },
  {
    path: path.join(rootDir, 'package.json'),
    type: 'json',
    field: 'version',
  },
  {
    path: path.join(rootDir, 'frontend', 'package.json'),
    type: 'json',
    field: 'version',
  },
  {
    path: path.join(rootDir, 'crates', 'protofs-tauri', 'tauri.conf.json'),
    type: 'json',
    field: 'version',
  },
  {
    path: path.join(rootDir, 'crates', 'protofs-tauri', 'package.json'),
    type: 'json',
    field: 'version',
  },
];

const targetVersion = process.argv[2];

if (!targetVersion) {
  console.log('ProtoFS Version Consistency Checker\n');
  let currentVersions = new Set();

  for (const file of filesToSync) {
    if (!fs.existsSync(file.path)) continue;
    const raw = fs.readFileSync(file.path, 'utf8');
    let ver = null;
    if (file.type === 'json') {
      const json = JSON.parse(raw);
      ver = json[file.field];
    } else if (file.type === 'toml') {
      ver = file.extract(raw);
    }
    const rel = path.relative(rootDir, file.path);
    console.log(`  ${rel.padEnd(45)} → v${ver}`);
    if (ver) currentVersions.add(ver);
  }

  if (currentVersions.size === 1) {
    console.log(`\n✓ All manifests synchronized at version v${Array.from(currentVersions)[0]}`);
  } else {
    console.error(`\n⚠ Version mismatch detected across workspace manifests!`);
    console.error(`Run: npm run version:bump <new-version> to fix.`);
    process.exit(1);
  }
  process.exit(0);
}

const cleanVersion = targetVersion.trim().replace(/^v/, '');
const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;

if (!semverRegex.test(cleanVersion)) {
  console.error(`Error: "${cleanVersion}" is not a valid semantic version (expected X.Y.Z or X.Y.Z-tag).`);
  process.exit(1);
}

console.log(`Bumping ProtoFS workspace version to v${cleanVersion}...\n`);

for (const file of filesToSync) {
  if (!fs.existsSync(file.path)) continue;
  const raw = fs.readFileSync(file.path, 'utf8');
  let updated = '';

  if (file.type === 'json') {
    const json = JSON.parse(raw);
    json[file.field] = cleanVersion;
    updated = JSON.stringify(json, null, 2) + '\n';
  } else if (file.type === 'toml') {
    updated = file.replace(raw, cleanVersion);
  }

  fs.writeFileSync(file.path, updated, 'utf8');
  const rel = path.relative(rootDir, file.path);
  console.log(`  Updated ${rel} → v${cleanVersion}`);
}

console.log(`\n✓ Successfully synchronized all manifests to v${cleanVersion}`);
