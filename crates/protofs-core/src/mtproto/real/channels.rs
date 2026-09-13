use std::collections::HashMap;
use std::sync::Arc;

use grammers_client::Client;
use grammers_session::storages::MemorySession;
use grammers_session::types::{PeerId, PeerInfo};
use grammers_session::Session;
use grammers_tl_types as tl;
use tokio::sync::RwLock;

use super::RealTelegramTransport;
use crate::error::{ProtoFsError, Result};
use crate::mtproto::transport::{ChannelInfo, OwnedChannel, TelegramUser};

pub fn normalize_channel_id(channel_id: i64) -> i64 {
    let id_str = channel_id.abs().to_string();
    if id_str.len() > 10 && id_str.starts_with("100") && let Ok(parsed) = id_str[3..].parse::<i64>() {
        return parsed;
    }
    channel_id.abs()
}

pub async fn get_channel_access_hash(
    client: &Client,
    session: &MemorySession,
    channel_hashes: &Arc<RwLock<HashMap<i64, i64>>>,
    channel_id: i64,
) -> i64 {
    let normalized = normalize_channel_id(channel_id);

    {
        let map = channel_hashes.read().await;
        if let Some(&h) = map.get(&channel_id).or_else(|| map.get(&normalized))
            && h != 0
        {
            return h;
        }
    }

    if let Ok(Some(PeerInfo::Channel { auth: Some(auth), .. })) =
        session.peer(PeerId::channel_unchecked(normalized)).await
    {
        let h = auth.hash();
        if h != 0 {
            let mut map = channel_hashes.write().await;
            map.insert(channel_id, h);
            map.insert(normalized, h);
            return h;
        }
    }

    let mut offset_id = 0;
    let mut offset_date = 0;
    let offset_peer = tl::enums::InputPeer::Empty;

    for _ in 0..3 {
        let req = tl::functions::messages::GetDialogs {
            exclude_pinned: false,
            folder_id: None,
            offset_date,
            offset_id,
            offset_peer: offset_peer.clone(),
            limit: 100,
            hash: 0,
        };

        if let Ok(dialogs) = client.invoke(&req).await {
            let (chats, messages) = match dialogs {
                tl::enums::messages::Dialogs::Dialogs(d) => (d.chats, d.messages),
                tl::enums::messages::Dialogs::Slice(s) => (s.chats, s.messages),
                tl::enums::messages::Dialogs::NotModified(_) => (Vec::new(), Vec::new()),
            };

            let mut map = channel_hashes.write().await;
            for chat in chats {
                if let tl::enums::Chat::Channel(c) = chat
                    && let Some(hash) = c.access_hash
                    && hash != 0
                {
                    map.insert(c.id, hash);
                    map.insert(normalize_channel_id(c.id), hash);
                }
            }

            if let Some(&h) = map.get(&channel_id).or_else(|| map.get(&normalized))
                && h != 0
            {
                return h;
            }

            if messages.is_empty() {
                break;
            }

            if let Some(last_msg) = messages.last() {
                match last_msg {
                    tl::enums::Message::Message(m) => { offset_id = m.id; offset_date = m.date; }
                    tl::enums::Message::Service(s) => { offset_id = s.id; offset_date = s.date; }
                    tl::enums::Message::Empty(_) => break,
                }
            } else {
                break;
            }
        } else {
            break;
        }
    }

    if let Ok(Some(PeerInfo::Channel { auth: Some(auth), .. })) =
        session.peer(PeerId::channel_unchecked(normalized)).await
    {
        let h = auth.hash();
        let mut map = channel_hashes.write().await;
        map.insert(channel_id, h);
        map.insert(normalized, h);
        return h;
    }

    0
}

