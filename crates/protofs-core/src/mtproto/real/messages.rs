use chrono::Utc;
use grammers_tl_types as tl;

use super::RealTelegramTransport;
use crate::error::{ProtoFsError, Result};
use crate::mtproto::transport::TelegramMessage;

pub(crate) fn extract_message_id_from_updates(updates: &tl::enums::Updates) -> Option<i32> {
    let list: &[tl::enums::Update] = match updates {
        tl::enums::Updates::Updates(u) => &u.updates,
        tl::enums::Updates::Combined(c) => &c.updates,
        tl::enums::Updates::UpdateShortSentMessage(m) => return Some(m.id),
        tl::enums::Updates::UpdateShortMessage(m) => return Some(m.id),
        tl::enums::Updates::UpdateShortChatMessage(m) => return Some(m.id),
        _ => return None,
    };
    for upd in list {
        match upd {
            tl::enums::Update::NewMessage(nm) => {
                if let tl::enums::Message::Message(m) = &nm.message {
                    return Some(m.id);
                }
            }
            tl::enums::Update::NewChannelMessage(ncm) => {
                if let tl::enums::Message::Message(m) = &ncm.message {
                    return Some(m.id);
                }
            }
            _ => {}
        }
    }
    None
}

impl RealTelegramTransport {
    pub(crate) async fn do_edit_caption(
        &self,
        channel_id: i64,
        message_id: i32,
        new_caption: &str,
    ) -> Result<()> {
        let (cid, access_hash) = self.resolve_channel_peer(channel_id).await;
        let peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id: cid,
            access_hash,
        });
        let req = tl::functions::messages::EditMessage {
            no_webpage: true,
            invert_media: false,
            peer,
            id: message_id,
            message: Some(new_caption.to_string()),
            media: None,
            reply_markup: None,
            entities: None,
            schedule_date: None,
            quick_reply_shortcut_id: None,
            rich_message: None,
            schedule_repeat_period: None,
        };
        self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!(
                "Failed to edit caption for message #{}: {}",
                message_id, e
            ))
        })?;
        Ok(())
    }

    pub(crate) async fn do_delete_message(&self, channel_id: i64, message_id: i32) -> Result<()> {
        let (cid, access_hash) = self.resolve_channel_peer(channel_id).await;
        let channel = tl::enums::InputChannel::Channel(tl::types::InputChannel {
            channel_id: cid,
            access_hash,
        });
        let req = tl::functions::channels::DeleteMessages {
            channel,
            id: vec![message_id],
        };
        self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to delete message #{}: {}", message_id, e))
        })?;
        Ok(())
    }

    pub(crate) async fn do_send_text_message(&self, channel_id: i64, text: &str) -> Result<i32> {
        let (cid, access_hash) = self.resolve_channel_peer(channel_id).await;
        let peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id: cid,
            access_hash,
        });
        let req = tl::functions::messages::SendMessage {
            no_webpage: true,
            silent: false,
            background: false,
            clear_draft: false,
            noforwards: false,
            update_stickersets_order: false,
            invert_media: false,
            peer,
            reply_to: None,
            message: text.to_string(),
            random_id: rand::random(),
            reply_markup: None,
            entities: None,
            schedule_date: None,
            send_as: None,
            quick_reply_shortcut: None,
            rich_message: None,
            effect: None,
            allow_paid_floodskip: false,
            allow_paid_stars: None,
            schedule_repeat_period: None,
            suggested_post: None,
        };
        let updates =
            self.client.invoke(&req).await.map_err(|e| {
                ProtoFsError::Mtproto(format!("Failed to send text message: {}", e))
            })?;
        Ok(extract_message_id_from_updates(&updates).unwrap_or(1))
    }

    pub(crate) async fn do_scan_messages(
        &self,
        channel_id: i64,
        min_id: i32,
        limit: usize,
    ) -> Result<Vec<TelegramMessage>> {
        let (cid, access_hash) = self.resolve_channel_peer(channel_id).await;
        let peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id: cid,
            access_hash,
        });
        let req = tl::functions::messages::GetHistory {
            peer,
            offset_id: 0,
            offset_date: 0,
            add_offset: 0,
            limit: limit as i32,
            max_id: 0,
            min_id,
            hash: 0,
        };
        let res = self.client.invoke(&req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!(
                "Failed to scan message history for channel {}: {}",
                channel_id, e
            ))
        })?;

        let raw = match res {
            tl::enums::messages::Messages::Messages(m) => m.messages,
            tl::enums::messages::Messages::Slice(s) => s.messages,
            tl::enums::messages::Messages::ChannelMessages(c) => c.messages,
            _ => Vec::new(),
        };

        let mut result = Vec::new();
        for msg in raw {
            if let tl::enums::Message::Message(m) = msg {
                let mut size = None;
                let mut name = None;
                if let Some(tl::enums::MessageMedia::Document(doc_media)) = &m.media
                    && let Some(tl::enums::Document::Document(doc)) = &doc_media.document
                {
                    size = Some(doc.size as u64);
                    for attr in &doc.attributes {
                        if let tl::enums::DocumentAttribute::Filename(f) = attr {
                            name = Some(f.file_name.clone());
                        }
                    }
                }
                result.push(TelegramMessage {
                    id: m.id,
                    channel_id,
                    caption: m.message.into(),
                    document_size: size,
                    document_name: name,
                    is_pinned: m.pinned,
                    date: chrono::DateTime::from_timestamp(m.date as i64, 0)
                        .unwrap_or_else(Utc::now),
                });
            }
        }
        Ok(result)
    }
}
