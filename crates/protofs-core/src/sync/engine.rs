use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::cache::CacheDatabase;
use crate::error::{ProtoFsError, Result};
use crate::manifest::ManifestSnapshot;
use crate::mtproto::{ParsedCaption, TelegramTransport};
use crate::vfs::{FileNode, VfsNode, VfsTree};

pub struct SyncEngine<T: TelegramTransport> {
    transport: Arc<T>,
    cache: CacheDatabase,
    trees_by_drive: Arc<RwLock<std::collections::HashMap<String, VfsTree>>>,
    versions_by_drive: Arc<RwLock<std::collections::HashMap<String, u64>>>,
    is_dirty_by_drive: Arc<RwLock<std::collections::HashMap<String, bool>>>,
}

impl<T: TelegramTransport> SyncEngine<T> {
    pub fn new(transport: Arc<T>, cache: CacheDatabase) -> Self {
        Self {
            transport,
            cache,
            trees_by_drive: Arc::new(RwLock::new(std::collections::HashMap::new())),
            versions_by_drive: Arc::new(RwLock::new(std::collections::HashMap::new())),
            is_dirty_by_drive: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Load or initialize drive from pinned Telegram manifest (fast-path: <1s)
    pub async fn load_drive(&self, drive_id: &str, channel_id: i64) -> Result<VfsTree> {
        info!(
            "Attempting fast-path load for drive '{}' via pinned manifest",
            drive_id
        );

        if let Some((_msg_id, compressed_bytes)) =
            self.transport.get_pinned_manifest(channel_id).await?
        {
            match ManifestSnapshot::from_compressed_bytes(&compressed_bytes) {
                Ok(snapshot) => {
                    let mut tree = VfsTree::new();
                    snapshot.populate_tree(&mut tree);

                    // Sync to local SQLite cache
                    self.cache.batch_insert_manifest(&snapshot)?;

                    let mut trees = self.trees_by_drive.write().await;
                    trees.insert(drive_id.to_string(), tree.clone());

                    let mut versions = self.versions_by_drive.write().await;
                    versions.insert(drive_id.to_string(), snapshot.header.version);

                    info!(
                        "Drive '{}' successfully loaded from pinned manifest (v{}, {} folders, {} files)",
                        drive_id, snapshot.header.version, snapshot.header.folder_count, snapshot.header.file_count
                    );
                    return Ok(tree);
                }
                Err(e) => {
                    warn!("Failed to decompress pinned manifest: {}. Triggering self-healing rebuild scan.", e);
                }
            }
        } else {
            info!(
                "No pinned manifest found for drive '{}'. Triggering self-healing rebuild scan.",
                drive_id
            );
        }

        // Self-healing fallback: scan channel history
        self.rebuild_drive_index(drive_id, channel_id).await
    }

    /// Self-healing rebuild scan: reconstructs tree from captions across channel history
    pub async fn rebuild_drive_index(&self, drive_id: &str, channel_id: i64) -> Result<VfsTree> {
        info!(
            "Starting self-healing index rebuild for drive '{}' in channel {}",
            drive_id, channel_id
        );

        let mut tree = VfsTree::new();
        let mut min_id = 0;
        let mut total_scanned = 0;

        loop {
            let messages = self
                .transport
                .scan_messages(channel_id, min_id, 100)
                .await?;
            if messages.is_empty() {
                break;
            }

            for msg in &messages {
                min_id = min_id.max(msg.id);
                total_scanned += 1;

                if let Some(ref caption) = msg.caption {
                    if let Ok(parsed) = ParsedCaption::parse(caption) {
                        let file_node = FileNode {
                            id: format!("file_{}", msg.id),
                            drive_id: drive_id.to_string(),
                            parent_id: parsed.parent_id,
                            name: parsed.name,
                            size_bytes: msg.document_size.unwrap_or(0),
                            mime_type: None,
                            telegram_message_id: msg.id,
                            is_encrypted: parsed.is_encrypted,
                            encryption_iv: parsed.iv,
                            sha256_hash: parsed.sha256_hash,
                            is_pinned_offline: false,
                            is_trashed: false,
                            created_at: msg.date,
                            updated_at: msg.date,
                        };
                        tree.insert(VfsNode::File(file_node));
                    }
                }
            }
        }

        info!(
            "Rebuild scan complete: scanned {} messages, reconstructed {} valid files",
            total_scanned,
            tree.count()
        );

        // Create initial manifest and flush to channel
        let snapshot = ManifestSnapshot::from_tree(drive_id, 1, &tree);
        self.cache.batch_insert_manifest(&snapshot)?;

        let compressed = snapshot.to_compressed_bytes()?;
        let pinned_msg_id = self
            .transport
            .update_pinned_manifest(channel_id, &compressed)
            .await?;

        let mut trees = self.trees_by_drive.write().await;
        trees.insert(drive_id.to_string(), tree.clone());

        let mut versions = self.versions_by_drive.write().await;
        versions.insert(drive_id.to_string(), 1);

        info!(
            "Synthesized fresh pinned manifest v1 (msg #{}) for drive '{}'",
            pinned_msg_id, drive_id
        );
        Ok(tree)
    }

    /// Flush in-memory changes to Telegram by updating the pinned manifest.json.zst
    pub async fn flush_manifest(&self, drive_id: &str, channel_id: i64) -> Result<()> {
        let trees = self.trees_by_drive.read().await;
        let tree = trees
            .get(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;

        let mut versions = self.versions_by_drive.write().await;
        let current_version = versions.get(drive_id).copied().unwrap_or(1);
        let next_version = current_version + 1;

        let snapshot = ManifestSnapshot::from_tree(drive_id, next_version, tree);
        self.cache.batch_insert_manifest(&snapshot)?;

        let compressed = snapshot.to_compressed_bytes()?;
        self.transport
            .update_pinned_manifest(channel_id, &compressed)
            .await?;

        versions.insert(drive_id.to_string(), next_version);

        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), false);

        info!(
            "Flushed manifest v{} to Telegram channel {}",
            next_version, channel_id
        );
        Ok(())
    }

    pub async fn get_tree(&self, drive_id: &str) -> Option<VfsTree> {
        let trees = self.trees_by_drive.read().await;
        trees.get(drive_id).cloned()
    }

    pub async fn get_or_create_tree(&self, drive_id: &str) -> VfsTree {
        let mut trees = self.trees_by_drive.write().await;
        trees.entry(drive_id.to_string()).or_default().clone()
    }

    pub async fn add_node(&self, drive_id: &str, node: VfsNode) -> Result<()> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees.entry(drive_id.to_string()).or_default();
        tree.insert(node);
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(())
    }