#[allow(dead_code)]
impl RealTelegramTransport {
    pub(crate) async fn do_get_me(&self) -> Result<TelegramUser> {
        let me = self.client.get_me().await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to get current user info: {}", e))
        })?;

        Ok(TelegramUser {
            id: me.id().bare_id_unchecked(),
            first_name: me.first_name().unwrap_or("Telegram User").to_string(),
            username: me.username().map(|s| s.to_string()),
            phone: None,
        })
    }

    pub(crate) async fn do_create_channel(&self, title: &str, about: &str) -> Result<ChannelInfo> {
        let req = tl::functions::channels::CreateChannel {
            broadcast: true,
            megagroup: false,
            title: title.to_string(),
            about: about.to_string(),
            geo_point: None,
            address: None,
            for_import: false,
            forum: false,
            ttl_period: None,
        };

        let updates = self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to create Telegram storage channel: {}", e))
        })?;

        if let tl::enums::Updates::Updates(u) = updates {
            for chat in u.chats {
                if let tl::enums::Chat::Channel(c) = chat {
                    let access_hash = c.access_hash.unwrap_or(0);
                    if access_hash != 0 {
                        let mut map = self.channel_hashes.write().await;
                        map.insert(c.id, access_hash);
                        map.insert(normalize_channel_id(c.id), access_hash);
                    }
                    return Ok(ChannelInfo {
                        id: c.id,
                        title: c.title,
                        access_hash,
                    });
                }
            }
        }

        Err(ProtoFsError::Mtproto("Failed to parse created channel response from Telegram".to_string()))
    }

    pub(crate) async fn do_list_owned_channels(&self) -> Result<Vec<OwnedChannel>> {
        let req = tl::functions::messages::GetDialogs {
            exclude_pinned: false,
            folder_id: None,
            offset_date: 0,
            offset_id: 0,
            offset_peer: tl::enums::InputPeer::Empty,
            limit: 100,
            hash: 0,
        };

        let dialogs = self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to retrieve Telegram dialogs: {}", e))
        })?;

        let chats = match dialogs {
            tl::enums::messages::Dialogs::Dialogs(d) => d.chats,
            tl::enums::messages::Dialogs::Slice(s) => s.chats,
            tl::enums::messages::Dialogs::NotModified(_) => Vec::new(),
        };

        let mut owned = Vec::new();
        {
            let mut map = self.channel_hashes.write().await;
            for chat in &chats {
                if let tl::enums::Chat::Channel(c) = chat
                    && let Some(hash) = c.access_hash
                    && hash != 0
                {
                    map.insert(c.id, hash);
                    map.insert(normalize_channel_id(c.id), hash);
                }
            }
        }

        for chat in chats {
            match chat {
                tl::enums::Chat::Channel(c) => {
                    let is_creator = c.creator;
                    let is_admin = c.admin_rights.is_some();
                    if is_creator || is_admin {
                        let is_protofs = c.title.to_lowercase().contains("protofs");
                        owned.push(OwnedChannel {
                            channel_id: c.id,
                            title: c.title,
                            is_channel: c.broadcast,
                            is_group: c.megagroup,
                            is_creator,
                            is_admin,
                            is_protofs_drive: is_protofs,
                            about: None,
                        });
                    }
                }
                tl::enums::Chat::Chat(c) => {
                    let is_creator = c.creator;
                    let is_admin = c.admin_rights.is_some();
                    if is_creator || is_admin {
                        let is_protofs = c.title.to_lowercase().contains("protofs");
                        owned.push(OwnedChannel {
                            channel_id: c.id,
                            title: c.title,
                            is_channel: false,
                            is_group: true,
                            is_creator,
                            is_admin,
                            is_protofs_drive: is_protofs,
                            about: None,
                        });
                    }
                }
                _ => {}
            }
        }

        Ok(owned)
    }

    #[allow(dead_code)]
    pub async fn delete_channel(&self, channel_id: i64) -> Result<()> {
        let (resolved_id, access_hash) = self.resolve_channel_peer(channel_id).await;
        let input_channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
            channel_id: resolved_id,
            access_hash,
        });
        let req = tl::functions::channels::DeleteChannel { channel: input_channel };
        self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to delete Telegram channel {}: {}", channel_id, e))
        })?;
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn leave_channel(&self, channel_id: i64) -> Result<()> {
        let (resolved_id, access_hash) = self.resolve_channel_peer(channel_id).await;
        let input_channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
            channel_id: resolved_id,
            access_hash,
        });
        let req = tl::functions::channels::LeaveChannel { channel: input_channel };
        self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to leave Telegram channel {}: {}", channel_id, e))
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    pub fn test_channel_id_normalization() {
        assert_eq!(normalize_channel_id(123456789), 123456789);
        assert_eq!(normalize_channel_id(-1001234567890), 1234567890);
        assert_eq!(normalize_channel_id(1001234567890), 1234567890);
    }
}
