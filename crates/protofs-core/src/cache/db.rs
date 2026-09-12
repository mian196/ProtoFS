use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::error::Result;
use crate::manifest::snapshot::ManifestSnapshot;
use crate::vfs::model::{FileNode, FolderNode, VfsNode};
use crate::vfs::tree::VfsTree;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub drive_id: String,
    pub name: String,
    pub kind: String,
    pub parent_id: String,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPairEntry {
    pub id: String,
    pub local_path: String,
    pub remote_folder_id: String,
    pub drive_id: String,
    pub sync_mode: String,
    pub last_synced_at: DateTime<Utc>,
}

#[derive(Clone)]
pub struct CacheDatabase {
    conn: Arc<Mutex<Connection>>,
}

impl CacheDatabase {
    fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| {
            crate::error::ProtoFsError::Vfs("Cache database lock poisoned".to_string())
        })
    }

    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.lock_conn()?;

        // Enable WAL mode and performance pragmas safely
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "synchronous", "NORMAL");
        let _ = conn.pragma_update(None, "foreign_keys", "ON");

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS drives (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                channel_id INTEGER NOT NULL,
                pinned_manifest_msg_id INTEGER,
                manifest_version INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                drive_id TEXT NOT NULL,
                parent_id TEXT NOT NULL,
                name TEXT NOT NULL,
                is_trashed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (drive_id) REFERENCES drives(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                drive_id TEXT NOT NULL,
                parent_id TEXT NOT NULL,
                name TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mime_type TEXT,
                telegram_message_id INTEGER NOT NULL,
                is_encrypted INTEGER NOT NULL DEFAULT 0,
                encryption_iv TEXT,
                sha256_hash TEXT,
                is_pinned_offline INTEGER NOT NULL DEFAULT 0,
                is_trashed INTEGER NOT NULL DEFAULT 0,
                version INTEGER NOT NULL DEFAULT 1,
                history_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (drive_id) REFERENCES drives(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sync_pairs (
                id TEXT PRIMARY KEY,
                local_path TEXT NOT NULL,
                remote_folder_id TEXT NOT NULL,
                drive_id TEXT NOT NULL,
                sync_mode TEXT NOT NULL,
                last_synced_at TEXT NOT NULL,
                FOREIGN KEY (drive_id) REFERENCES drives(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS secure_secrets (
                key TEXT PRIMARY KEY,
                encrypted_value BLOB NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- FTS5 Full-Text Search Virtual Table
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_nodes USING fts5(
                id,
                drive_id,
                name,
                kind,
                parent_id
            );
            "#,
        )?;

        // Auto-migrate existing databases to add any missing columns safely
        let _ = conn.execute(
            "ALTER TABLE folders ADD COLUMN is_trashed INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE files ADD COLUMN is_trashed INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE files ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
            [],
        );
        let _ = conn.execute("ALTER TABLE files ADD COLUMN history_json TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE files ADD COLUMN is_pinned_offline INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE drives ADD COLUMN manifest_version INTEGER NOT NULL DEFAULT 1",
            [],
        );

        Ok(())
    }

    pub fn batch_insert_manifest(&self, manifest: &ManifestSnapshot) -> Result<()> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction()?;

        // Ensure drive exists
        tx.execute(
            r#"
            INSERT INTO drives (id, name, channel_id, pinned_manifest_msg_id, manifest_version, updated_at)
            VALUES (?1, ?2, 0, NULL, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                manifest_version = excluded.manifest_version,
                updated_at = excluded.updated_at
            "#,
            params![
                manifest.header.drive_id,
                format!("Drive {}", manifest.header.drive_id),
                manifest.header.version,
                manifest.header.generated_at.to_rfc3339(),
            ],
        )?;

        // Clear existing nodes for this drive
        tx.execute(
            "DELETE FROM folders WHERE drive_id = ?1",
            params![manifest.header.drive_id],
        )?;
        tx.execute(
            "DELETE FROM files WHERE drive_id = ?1",
            params![manifest.header.drive_id],
        )?;
        tx.execute(
            "DELETE FROM fts_nodes WHERE drive_id = ?1",
            params![manifest.header.drive_id],
        )?;

        // Batch insert folders
        {
            let mut stmt = tx.prepare(
                r#"
                INSERT INTO folders (id, drive_id, parent_id, name, is_trashed, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
            )?;
            let mut fts_stmt = tx.prepare(
                "INSERT INTO fts_nodes (id, drive_id, name, kind, parent_id) VALUES (?1, ?2, ?3, 'folder', ?4)",
            )?;

            for folder in &manifest.folders {
                stmt.execute(params![
                    folder.id,
                    folder.drive_id,
                    folder.parent_id,
                    folder.name,
                    if folder.is_trashed { 1 } else { 0 },
                    folder.created_at.to_rfc3339(),
                    folder.updated_at.to_rfc3339(),
                ])?;
                fts_stmt.execute(params![
                    folder.id,
                    folder.drive_id,
                    folder.name,
                    folder.parent_id
                ])?;
            }
        }

        // Batch insert files
        {
            let mut stmt = tx.prepare(
                r#"
                INSERT INTO files (
                    id, drive_id, parent_id, name, size_bytes, mime_type,
                    telegram_message_id, is_encrypted, encryption_iv, sha256_hash,
                    is_pinned_offline, is_trashed, version, history_json,
                    created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
                "#,
            )?;
            let mut fts_stmt = tx.prepare(
                "INSERT INTO fts_nodes (id, drive_id, name, kind, parent_id) VALUES (?1, ?2, ?3, 'file', ?4)",
            )?;

            for file in &manifest.files {
                let history_json = if file.history.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&file.history).unwrap_or_default())
                };
                stmt.execute(params![
                    file.id,
                    file.drive_id,
                    file.parent_id,
                    file.name,
                    file.size_bytes as i64,
                    file.mime_type,
                    file.telegram_message_id,
                    if file.is_encrypted { 1 } else { 0 },
                    file.encryption_iv,
                    file.sha256_hash,
                    if file.is_pinned_offline { 1 } else { 0 },
                    if file.is_trashed { 1 } else { 0 },
                    file.version as i64,
                    history_json,
                    file.created_at.to_rfc3339(),
                    file.updated_at.to_rfc3339(),
                ])?;
                fts_stmt.execute(params![file.id, file.drive_id, file.name, file.parent_id])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn search(&self, drive_id: &str, query: &str) -> Result<Vec<SearchResult>> {
        let conn = self.lock_conn()?;
        let formatted_query = format!("\"{}\"*", query.replace('"', "\"\""));

        let mut stmt = conn.prepare(
            r#"
            SELECT fts.id, fts.drive_id, fts.name, fts.kind, fts.parent_id, f.size_bytes
            FROM fts_nodes fts
            LEFT JOIN files f ON f.id = fts.id
            WHERE fts.drive_id = ?1 AND fts_nodes MATCH ?2
            LIMIT 50
            "#,
        )?;

        let results = stmt
            .query_map(params![drive_id, formatted_query], |row| {
                let size_bytes: Option<i64> = row.get(5)?;
                Ok(SearchResult {
                    id: row.get(0)?,
                    drive_id: row.get(1)?,
                    name: row.get(2)?,
                    kind: row.get(3)?,
                    parent_id: row.get(4)?,
                    size_bytes: size_bytes.map(|s| s as u64),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(results)
    }

    pub fn load_tree(&self, drive_id: &str) -> Result<VfsTree> {
        let conn = self.lock_conn()?;
        let mut tree = VfsTree::new();

        // Load folders
        {
            let mut stmt = conn.prepare(
                "SELECT id, drive_id, parent_id, name, is_trashed, created_at, updated_at FROM folders WHERE drive_id = ?1 AND is_trashed = 0",
            )?;
            let rows = stmt.query_map(params![drive_id], |row| {
                let is_trashed: i32 = row.get(4)?;
                let created_str: String = row.get(5)?;
                let updated_str: String = row.get(6)?;
                Ok(FolderNode {
                    id: row.get(0)?,
                    drive_id: row.get(1)?,
                    parent_id: row.get(2)?,
                    name: row.get(3)?,
                    is_trashed: is_trashed == 1,
                    created_at: DateTime::parse_from_rfc3339(&created_str)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                    updated_at: DateTime::parse_from_rfc3339(&updated_str)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })?;

            for f in rows {
                tree.insert(VfsNode::Folder(f?));
            }
        }

        // Load files
        {
            let mut stmt = conn.prepare(
                r#"
                SELECT id, drive_id, parent_id, name, size_bytes, mime_type,
                       telegram_message_id, is_encrypted, encryption_iv, sha256_hash,
                       is_pinned_offline, is_trashed, version, history_json,
                       created_at, updated_at
                FROM files WHERE drive_id = ?1 AND is_trashed = 0
                "#,
            )?;
            let rows = stmt.query_map(params![drive_id], |row| {
                let size: i64 = row.get(4)?;
                let encrypted: i32 = row.get(7)?;
                let pinned: i32 = row.get(10)?;
                let trashed: i32 = row.get(11)?;
                let version: i64 = row.get(12)?;
                let history_json: Option<String> = row.get(13)?;
                let created_str: String = row.get(14)?;
                let updated_str: String = row.get(15)?;

                let history: Vec<crate::vfs::model::FileVersion> = history_json
                    .and_then(|json| serde_json::from_str(&json).ok())
                    .unwrap_or_default();

                Ok(FileNode {
                    id: row.get(0)?,
                    drive_id: row.get(1)?,
                    parent_id: row.get(2)?,
                    name: row.get(3)?,
                    size_bytes: size as u64,
                    mime_type: row.get(5)?,
                    telegram_message_id: row.get(6)?,
                    is_encrypted: encrypted == 1,
                    encryption_iv: row.get(8)?,
                    sha256_hash: row.get(9)?,
                    is_pinned_offline: pinned == 1,
                    is_trashed: trashed == 1,
                    version: version as u32,
                    history,
                    created_at: DateTime::parse_from_rfc3339(&created_str)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                    updated_at: DateTime::parse_from_rfc3339(&updated_str)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })?;

            for f in rows {
                tree.insert(VfsNode::File(f?));
            }
        }

        Ok(tree)
    }

    pub fn insert_sync_pair(&self, pair: &SyncPairEntry) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            r#"
            INSERT INTO sync_pairs (id, local_path, remote_folder_id, drive_id, sync_mode, last_synced_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
                local_path = excluded.local_path,
                remote_folder_id = excluded.remote_folder_id,
                sync_mode = excluded.sync_mode,
                last_synced_at = excluded.last_synced_at
            "#,
            params![
                pair.id,
                pair.local_path,
                pair.remote_folder_id,
                pair.drive_id,
                pair.sync_mode,
                pair.last_synced_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_sync_pairs(&self, drive_id: &str) -> Result<Vec<SyncPairEntry>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, local_path, remote_folder_id, drive_id, sync_mode, last_synced_at FROM sync_pairs WHERE drive_id = ?1",
        )?;
        let rows = stmt.query_map(params![drive_id], |row| {
            let last_synced_str: String = row.get(5)?;
            Ok(SyncPairEntry {
                id: row.get(0)?,
                local_path: row.get(1)?,
                remote_folder_id: row.get(2)?,
                drive_id: row.get(3)?,
                sync_mode: row.get(4)?,
                last_synced_at: DateTime::parse_from_rfc3339(&last_synced_str)
                    .map(|dt| dt.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now()),
            })
        })?;
        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn delete_sync_pair(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM sync_pairs WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_sync_pair_last_synced(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE sync_pairs SET last_synced_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn rename_node_in_cache(
        &self,
        drive_id: &str,
        node_id: &str,
        new_name: &str,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3 AND drive_id = ?4",
            params![new_name, now, node_id, drive_id],
        )?;
        conn.execute(
            "UPDATE files SET name = ?1, updated_at = ?2 WHERE id = ?3 AND drive_id = ?4",
            params![new_name, now, node_id, drive_id],
        )?;
        conn.execute(
            "UPDATE fts_nodes SET name = ?1 WHERE id = ?2 AND drive_id = ?3",
            params![new_name, node_id, drive_id],
        )?;
        Ok(())
    }

    pub fn move_node_in_cache(
        &self,
        drive_id: &str,
        node_id: &str,
        new_parent_id: &str,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE folders SET parent_id = ?1, updated_at = ?2 WHERE id = ?3 AND drive_id = ?4",
            params![new_parent_id, now, node_id, drive_id],
        )?;
        conn.execute(
            "UPDATE files SET parent_id = ?1, updated_at = ?2 WHERE id = ?3 AND drive_id = ?4",
            params![new_parent_id, now, node_id, drive_id],
        )?;
        conn.execute(
            "UPDATE fts_nodes SET parent_id = ?1 WHERE id = ?2 AND drive_id = ?3",
            params![new_parent_id, node_id, drive_id],
        )?;
        Ok(())
    }

    pub fn set_secure_secret(&self, key: &str, plaintext: &[u8]) -> Result<()> {
        let encrypted = crate::crypto::protect_secret(plaintext)?;
        let conn = self.lock_conn()?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO secure_secrets (key, encrypted_value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, encrypted, now],
        )?;
        Ok(())
    }

    pub fn get_secure_secret(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT encrypted_value FROM secure_secrets WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            let encrypted: Vec<u8> = row.get(0)?;
            let decrypted = crate::crypto::unprotect_secret(&encrypted)?;
            Ok(Some(decrypted))
        } else {
            Ok(None)
        }
    }

    pub fn delete_secure_secret(&self, key: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM secure_secrets WHERE key = ?1", params![key])?;
        Ok(())
    }
}
