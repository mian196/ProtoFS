use super::real::RealTelegramTransport;
use super::transport::{
    ChannelInfo, OwnedChannel, TelegramMessage, TelegramTransport, TelegramUser,
};
use crate::error::{ProtoFsError, Result};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::RwLock;

pub enum TransportBackend {
    Unauthenticated,
    Real(RealTelegramTransport),
}

#[derive(Clone)]
pub struct DynamicTelegramTransport {
    backend: Arc<RwLock<TransportBackend>>,
}

impl Default for DynamicTelegramTransport {
    fn default() -> Self {
        Self::new_unauthenticated()
    }
}

impl DynamicTelegramTransport {
    pub fn new_unauthenticated() -> Self {
        Self {
            backend: Arc::new(RwLock::new(TransportBackend::Unauthenticated)),
        }
    }

    pub fn new_real(real: RealTelegramTransport) -> Self {
        Self {
            backend: Arc::new(RwLock::new(TransportBackend::Real(real))),
        }
    }

    pub async fn switch_to_real(&self, real: RealTelegramTransport) {
        let mut lock = self.backend.write().await;
        *lock = TransportBackend::Real(real);
    }

    pub async fn disconnect(&self) {
        let mut lock = self.backend.write().await;
        *lock = TransportBackend::Unauthenticated;
    }
}

#[async_trait]
impl TelegramTransport for DynamicTelegramTransport {
    async fn get_me(&self) -> Result<TelegramUser> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.get_me().await,
        }
    }

    async fn create_channel(&self, title: &str, about: &str) -> Result<ChannelInfo> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.create_channel(title, about).await,
        }
    }

    async fn list_owned_channels(&self) -> Result<Vec<OwnedChannel>> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.list_owned_channels().await,
        }
    }

    async fn get_pinned_manifest(&self, channel_id: i64) -> Result<Option<(i32, Vec<u8>)>> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.get_pinned_manifest(channel_id).await,
        }
    }

    async fn update_pinned_manifest(&self, channel_id: i64, manifest_bytes: &[u8]) -> Result<i32> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.update_pinned_manifest(channel_id, manifest_bytes).await,
        }
    }

    async fn upload_document(
        &self,
        channel_id: i64,
        filename: &str,
        caption: &str,
        data: &[u8],
    ) -> Result<TelegramMessage> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => {
                r.upload_document(channel_id, filename, caption, data).await
            }
        }
    }

    async fn download_range(
        &self,
        channel_id: i64,
        message_id: i32,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<u8>> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => {
                r.download_range(channel_id, message_id, offset, limit)
                    .await
            }
        }
    }

    async fn edit_caption(
        &self,
        channel_id: i64,
        message_id: i32,
        new_caption: &str,
    ) -> Result<()> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.edit_caption(channel_id, message_id, new_caption).await,
        }
    }

    async fn delete_message(&self, channel_id: i64, message_id: i32) -> Result<()> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.delete_message(channel_id, message_id).await,
        }
    }

    async fn scan_messages(
        &self,
        channel_id: i64,
        min_id: i32,
        limit: usize,
    ) -> Result<Vec<TelegramMessage>> {
        let lock = self.backend.read().await;
        match &*lock {
            TransportBackend::Unauthenticated => Err(ProtoFsError::Mtproto(
                "Not authenticated with Telegram".to_string(),
            )),
            TransportBackend::Real(r) => r.scan_messages(channel_id, min_id, limit).await,
        }
    }
}
