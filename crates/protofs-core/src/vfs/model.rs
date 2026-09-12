use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const ROOT_PARENT_ID: &str = "root";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DriveMetadata {
    pub id: String,
    pub name: String,
    pub channel_id: i64,
    pub pinned_manifest_msg_id: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FolderNode {
    pub id: String,
    pub drive_id: String,
    pub parent_id: String,
    pub name: String,
    #[serde(default)]
    pub is_trashed: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileVersion {
    pub version: u32,
    pub telegram_message_id: i32,
    pub size_bytes: u64,
    pub mime_type: Option<String>,
    pub sha256_hash: Option<String>,
    pub is_encrypted: bool,
    pub encryption_iv: Option<String>,
    pub created_at: DateTime<Utc>,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileNode {
    pub id: String,
    pub drive_id: String,
    pub parent_id: String,
    pub name: String,
    pub size_bytes: u64,
    pub mime_type: Option<String>,
    pub telegram_message_id: i32,
    pub is_encrypted: bool,
    pub encryption_iv: Option<String>,
    pub sha256_hash: Option<String>,
    pub is_pinned_offline: bool,
    pub is_trashed: bool,
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub history: Vec<FileVersion>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind")]
pub enum VfsNode {
    Folder(FolderNode),
    File(FileNode),
}

impl VfsNode {
    pub fn id(&self) -> &str {
        match self {
            VfsNode::Folder(f) => &f.id,
            VfsNode::File(f) => &f.id,
        }
    }

    pub fn parent_id(&self) -> &str {
        match self {
            VfsNode::Folder(f) => &f.parent_id,
            VfsNode::File(f) => &f.parent_id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            VfsNode::Folder(f) => &f.name,
            VfsNode::File(f) => &f.name,
        }
    }

    pub fn drive_id(&self) -> &str {
        match self {
            VfsNode::Folder(f) => &f.drive_id,
            VfsNode::File(f) => &f.drive_id,
        }
    }

    pub fn is_trashed(&self) -> bool {
        match self {
            VfsNode::Folder(f) => f.is_trashed,
            VfsNode::File(f) => f.is_trashed,
        }
    }
}
