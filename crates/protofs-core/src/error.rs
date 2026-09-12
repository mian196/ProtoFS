use thiserror::Error;

#[derive(Error, Debug)]
pub enum ProtoFsError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Compression error: {0}")]
    Compression(String),

    #[error("Cryptographic error: {0}")]
    Crypto(String),

    #[error("Node not found: {0}")]
    NodeNotFound(String),

    #[error("Drive not found: {0}")]
    DriveNotFound(String),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("VFS error: {0}")]
    Vfs(String),

    #[error("Manifest conflict: remote version {remote} > local version {local}")]
    ManifestConflict { local: u64, remote: u64 },

    #[error("MTProto transport error: {0}")]
    Mtproto(String),

    #[error("Caption parse error: {0}")]
    CaptionParse(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, ProtoFsError>;