    pub async fn trash_node(&self, drive_id: &str, node_id: &str) -> Result<()> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees
            .get_mut(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;
        if let Some(VfsNode::File(mut file)) = tree.remove(node_id) {
            file.is_trashed = true;
            file.updated_at = chrono::Utc::now();
            tree.insert(VfsNode::File(file));
        } else if let Some(VfsNode::Folder(folder)) = tree.remove(node_id) {
            tree.insert(VfsNode::Folder(folder));
        }
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(())
    }

    pub async fn restore_node(&self, drive_id: &str, node_id: &str) -> Result<()> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees
            .get_mut(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;
        if let Some(VfsNode::File(mut file)) = tree.remove(node_id) {
            file.is_trashed = false;
            file.updated_at = chrono::Utc::now();
            tree.insert(VfsNode::File(file));
        }
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(())
    }

    pub async fn delete_node(&self, drive_id: &str, node_id: &str) -> Result<()> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees
            .get_mut(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;
        tree.remove(node_id);
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(())
    }

    pub async fn empty_trash(&self, drive_id: &str) -> Result<usize> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees
            .get_mut(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;
        let trashed_ids: Vec<String> = tree
            .all_nodes()
            .filter_map(|n| match n {
                VfsNode::File(f) if f.is_trashed => Some(f.id.clone()),
                _ => None,
            })
            .collect();
        let count = trashed_ids.len();
        for id in &trashed_ids {
            tree.remove(id);
        }
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(count)
    }

    pub async fn toggle_pin(&self, drive_id: &str, node_id: &str, pinned: bool) -> Result<()> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees
            .get_mut(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;
        if let Some(VfsNode::File(mut file)) = tree.remove(node_id) {
            file.is_pinned_offline = pinned;
            file.updated_at = chrono::Utc::now();
            tree.insert(VfsNode::File(file));
        }
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(())
    }

    pub async fn rename_node(&self, drive_id: &str, node_id: &str, new_name: &str) -> Result<()> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees
            .get_mut(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;
        tree.rename(node_id, new_name)?;
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(())
    }

    pub async fn move_node(
        &self,
        drive_id: &str,
        node_id: &str,
        new_parent_id: &str,
    ) -> Result<()> {
        let mut trees = self.trees_by_drive.write().await;
        let tree = trees
            .get_mut(drive_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?;
        tree.move_node(node_id, new_parent_id)?;
        let mut dirty = self.is_dirty_by_drive.write().await;
        dirty.insert(drive_id.to_string(), true);
        Ok(())
    }
}
