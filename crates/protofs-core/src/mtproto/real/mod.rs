use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use grammers_client::Client;
use grammers_session::storages::MemorySession;
use tokio::sync::{RwLock, Semaphore};

use super::transport::*;
use crate::error::Result;

pub mod auth;
pub mod channels;
pub mod dialog_filters;
pub mod manifest;
pub mod messages;
pub mod qr;
pub mod session;
pub mod transfers;

pub use auth::*;
pub use channels::*;
pub use qr::*;
pub use session::*;
pub use transfers::*;

use crate::mtproto::proxy::ProxyConfig;

pub struct RealTelegramTransport {
    pub(crate) client: Client,
    pub(crate) session: Arc<MemorySession>,
    #[allow(dead_code)]
    pub(crate) api_id: i32,
    #[allow(dead_code)]
    pub(crate) api_hash: String,
    pub(crate) proxy: Arc<RwLock<Option<ProxyConfig>>>,
    pub(crate) channel_hashes: Arc<RwLock<HashMap<i64, i64>>>,
    pub(crate) transfer_semaphore: Arc<Semaphore>,
}

impl RealTelegramTransport {
    pub fn new(client: Client, session: Arc<MemorySession>, api_id: i32, api_hash: String) -> Self {
        Self::with_proxy(client, session, api_id, api_hash, None)
    }

    pub fn with_proxy(
        client: Client,
        session: Arc<MemorySession>,
        api_id: i32,
        api_hash: String,
        proxy: Option<ProxyConfig>,
    ) -> Self {
        Self {
            client,
            session,
            api_id,
            api_hash,
            proxy: Arc::new(RwLock::new(proxy)),
            channel_hashes: Arc::new(RwLock::new(HashMap::new())),
            transfer_semaphore: Arc::new(Semaphore::new(4)),
        }
    }

    pub async fn set_proxy(&self, proxy: Option<ProxyConfig>) {
        let mut lock = self.proxy.write().await;
        *lock = proxy;
    }

    pub async fn get_proxy(&self) -> Option<ProxyConfig> {
        let lock = self.proxy.read().await;
        lock.clone()
    }

    pub(crate) async fn resolve_channel_peer(&self, raw_channel_id: i64) -> (i64, i64) {
        let channel_id = channels::normalize_channel_id(raw_channel_id);
        let hash = channels::get_channel_access_hash(
            &self.client,
            &self.session,
            &self.channel_hashes,
            channel_id,
        )
        .await;
        (channel_id, hash)
    }
}

#[async_trait]
impl TelegramTransport for RealTelegramTransport {
    async fn get_me(&self) -> Result<TelegramUser> {
        self.do_get_me().await
    }

    async fn create_channel(&self, title: &str, about: &str) -> Result<ChannelInfo> {
        self.do_create_channel(title, about).await
    }

    async fn list_owned_channels(&self) -> Result<Vec<OwnedChannel>> {
        self.do_list_owned_channels().await
    }

    async fn get_pinned_manifest(&self, channel_id: i64) -> Result<Option<(i32, Vec<u8>)>> {
        self.do_get_pinned_manifest(channel_id).await
    }

    async fn update_pinned_manifest(&self, channel_id: i64, manifest_bytes: &[u8]) -> Result<i32> {
        self.do_update_pinned_manifest(channel_id, manifest_bytes)
            .await
    }

    async fn upload_document(
        &self,
        channel_id: i64,
        filename: &str,
        caption: &str,
        data: &[u8],
    ) -> Result<TelegramMessage> {
        self.do_upload_document(channel_id, filename, caption, data)
            .await
    }

    async fn download_range(
        &self,
        channel_id: i64,
        message_id: i32,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<u8>> {
        self.do_download_range(channel_id, message_id, offset, limit)
            .await
    }

    async fn edit_caption(
        &self,
        channel_id: i64,
        message_id: i32,
        new_caption: &str,
    ) -> Result<()> {
        self.do_edit_caption(channel_id, message_id, new_caption)
            .await
    }

    async fn delete_message(&self, channel_id: i64, message_id: i32) -> Result<()> {
        self.do_delete_message(channel_id, message_id).await
    }

    async fn send_text_message(&self, channel_id: i64, text: &str) -> Result<i32> {
        self.do_send_text_message(channel_id, text).await
    }

    async fn scan_messages(
        &self,
        channel_id: i64,
        min_id: i32,
        limit: usize,
    ) -> Result<Vec<TelegramMessage>> {
        self.do_scan_messages(channel_id, min_id, limit).await
    }

    async fn sync_chat_folder(&self, folder_title: &str, channel_ids: &[i64]) -> Result<()> {
        self.do_sync_chat_folder(folder_title, channel_ids).await
    }
}
