pub mod cache;
pub mod crypto;
pub mod error;
pub mod manifest;
pub mod vfs;

pub use cache::CacheDatabase;
pub use error::{ProtoFsError, Result};
pub use manifest::ManifestSnapshot;
pub use vfs::{FileNode, FolderNode, VfsNode, VfsTree, ROOT_PARENT_ID};

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_vfs_tree_operations() {
        let mut tree = VfsTree::new();

        let folder = FolderNode {
            id: "f_1".to_string(),
            drive_id: "drive_main".to_string(),
            parent_id: ROOT_PARENT_ID.to_string(),
            name: "Documents".to_string(),
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
    }

    #[test]
    fn test_manifest_zstd_compression_roundtrip() {
        let mut tree = VfsTree::new();
        tree.insert(VfsNode::Folder(FolderNode {
            id: "f_demo".to_string(),
            drive_id: "personal".to_string(),
            parent_id: ROOT_PARENT_ID.to_string(),
            name: "Vault".to_string(),
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
}
