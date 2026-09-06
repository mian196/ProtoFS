use std::io::Cursor;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::error::{ProtoFsError, Result};
use crate::vfs::model::{FileNode, FolderNode, VfsNode};
use crate::vfs::tree::VfsTree;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManifestHeader {
    pub version: u64,
    pub drive_id: String,
    pub generated_at: DateTime<Utc>,
    pub file_count: u64,
    pub folder_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestSnapshot {
    pub header: ManifestHeader,
    pub folders: Vec<FolderNode>,
    pub files: Vec<FileNode>,
}

impl ManifestSnapshot {
    pub fn from_tree(drive_id: &str, version: u64, tree: &VfsTree) -> Self {
        let mut folders = Vec::new();
        let mut files = Vec::new();

        for node in tree.all_nodes() {
            if node.drive_id() == drive_id {
                match node {
                    VfsNode::Folder(f) => folders.push(f.clone()),
                    VfsNode::File(f) => files.push(f.clone()),
                }
            }
        }

        Self {
            header: ManifestHeader {
                version,
                drive_id: drive_id.to_string(),
                generated_at: Utc::now(),
                file_count: files.len() as u64,
                folder_count: folders.len() as u64,
            },
            folders,
            files,
        }
    }

    pub fn to_compressed_bytes(&self) -> Result<Vec<u8>> {
        let json_bytes = serde_json::to_vec(self)
            .map_err(ProtoFsError::Serialization)?;

        zstd::encode_all(Cursor::new(json_bytes), 3)
            .map_err(|e| ProtoFsError::Compression(e.to_string()))
    }

    pub fn from_compressed_bytes(compressed: &[u8]) -> Result<Self> {
        let decompressed = zstd::decode_all(Cursor::new(compressed))
            .map_err(|e| ProtoFsError::Compression(e.to_string()))?;

        serde_json::from_slice(&decompressed)
            .map_err(ProtoFsError::Serialization)
    }

    pub fn populate_tree(&self, tree: &mut VfsTree) {
        for folder in &self.folders {
            tree.insert(VfsNode::Folder(folder.clone()));
        }
        for file in &self.files {
            tree.insert(VfsNode::File(file.clone()));
        }
    }
}
