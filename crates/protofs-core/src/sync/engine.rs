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
                        drive_id,
                        snapshot.header.version,
                        snapshot.header.folder_count,
                        snapshot.header.file_count
                    );
                    return Ok(tree);
                }
                Err(e) => {
                    warn!(
                        "Failed to decompress pinned manifest: {}. Triggering self-healing rebuild scan.",
                        e
                    );
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

                if let Some(ref caption) = msg.caption
                    && let Ok(parsed) = ParsedCaption::parse(caption)
                {
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
                        version: 1,
                        history: Vec::new(),
                        created_at: msg.date,
                        updated_at: msg.date,
                    };
                    tree.insert(VfsNode::File(file_node));
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
        let tree_snapshot = {
            let trees = self.trees_by_drive.read().await;
            trees
                .get(drive_id)
                .ok_or_else(|| ProtoFsError::DriveNotFound(drive_id.to_string()))?
                .clone()
        };

        let mut versions = self.versions_by_drive.write().await;
        let current_version = versions.get(drive_id).copied().unwrap_or(1);
        let next_version = current_version + 1;

        let snapshot = ManifestSnapshot::from_tree(drive_id, next_version, &tree_snapshot);
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
        } else if let Some(VfsNode::Folder(mut folder)) = tree.remove(node_id) {
            folder.is_trashed = true;
            folder.updated_at = chrono::Utc::now();
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
        } else if let Some(VfsNode::Folder(mut folder)) = tree.remove(node_id) {
            folder.is_trashed = false;
            folder.updated_at = chrono::Utc::now();
            tree.insert(VfsNode::Folder(folder));
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
        tree.remove_recursive(node_id);
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

    pub fn transport(&self) -> &Arc<T> {
        &self.transport
    }

    /// Uploads a file to Telegram with optional STREAM AEAD AES-256-GCM encryption,
    /// Uploads and optionally encrypts file content, dispatches MTProto upload_document,
    /// constructs the self-describing caption, and updates the local in-memory tree & cache.
    #[allow(clippy::too_many_arguments)]
    pub async fn upload_file_data(
        &self,
        drive_id: &str,
        parent_id: &str,
        name: &str,
        raw_data: &[u8],
        is_encrypted: bool,
        encryption_key: Option<&[u8; 32]>,
        channel_id: i64,
    ) -> Result<FileNode> {
        let (final_data, iv_hex) = if is_encrypted {
            let key = encryption_key.ok_or_else(|| {
                ProtoFsError::Crypto(
                    "Encryption key is required when is_encrypted is true".to_string(),
                )
            })?;
            let base_iv = crate::crypto::aead::generate_base_iv();
            let encryptor = crate::crypto::aead::StreamEncryptor::new(key, base_iv)?;

            let mut encrypted_buf = Vec::new();
            let chunk_size = crate::crypto::aead::CHUNK_PLAINTEXT_SIZE;
            let total_chunks = if raw_data.is_empty() {
                1
            } else {
                raw_data.len().div_ceil(chunk_size)
            };

            for i in 0..total_chunks {
                let start = i * chunk_size;
                let end = (start + chunk_size).min(raw_data.len());
                let slice = if raw_data.is_empty() {
                    &[]
                } else {
                    &raw_data[start..end]
                };
                let is_final = i + 1 == total_chunks;
                let sealed = encryptor.encrypt_chunk(i as u32, is_final, slice)?;
                encrypted_buf.extend_from_slice(&sealed);
            }

            let iv_string = hex_encode(&base_iv);
            (encrypted_buf, Some(iv_string))
        } else {
            (raw_data.to_vec(), None)
        };

        let sha256 = hex_encode(ring::digest::digest(&ring::digest::SHA256, raw_data).as_ref());
        let caption = ParsedCaption::new(
            parent_id,
            name,
            is_encrypted,
            iv_hex.as_deref(),
            Some(&sha256),
        );
        let caption_str = caption.serialize();

        let tg_msg = if channel_id != 0 {
            self.transport
                .upload_document(channel_id, name, &caption_str, &final_data)
                .await?
        } else {
            crate::mtproto::TelegramMessage {
                id: (chrono::Utc::now().timestamp_subsec_millis() as i32) + 1000,
                channel_id,
                caption: Some(caption_str),
                document_size: Some(final_data.len() as u64),
                document_name: Some(name.to_string()),
                is_pinned: false,
                date: chrono::Utc::now(),
            }
        };

        let file_id = format!("file_{}", tg_msg.id);
        let file_node = FileNode {
            id: file_id.clone(),
            drive_id: drive_id.to_string(),
            parent_id: parent_id.to_string(),
            name: name.to_string(),
            size_bytes: raw_data.len() as u64,
            mime_type: None,
            telegram_message_id: tg_msg.id,
            is_encrypted,
            encryption_iv: iv_hex,
            sha256_hash: Some(sha256),
            is_pinned_offline: false,
            is_trashed: false,
            version: 1,
            history: Vec::new(),
            created_at: tg_msg.date,
            updated_at: tg_msg.date,
        };

        self.add_node(drive_id, VfsNode::File(file_node.clone()))
            .await?;
        Ok(file_node)
    }

    /// Downloads and optionally decrypts file content from Telegram
    pub async fn download_file_data(
        &self,
        drive_id: &str,
        file_id: &str,
        encryption_key: Option<&[u8; 32]>,
        channel_id: i64,
    ) -> Result<(FileNode, Vec<u8>)> {
        let tree = self.get_or_create_tree(drive_id).await;
        let file = tree
            .get_file(file_id)
            .ok_or_else(|| ProtoFsError::NodeNotFound(file_id.to_string()))?
            .clone();

        let downloaded_bytes = if channel_id != 0 && file.telegram_message_id > 0 {
            self.transport
                .download_range(
                    channel_id,
                    file.telegram_message_id,
                    0,
                    (file.size_bytes + 1024 * 1024) as u32,
                )
                .await?
        } else {
            Vec::new()
        };

        let final_data = if file.is_encrypted {
            if downloaded_bytes.is_empty() {
                Vec::new()
            } else {
                let key = encryption_key.ok_or_else(|| {
                    ProtoFsError::Crypto(
                        "Decryption key is required for encrypted file".to_string(),
                    )
                })?;
                let iv_str = file.encryption_iv.as_deref().ok_or_else(|| {
                    ProtoFsError::Crypto("Missing encryption IV on encrypted file node".to_string())
                })?;
                let iv_bytes = hex_decode_7bytes(iv_str)?;
                let decryptor = crate::crypto::aead::StreamDecryptor::new(key, iv_bytes)?;

                let chunk_enc_size = crate::crypto::aead::CHUNK_ENCRYPTED_SIZE;
                let mut plaintext_buf = Vec::new();
                let total_chunks = downloaded_bytes.len().div_ceil(chunk_enc_size);

                for i in 0..total_chunks {
                    let start = i * chunk_enc_size;
                    let end = (start + chunk_enc_size).min(downloaded_bytes.len());
                    let slice = &downloaded_bytes[start..end];
                    let is_final = i + 1 == total_chunks;
                    let opened = decryptor.decrypt_chunk(i as u32, is_final, slice)?;
                    plaintext_buf.extend_from_slice(&opened);
                }
                plaintext_buf
            }
        } else {
            downloaded_bytes
        };

        Ok((file, final_data))
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode_7bytes(s: &str) -> Result<[u8; 7]> {
    if s.len() != 14 {
        return Err(ProtoFsError::Crypto(
            "Invalid IV hex length (expected 14 hex chars for 7 bytes)".to_string(),
        ));
    }
    let mut bytes = [0u8; 7];
    for i in 0..7 {
        bytes[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)
            .map_err(|e| ProtoFsError::Crypto(format!("Invalid IV hex character: {}", e)))?;
    }
    Ok(bytes)
}
