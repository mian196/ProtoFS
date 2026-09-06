use std::path::{Path, PathBuf};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use tracing::info;

use crate::error::Result;

#[derive(Debug, Clone)]
pub struct CachedFileEntry {
    pub file_id: String,
    pub relative_path: PathBuf,
    pub size_bytes: u64,
    pub is_pinned: bool,
    pub last_accessed_at: DateTime<Utc>,
}

pub struct CacheManager<'a> {
    conn: &'a Connection,
    cache_root: PathBuf,
}

impl<'a> CacheManager<'a> {
    pub fn new<P: AsRef<Path>>(conn: &'a Connection, cache_root: P) -> Result<Self> {
        let root = cache_root.as_ref().to_path_buf();
        std::fs::create_dir_all(&root)?;

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS local_cache_entries (
                file_id TEXT PRIMARY KEY,
                relative_path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                last_accessed_at TEXT NOT NULL
            );
            "#,
        )?;

        Ok(Self {
            conn,
            cache_root: root,
        })
    }

    pub fn record_access(&self, file_id: &str, relative_path: &Path, size_bytes: u64, is_pinned: bool) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"
            INSERT INTO local_cache_entries (file_id, relative_path, size_bytes, is_pinned, last_accessed_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(file_id) DO UPDATE SET
                relative_path = excluded.relative_path,
                size_bytes = excluded.size_bytes,
                is_pinned = excluded.is_pinned,
                last_accessed_at = excluded.last_accessed_at
            "#,
            params![
                file_id,
                relative_path.to_string_lossy().to_string(),
                size_bytes as i64,
                if is_pinned { 1 } else { 0 },
                now,
            ],
        )?;
        Ok(())
    }

    pub fn total_cache_bytes(&self) -> Result<u64> {
        let mut stmt = self.conn.prepare("SELECT COALESCE(SUM(size_bytes), 0) FROM local_cache_entries")?;
        let sum: i64 = stmt.query_row([], |row| row.get(0))?;
        Ok(sum as u64)
    }

    pub fn evict_lru(&self, max_bytes: u64) -> Result<(u64, usize)> {
        let current_total = self.total_cache_bytes()?;
        if current_total <= max_bytes {
            return Ok((0, 0));
        }

        let bytes_to_free = current_total - max_bytes;
        let mut freed_bytes: u64 = 0;
        let mut evicted_count: usize = 0;

        // Query non-pinned files ordered by last_accessed_at ASC (LRU)
        let mut stmt = self.conn.prepare(
            r#"
            SELECT file_id, relative_path, size_bytes
            FROM local_cache_entries
            WHERE is_pinned = 0
            ORDER BY last_accessed_at ASC
            "#,
        )?;

        let rows = stmt.query_map([], |row| {
            let file_id: String = row.get(0)?;
            let rel: String = row.get(1)?;
            let size: i64 = row.get(2)?;
            Ok((file_id, PathBuf::from(rel), size as u64))
        })?;

        let mut files_to_remove = Vec::new();
        for item in rows {
            let (file_id, rel_path, size) = item?;
            files_to_remove.push((file_id, rel_path, size));
            freed_bytes += size;
            evicted_count += 1;
            if freed_bytes >= bytes_to_free {
                break;
            }
        }

        for (file_id, rel_path, _) in &files_to_remove {
            let full_path = self.cache_root.join(rel_path);
            if full_path.exists() {
                let _ = std::fs::remove_file(&full_path);
            }
            self.conn.execute("DELETE FROM local_cache_entries WHERE file_id = ?1", params![file_id])?;
            info!("Evicted cached file '{}' from disk", file_id);
        }

        Ok((freed_bytes, evicted_count))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_lru_eviction_preserves_pinned_files() {
        let dir = tempdir().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        let manager = CacheManager::new(&conn, dir.path()).unwrap();

        // 1. Create a 1MB unpinned file
        let file1_path = dir.path().join("file1.bin");
        std::fs::write(&file1_path, vec![0u8; 1_000_000]).unwrap();
        manager.record_access("file1", Path::new("file1.bin"), 1_000_000, false).unwrap();

        // 2. Create a 2MB pinned file
        let file2_path = dir.path().join("pinned.bin");
        std::fs::write(&file2_path, vec![0u8; 2_000_000]).unwrap();
        manager.record_access("file2", Path::new("pinned.bin"), 2_000_000, true).unwrap();

        assert_eq!(manager.total_cache_bytes().unwrap(), 3_000_000);

        // 3. Evict down to 2.5MB max limit -> file1 should be evicted, file2 (pinned) preserved
        let (freed, count) = manager.evict_lru(2_500_000).unwrap();
        assert_eq!(count, 1);
        assert_eq!(freed, 1_000_000);
        assert!(!file1_path.exists());
        assert!(file2_path.exists());
    }
}
