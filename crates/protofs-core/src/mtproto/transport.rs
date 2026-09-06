use crate::error::Result;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TelegramUser {
    pub id: i64,
    pub first_name: String,
    pub username: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub id: i64,
    pub title: String,
    pub access_hash: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramMessage {
    pub id: i32,
    pub channel_id: i64,
    pub caption: Option<String>,
    pub document_size: Option<u64>,
    pub document_name: Option<String>,
    pub is_pinned: bool,
    pub date: DateTime<Utc>,
}

#[async_trait]
pub trait TelegramTransport: Send + Sync {
    async fn get_me(&self) -> Result<TelegramUser>;
    async fn create_channel(&self, title: &str, about: &str) -> Result<ChannelInfo>;
    async fn get_pinned_manifest(&self, channel_id: i64) -> Result<Option<(i32, Vec<u8>)>>;
    async fn update_pinned_manifest(&self, channel_id: i64, manifest_bytes: &[u8]) -> Result<i32>;
    async fn upload_document(
        &self,
        channel_id: i64,
        filename: &str,
        caption: &str,
        data: &[u8],
    ) -> Result<TelegramMessage>;
    async fn download_range(
        &self,
        channel_id: i64,
        message_id: i32,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<u8>>;
    async fn edit_caption(&self, channel_id: i64, message_id: i32, new_caption: &str)
        -> Result<()>;
    async fn delete_message(&self, channel_id: i64, message_id: i32) -> Result<()>;
    async fn scan_messages(
        &self,
        channel_id: i64,
        min_id: i32,
        limit: usize,
    ) -> Result<Vec<TelegramMessage>>;
}
