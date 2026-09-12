pub mod cache;
pub mod crypto;
pub mod error;
pub mod manifest;
pub mod mtproto;
pub mod sync;
pub mod vfs;
pub mod webdav;

pub use cache::{CacheDatabase, SearchResult, SyncPairEntry};
pub use error::{ProtoFsError, Result};
pub use manifest::ManifestSnapshot;
pub use mtproto::{DynamicTelegramTransport, ParsedCaption, TelegramTransport};
pub use sync::SyncEngine;
pub use vfs::{FileNode, FolderNode, ROOT_PARENT_ID, VfsNode, VfsTree};
pub use webdav::{DEFAULT_WEBDAV_PORT, WebDavConfig, WebDavServer};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mtproto::{ChannelInfo, OwnedChannel, TelegramMessage, TelegramUser};
    use chrono::Utc;

    #[test]
    fn test_vfs_tree_operations() {
        let mut tree = VfsTree::new();

        let folder = FolderNode {
            id: "f_1".to_string(),
            drive_id: "drive_main".to_string(),
            parent_id: ROOT_PARENT_ID.to_string(),
            name: "Documents".to_string(),
            is_trashed: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let file = FileNode {
            id: "file_1".to_string(),
            drive_id: "drive_main".to_string(),
            parent_id: "f_1".to_string(),
            name: "report.pdf".to_string(),
            size_bytes: 1024,
            mime_type: Some("application/pdf".to_string()),
            telegram_message_id: 100,
            is_encrypted: false,
            encryption_iv: None,
            sha256_hash: None,
            is_pinned_offline: false,
            is_trashed: false,
            version: 1,
            history: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        tree.insert(VfsNode::Folder(folder));
        tree.insert(VfsNode::File(file));

        assert_eq!(tree.count(), 2);
        assert_eq!(tree.list_children(ROOT_PARENT_ID).len(), 1);
        assert_eq!(tree.list_children("f_1").len(), 1);

        // Rename test
        tree.rename("f_1", "Work Documents").unwrap();
        assert_eq!(tree.get_folder("f_1").unwrap().name, "Work Documents");

        // Breadcrumbs test
        let crumbs = tree.resolve_breadcrumbs("f_1");
        assert_eq!(crumbs.len(), 1);
        assert_eq!(crumbs[0].1, "Work Documents");

        // Relative path test
        let path = tree.resolve_relative_path("file_1");
        assert_eq!(path, "Work Documents/report.pdf");

        // File versioning test: update file version
        let v2 = tree
            .record_file_version("file_1", 101, 2048, None, None, false, None)
            .unwrap();
        assert_eq!(v2, 2);
        let f2 = tree.get_file("file_1").unwrap();
        assert_eq!(f2.version, 2);
        assert_eq!(f2.size_bytes, 2048);
        assert_eq!(f2.history.len(), 1);
        assert_eq!(f2.history[0].version, 1);
        assert_eq!(f2.history[0].size_bytes, 1024);

        // Restore file version 1
        let v_restored = tree.restore_file_version("file_1", 1).unwrap();
        assert_eq!(v_restored, 1);
        let f_restored = tree.get_file("file_1").unwrap();
        assert_eq!(f_restored.version, 1);
        assert_eq!(f_restored.history.len(), 1);
        assert_eq!(f_restored.history[0].version, 2);
    }

    #[test]
    fn test_manifest_zstd_compression_roundtrip() {
        let mut tree = VfsTree::new();
        tree.insert(VfsNode::Folder(FolderNode {
            id: "f_vault".to_string(),
            drive_id: "personal".to_string(),
            parent_id: ROOT_PARENT_ID.to_string(),
            name: "Vault".to_string(),
            is_trashed: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }));

        let manifest = ManifestSnapshot::from_tree("personal", 1, &tree);
        let compressed = manifest.to_compressed_bytes().unwrap();
        assert!(!compressed.is_empty());

        let restored = ManifestSnapshot::from_compressed_bytes(&compressed).unwrap();
        assert_eq!(restored.header.version, 1);
        assert_eq!(restored.header.drive_id, "personal");
        assert_eq!(restored.folders.len(), 1);
        assert_eq!(restored.folders[0].name, "Vault");
    }

    #[test]
    fn test_crypto_aead_chunk_encryption_and_tampering() {
        let salt = crypto::generate_salt();
        let key = crypto::derive_key("SuperSecretPassphrase123!", &salt).unwrap();
        let base_iv = crypto::generate_base_iv();

        let encryptor = crypto::StreamEncryptor::new(&key, base_iv).unwrap();
        let decryptor = crypto::StreamDecryptor::new(&key, base_iv).unwrap();

        let plaintext = b"Hello ProtoFS! High-performance encrypted streaming test chunk.";
        let encrypted_chunk = encryptor.encrypt_chunk(0, true, plaintext).unwrap();

        // Verify successful decryption
        let decrypted = decryptor.decrypt_chunk(0, true, &encrypted_chunk).unwrap();
        assert_eq!(decrypted, plaintext);

        // Verify tampering is rejected
        let mut tampered = encrypted_chunk.clone();
        tampered[10] ^= 0xFF;
        assert!(decryptor.decrypt_chunk(0, true, &tampered).is_err());
    }

    #[test]
    fn test_sqlite_cache_fts5_search() {
        let db = CacheDatabase::open_in_memory().unwrap();

        let mut tree = VfsTree::new();
        tree.insert(VfsNode::Folder(FolderNode {
            id: "f_fin".to_string(),
            drive_id: "drive1".to_string(),
            parent_id: ROOT_PARENT_ID.to_string(),
            name: "Financial Audits".to_string(),
            is_trashed: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }));
        tree.insert(VfsNode::File(FileNode {
            id: "file_tax".to_string(),
            drive_id: "drive1".to_string(),
            parent_id: "f_fin".to_string(),
            name: "Tax_Report_2025.xlsx".to_string(),
            size_bytes: 4096,
            mime_type: None,
            telegram_message_id: 12,
            is_encrypted: true,
            encryption_iv: None,
            sha256_hash: None,
            is_pinned_offline: true,
            is_trashed: false,
            version: 1,
            history: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }));

        let manifest = ManifestSnapshot::from_tree("drive1", 1, &tree);
        db.batch_insert_manifest(&manifest).unwrap();

        // Search test
        let results = db.search("drive1", "Tax").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Tax_Report_2025.xlsx");
        assert_eq!(results[0].kind, "file");

        // Reload tree test
        let loaded_tree = db.load_tree("drive1").unwrap();
        assert_eq!(loaded_tree.count(), 2);
    }

    #[derive(Default)]
    struct MockTestTransport {
        pinned_manifest: std::sync::Mutex<Option<(i32, Vec<u8>)>>,
        messages: std::sync::Mutex<Vec<TelegramMessage>>,
        payloads: std::sync::Mutex<std::collections::HashMap<i32, Vec<u8>>>,
    }

    #[async_trait::async_trait]
    impl TelegramTransport for MockTestTransport {
        async fn get_me(&self) -> Result<TelegramUser> {
            Ok(TelegramUser {
                id: 100,
                first_name: "Test".to_string(),
                username: Some("testuser".to_string()),
                phone: Some("+123456789".to_string()),
            })
        }
        async fn create_channel(&self, title: &str, _about: &str) -> Result<ChannelInfo> {
            Ok(ChannelInfo {
                id: 9999,
                title: title.to_string(),
                access_hash: 12345,
            })
        }
        async fn list_owned_channels(&self) -> Result<Vec<OwnedChannel>> {
            Ok(vec![OwnedChannel {
                channel_id: 9999,
                title: "Personal Drive".to_string(),
                is_channel: true,
                is_group: false,
                is_creator: true,
                is_admin: true,
                is_protofs_drive: true,
                about: Some("ProtoFS Root".to_string()),
            }])
        }
        async fn get_pinned_manifest(&self, _channel_id: i64) -> Result<Option<(i32, Vec<u8>)>> {
            Ok(self.pinned_manifest.lock().unwrap().clone())
        }
        async fn update_pinned_manifest(
            &self,
            _channel_id: i64,
            manifest_bytes: &[u8],
        ) -> Result<i32> {
            let mut pinned = self.pinned_manifest.lock().unwrap();
            *pinned = Some((1, manifest_bytes.to_vec()));
            Ok(1)
        }
        async fn upload_document(
            &self,
            channel_id: i64,
            filename: &str,
            caption: &str,
            data: &[u8],
        ) -> Result<TelegramMessage> {
            let mut msgs = self.messages.lock().unwrap();
            let id = (msgs.len() + 1) as i32;
            let msg = TelegramMessage {
                id,
                channel_id,
                caption: Some(caption.to_string()),
                document_size: Some(data.len() as u64),
                document_name: Some(filename.to_string()),
                is_pinned: false,
                date: Utc::now(),
            };
            msgs.push(msg.clone());
            self.payloads.lock().unwrap().insert(id, data.to_vec());
            Ok(msg)
        }
        async fn download_range(
            &self,
            _channel_id: i64,
            message_id: i32,
            offset: u64,
            limit: u32,
        ) -> Result<Vec<u8>> {
            let payloads = self.payloads.lock().unwrap();
            if let Some(data) = payloads.get(&message_id) {
                let start = (offset as usize).min(data.len());
                let end = ((offset as usize) + (limit as usize)).min(data.len());
                Ok(data[start..end].to_vec())
            } else {
                Ok(vec![])
            }
        }
        async fn edit_caption(
            &self,
            _channel_id: i64,
            _message_id: i32,
            _new_caption: &str,
        ) -> Result<()> {
            Ok(())
        }
        async fn delete_message(&self, _channel_id: i64, _message_id: i32) -> Result<()> {
            Ok(())
        }
        async fn scan_messages(
            &self,
            _channel_id: i64,
            min_id: i32,
            _limit: usize,
        ) -> Result<Vec<TelegramMessage>> {
            let msgs = self.messages.lock().unwrap();
            let filtered: Vec<TelegramMessage> =
                msgs.iter().filter(|m| m.id > min_id).cloned().collect();
            Ok(filtered)
        }
    }

    #[tokio::test]
    async fn test_sync_engine_end_to_end() {
        use std::sync::Arc;

        let transport = Arc::new(MockTestTransport::default());
        let db = CacheDatabase::open_in_memory().unwrap();
        let engine = SyncEngine::new(transport.clone(), db);

        let channel = transport
            .create_channel("Personal Drive", "ProtoFS Root")
            .await
            .unwrap();

        // 1. Simulate uploading files to channel with structured captions
        let cap1 = ParsedCaption::new("root", "photo.jpg", false, None, None).serialize();
        transport
            .upload_document(channel.id, "photo.jpg", &cap1, b"JPEG_DATA")
            .await
            .unwrap();

        let cap2 = ParsedCaption::new("root", "secret.enc", true, Some("iv123"), Some("hashabc"))
            .serialize();
        transport
            .upload_document(channel.id, "secret.enc", &cap2, b"ENCRYPTED_DATA")
            .await
            .unwrap();

        // 2. First load: No pinned manifest -> triggers self-healing rebuild scan
        let tree = engine.load_drive("personal", channel.id).await.unwrap();
        assert_eq!(tree.count(), 2);

        // 3. Verify pinned manifest was generated and uploaded
        let pinned = transport.get_pinned_manifest(channel.id).await.unwrap();
        assert!(pinned.is_some());

        // 4. Second load: Fast path from pinned manifest
        let fast_tree = engine.load_drive("personal", channel.id).await.unwrap();
        assert_eq!(fast_tree.count(), 2);

        // 5. Test flush manifest
        engine.flush_manifest("personal", channel.id).await.unwrap();
    }

    #[tokio::test]
    async fn test_upload_and_download_file_data_encrypted_roundtrip() {
        use std::sync::Arc;

        let transport = Arc::new(MockTestTransport::default());
        let db = CacheDatabase::open_in_memory().unwrap();
        let engine = SyncEngine::new(transport.clone(), db);

        let key = [0x42u8; 32];
        let original_data = b"Hello, secure protofs cloud with real MTProto transfer pipeline!";

        // Upload encrypted file
        let uploaded_node = engine
            .upload_file_data(
                "drive_test",
                "root",
                "secret_notes.txt",
                original_data,
                true,
                Some(&key),
                9999,
            )
            .await
            .unwrap();

        assert!(uploaded_node.is_encrypted);
        assert!(uploaded_node.encryption_iv.is_some());
        assert_eq!(uploaded_node.name, "secret_notes.txt");

        // Download and decrypt file
        let (node, decrypted_data) = engine
            .download_file_data("drive_test", &uploaded_node.id, Some(&key), 9999)
            .await
            .unwrap();

        assert_eq!(node.id, uploaded_node.id);
        assert_eq!(decrypted_data, original_data);
    }

    #[tokio::test]
    async fn test_self_healing_rebuild_with_nested_folders() {
        use std::sync::Arc;

        let transport = Arc::new(MockTestTransport::default());
        let db = CacheDatabase::open_in_memory().unwrap();
        let engine = SyncEngine::new(transport.clone(), db);

        let channel = transport
            .create_channel("Nested Drive", "Self-Healing Test")
            .await
            .unwrap();

        // Upload file under non-root folder: "folder_Documents"
        let cap =
            ParsedCaption::new("folder_Documents", "report.pdf", false, None, None).serialize();
        transport
            .upload_document(channel.id, "report.pdf", &cap, b"PDF_DATA")
            .await
            .unwrap();

        // Rebuild scan should discover file AND synthesize "folder_Documents"
        let tree = engine.load_drive("nested_drive", channel.id).await.unwrap();
        assert_eq!(tree.count(), 2); // 1 synthesized folder + 1 file

        let folder = tree.get_folder("folder_Documents");
        assert!(folder.is_some());
        assert_eq!(folder.unwrap().name, "Documents");

        let file = tree.get_file("file_1");
        assert!(file.is_some());
        assert_eq!(file.unwrap().parent_id, "folder_Documents");
    }

    #[tokio::test]
    async fn test_webdav_multistatus_xml_and_path_resolution() {
        use crate::webdav::xml::{WebDavProp, render_multistatus};

        let props = vec![
            WebDavProp {
                href: "/".to_string(),
                is_dir: true,
                display_name: "ProtoFS Root".to_string(),
                size_bytes: 0,
                mime_type: "httpd/unix-directory".to_string(),
                last_modified_rfc1123: "Sat, 12 Sep 2026 12:00:00 GMT".to_string(),
                quota_available_bytes: 10 * 1024 * 1024 * 1024 * 1024,
                quota_used_bytes: 0,
            },
            WebDavProp {
                href: "/drive_1/file.txt".to_string(),
                is_dir: false,
                display_name: "file.txt".to_string(),
                size_bytes: 42,
                mime_type: "text/plain".to_string(),
                last_modified_rfc1123: "Sat, 12 Sep 2026 12:00:00 GMT".to_string(),
                quota_available_bytes: 10 * 1024 * 1024 * 1024 * 1024,
                quota_used_bytes: 42,
            },
        ];

        let xml = render_multistatus(&props);
        assert!(xml.contains("<D:multistatus"));
        assert!(xml.contains("<D:href>/</D:href>"));
        assert!(xml.contains("<D:collection/>"));
        assert!(xml.contains("<D:getcontentlength>42</D:getcontentlength>"));
        assert!(xml.contains("<D:getcontenttype>text/plain</D:getcontenttype>"));

        let mut tree = VfsTree::new();
        let folder = FolderNode {
            id: "f_photos".to_string(),
            drive_id: "d1".to_string(),
            parent_id: ROOT_PARENT_ID.to_string(),
            name: "Photos".to_string(),
            is_trashed: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let file = FileNode {
            id: "pic_1".to_string(),
            drive_id: "d1".to_string(),
            parent_id: "f_photos".to_string(),
            name: "sunset.jpg".to_string(),
            size_bytes: 2048,
            mime_type: Some("image/jpeg".to_string()),
            telegram_message_id: 1,
            is_encrypted: false,
            encryption_iv: None,
            sha256_hash: None,
            is_pinned_offline: false,
            is_trashed: false,
            version: 1,
            history: Vec::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        tree.insert(VfsNode::Folder(folder));
        tree.insert(VfsNode::File(file));

        let found = tree.find_by_path("Photos/sunset.jpg");
        assert!(found.is_some());
        assert_eq!(found.unwrap().name(), "sunset.jpg");
    }
}
