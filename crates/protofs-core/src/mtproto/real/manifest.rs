use grammers_client::Client;
use grammers_tl_types as tl;

use super::RealTelegramTransport;
use super::messages::extract_message_id_from_updates;
use crate::error::{ProtoFsError, Result};

fn is_manifest_message(m: &tl::types::Message) -> bool {
    m.message.contains("#protofs_manifest_v1")
        || m.media.as_ref().is_some_and(|med| match med {
            tl::enums::MessageMedia::Document(d) => d.document.as_ref().is_some_and(|doc| match doc {
                tl::enums::Document::Document(doc) => doc.attributes.iter().any(|attr| {
                    matches!(attr, tl::enums::DocumentAttribute::Filename(f) if f.file_name == "manifest.json.zst")
                }),
                _ => false,
            }),
            _ => false,
        })
}

fn unpack_messages(res: tl::enums::messages::Messages) -> Vec<tl::enums::Message> {
    match res {
        tl::enums::messages::Messages::Messages(m) => m.messages,
        tl::enums::messages::Messages::Slice(s) => s.messages,
        tl::enums::messages::Messages::ChannelMessages(c) => c.messages,
        _ => Vec::new(),
    }
}

async fn fetch_candidate_messages(
    client: &Client,
    peer: &tl::enums::InputPeer,
) -> Vec<tl::enums::Message> {
    let h_req = tl::functions::messages::GetHistory {
        peer: peer.clone(),
        offset_id: 0,
        offset_date: 0,
        add_offset: 0,
        limit: 20,
        max_id: 0,
        min_id: 0,
        hash: 0,
    };
    let mut msgs = client
        .invoke(&h_req)
        .await
        .map(unpack_messages)
        .unwrap_or_default();
    if msgs.is_empty() {
        let s_req = tl::functions::messages::Search {
            peer: peer.clone(),
            q: "#protofs_manifest_v1".to_string(),
            from_id: None,
            saved_peer_id: None,
            top_msg_id: None,
            filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
            min_date: 0,
            max_date: 0,
            offset_id: 0,
            add_offset: 0,
            limit: 10,
            max_id: 0,
            min_id: 0,
            hash: 0,
            saved_reaction: None,
        };
        if let Ok(res) = client.invoke(&s_req).await {
            msgs = unpack_messages(res);
        }
    }
    msgs
}

impl RealTelegramTransport {
    pub(crate) async fn do_get_pinned_manifest(
        &self,
        channel_id: i64,
    ) -> Result<Option<(i32, Vec<u8>)>> {
        let (cid, access_hash) = self.resolve_channel_peer(channel_id).await;
        let peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id: cid,
            access_hash,
        });
        let candidates = fetch_candidate_messages(&self.client, &peer).await;

        for msg in candidates {
            if let tl::enums::Message::Message(m) = msg
                && is_manifest_message(&m)
                && let Some(tl::enums::MessageMedia::Document(doc_media)) = m.media
                && let Some(tl::enums::Document::Document(doc)) = doc_media.document
            {
                let location = tl::enums::InputFileLocation::InputDocumentFileLocation(
                    tl::types::InputDocumentFileLocation {
                        id: doc.id,
                        access_hash: doc.access_hash,
                        file_reference: doc.file_reference,
                        thumb_size: String::new(),
                    },
                );
                let download_req = tl::functions::upload::GetFile {
                    precise: true,
                    cdn_supported: false,
                    location,
                    offset: 0,
                    limit: doc.size as i32,
                };
                if let Ok(file_res) = self.client.invoke(&download_req).await {
                    let bytes = match file_res {
                        tl::enums::upload::File::File(f) => f.bytes,
                        tl::enums::upload::File::CdnRedirect(_) => Vec::new(),
                    };
                    return Ok(Some((m.id, bytes)));
                }
            }
        }
        Ok(None)
    }

    pub(crate) async fn do_update_pinned_manifest(
        &self,
        channel_id: i64,
        manifest_bytes: &[u8],
    ) -> Result<i32> {
        let (cid, access_hash) = self.resolve_channel_peer(channel_id).await;
        let input_peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
            channel_id: cid,
            access_hash,
        });
        let input_file = self
            .upload_bytes_to_telegram("manifest.json.zst", manifest_bytes)
            .await?;

        let doc_attr =
            tl::enums::DocumentAttribute::Filename(tl::types::DocumentAttributeFilename {
                file_name: "manifest.json.zst".to_string(),
            });
        let media =
            tl::enums::InputMedia::UploadedDocument(tl::types::InputMediaUploadedDocument {
                file: input_file,
                mime_type: "application/zstd".to_string(),
                attributes: vec![doc_attr],
                nosound_video: false,
                force_file: true,
                ttl_seconds: None,
                spoiler: false,
                stickers: None,
                thumb: None,
                video_cover: None,
                video_timestamp: None,
            });

        let candidates = fetch_candidate_messages(&self.client, &input_peer).await;
        let mut existing_ids = Vec::new();
        for msg in &candidates {
            if let tl::enums::Message::Message(m) = msg
                && is_manifest_message(m)
            {
                existing_ids.push(m.id);
            }
        }

        if let Some(&primary_id) = existing_ids.first() {
            let edit_req = tl::functions::messages::EditMessage {
                no_webpage: true,
                invert_media: false,
                peer: input_peer.clone(),
                id: primary_id,
                message: Some("#protofs_manifest_v1".to_string()),
                media: Some(media.clone()),
                reply_markup: None,
                entities: None,
                schedule_date: None,
                quick_reply_shortcut_id: None,
                rich_message: None,
                schedule_repeat_period: None,
            };
            if self.client.invoke(&edit_req).await.is_ok() {
                let _ = self
                    .client
                    .invoke(&tl::functions::messages::UpdatePinnedMessage {
                        silent: true,
                        unpin: false,
                        pm_oneside: false,
                        peer: input_peer.clone(),
                        id: primary_id,
                    })
                    .await;
                for &dup_id in existing_ids.iter().skip(1) {
                    let _ = self.do_delete_message(channel_id, dup_id).await;
                }
                return Ok(primary_id);
            }
        }

        let send_req = tl::functions::messages::SendMedia {
            silent: true,
            background: false,
            clear_draft: false,
            noforwards: false,
            update_stickersets_order: false,
            invert_media: false,
            peer: input_peer.clone(),
            reply_to: None,
            media,
            message: "#protofs_manifest_v1".to_string(),
            random_id: rand::random(),
            reply_markup: None,
            entities: None,
            schedule_date: None,
            send_as: None,
            quick_reply_shortcut: None,
            effect: None,
            allow_paid_floodskip: false,
            allow_paid_stars: None,
            schedule_repeat_period: None,
            suggested_post: None,
        };

        let updates = self.client.invoke(&send_req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to send pinned manifest message: {}", e))
        })?;
        let msg_id = extract_message_id_from_updates(&updates).ok_or_else(|| {
            ProtoFsError::Mtproto("Failed to extract message ID from send response".to_string())
        })?;

        let _ = self
            .client
            .invoke(&tl::functions::messages::UpdatePinnedMessage {
                silent: true,
                unpin: false,
                pm_oneside: false,
                peer: input_peer,
                id: msg_id,
            })
            .await;

        for &dup_id in &existing_ids {
            if dup_id != msg_id {
                let _ = self.do_delete_message(channel_id, dup_id).await;
            }
        }
        Ok(msg_id)
    }
}
