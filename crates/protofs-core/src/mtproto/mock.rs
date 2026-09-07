use async_trait::async_trait;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{ProtoFsError, Result};
use crate::mtproto::transport::{
    ChannelInfo, OwnedChannel, TelegramMessage, TelegramTransport, TelegramUser,
};

pub type MessagePayloadStore = Arc<RwLock<HashMap<(i64, i32), Vec<u8>>>>;

#[derive(Clone, Default)]
pub struct MockTelegramTransport {
    user: TelegramUser,
    channels: Arc<RwLock<HashMap<i64, ChannelInfo>>>,
    messages: Arc<RwLock<HashMap<i64, Vec<TelegramMessage>>>>,
    payloads: MessagePayloadStore,
    next_msg_id: Arc<RwLock<i32>>,
}

impl MockTelegramTransport {
    pub fn new() -> Self {
        Self {
            user: TelegramUser {
                id: 11100000,
                first_name: "ProtoFS User".to_string(),
                username: Some("protofs_user".to_string()),
                phone: Some("+11100000000".to_string()),
            },
            channels: Arc::new(RwLock::new(HashMap::new())),
            messages: Arc::new(RwLock::new(HashMap::new())),
            payloads: Arc::new(RwLock::new(HashMap::new())),
            next_msg_id: Arc::new(RwLock::new(100)),
        }
    }
}

#[async_trait]
impl TelegramTransport for MockTelegramTransport {
    async fn get_me(&self) -> Result<TelegramUser> {
        Ok(self.user.clone())
    }

    async fn create_channel(&self, title: &str, _about: &str) -> Result<ChannelInfo> {
        let mut channels = self.channels.write().await;
        let id = -1001000000000 - (channels.len() as i64 + 1);
        let info = ChannelInfo {
            id,
            title: title.to_string(),
            access_hash: 123456789,
        };
        channels.insert(id, info.clone());
        Ok(info)
    }

    async fn list_owned_channels(&self) -> Result<Vec<OwnedChannel>> {
        let channels = self.channels.read().await;
        let mut list = Vec::new();

        for (id, ch) in channels.iter() {
            list.push(OwnedChannel {
                channel_id: *id,
                title: ch.title.clone(),
                is_channel: true,
                is_group: false,
                is_creator: true,
                is_admin: true,
                is_protofs_drive: true,
                about: Some("ProtoFS Encrypted Storage".to_string()),
            });
        }

        list.push(OwnedChannel {
            channel_id: -1001928471001,
            title: "ProtoFS Backup Vault".to_string(),
            is_channel: true,
            is_group: false,
            is_creator: true,
            is_admin: true,
            is_protofs_drive: true,
            about: Some("ProtoFS Encrypted Storage [protofs-id: drive_vault]".to_string()),
        });
        list.push(OwnedChannel {
            channel_id: -1001928471002,
            title: "Personal Media Channel".to_string(),
            is_channel: true,
            is_group: false,
            is_creator: true,
            is_admin: true,
            is_protofs_drive: false,
            about: Some("My personal media stream".to_string()),
        });
        list.push(OwnedChannel {
            channel_id: -1001928471003,
            title: "Family Archive Group".to_string(),
            is_channel: false,
            is_group: true,
            is_creator: true,
            is_admin: true,
            is_protofs_drive: false,
            about: None,
        });

        Ok(list)
    }

    async fn get_pinned_manifest(&self, channel_id: i64) -> Result<Option<(i32, Vec<u8>)>> {
        let messages = self.messages.read().await;
        if let Some(msg_list) = messages.get(&channel_id)
            && let Some(pinned_msg) = msg_list
                .iter()
                .rev()
                .find(|m| m.is_pinned && m.document_name.as_deref() == Some("manifest.json.zst"))
        {
            let payloads = self.payloads.read().await;
            if let Some(bytes) = payloads.get(&(channel_id, pinned_msg.id)) {
                return Ok(Some((pinned_msg.id, bytes.clone())));
            }
        }
        Ok(None)
    }

    async fn update_pinned_manifest(&self, channel_id: i64, manifest_bytes: &[u8]) -> Result<i32> {
        let mut next_id = self.next_msg_id.write().await;
        let msg_id = *next_id;
        *next_id += 1;

        let msg = TelegramMessage {
            id: msg_id,
            channel_id,
            caption: Some("ProtoFS Compressed Manifest (Pinned)".to_string()),
            document_size: Some(manifest_bytes.len() as u64),
            document_name: Some("manifest.json.zst".to_string()),
            is_pinned: true,
            date: Utc::now(),
        };

        let mut messages = self.messages.write().await;
        let list = messages.entry(channel_id).or_default();
        // Unpin older manifests
        for m in list.iter_mut() {
            if m.document_name.as_deref() == Some("manifest.json.zst") {
                m.is_pinned = false;
            }
        }
        list.push(msg);

        let mut payloads = self.payloads.write().await;
        payloads.insert((channel_id, msg_id), manifest_bytes.to_vec());

        Ok(msg_id)
    }

    async fn upload_document(
        &self,
        channel_id: i64,
        filename: &str,
        caption: &str,
        data: &[u8],
    ) -> Result<TelegramMessage> {
        let mut next_id = self.next_msg_id.write().await;
        let msg_id = *next_id;
        *next_id += 1;

        let msg = TelegramMessage {
            id: msg_id,
            channel_id,
            caption: Some(caption.to_string()),
            document_size: Some(data.len() as u64),
            document_name: Some(filename.to_string()),
            is_pinned: false,
            date: Utc::now(),
        };

        let mut messages = self.messages.write().await;
        messages.entry(channel_id).or_default().push(msg.clone());

        let mut payloads = self.payloads.write().await;
        payloads.insert((channel_id, msg_id), data.to_vec());

        Ok(msg)
    }

    async fn download_range(
        &self,
        channel_id: i64,
        message_id: i32,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<u8>> {
        let payloads = self.payloads.read().await;
        let data = payloads.get(&(channel_id, message_id)).ok_or_else(|| {
            ProtoFsError::NodeNotFound(format!("Message {} payload not found", message_id))
        })?;

        let start = offset as usize;
        if start >= data.len() {
            return Ok(Vec::new());
        }

        let end = (start + limit as usize).min(data.len());
        Ok(data[start..end].to_vec())
    }

    async fn edit_caption(
        &self,
        channel_id: i64,
        message_id: i32,
        new_caption: &str,
    ) -> Result<()> {
        let mut messages = self.messages.write().await;
        let list = messages
            .get_mut(&channel_id)
            .ok_or_else(|| ProtoFsError::DriveNotFound(channel_id.to_string()))?;
        let msg = list
            .iter_mut()
            .find(|m| m.id == message_id)
            .ok_or_else(|| ProtoFsError::NodeNotFound(message_id.to_string()))?;
        msg.caption = Some(new_caption.to_string());
        Ok(())
    }

    async fn delete_message(&self, channel_id: i64, message_id: i32) -> Result<()> {
        let mut messages = self.messages.write().await;
        if let Some(list) = messages.get_mut(&channel_id) {
            list.retain(|m| m.id != message_id);
        }
        let mut payloads = self.payloads.write().await;
        payloads.remove(&(channel_id, message_id));
        Ok(())
    }

    async fn scan_messages(
        &self,
        channel_id: i64,
        min_id: i32,
        limit: usize,
    ) -> Result<Vec<TelegramMessage>> {
        let messages = self.messages.read().await;
        let list = messages.get(&channel_id).cloned().unwrap_or_default();
        let filtered: Vec<TelegramMessage> = list
            .into_iter()
            .filter(|m| m.id > min_id)
            .take(limit)
            .collect();
        Ok(filtered)
    }
}
