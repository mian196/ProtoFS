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
    input_channel: Option<&tl::types::InputChannel>,
) -> Vec<tl::enums::Message> {
    let mut msgs = Vec::new();

    // Strategy 1: Search for pinned messages in the channel
    let pin_req = tl::functions::messages::Search {
        peer: peer.clone(),
        q: String::new(),
        from_id: None,
        saved_peer_id: None,
        top_msg_id: None,
        filter: tl::enums::MessagesFilter::InputMessagesFilterPinned,
        min_date: 0,
        max_date: 0,
        offset_id: 0,
        add_offset: 0,
        limit: 50,
        max_id: 0,
        min_id: 0,
        hash: 0,
        saved_reaction: None,
    };
    if let Ok(res) = client.invoke(&pin_req).await {
        msgs.extend(unpack_messages(res));
    }

    // Strategy 2: Query GetFullChannel for pinned_msg_id & early message IDs
    if let Some(channel_peer) = input_channel {
        let full_req = tl::functions::channels::GetFullChannel {
            channel: tl::enums::InputChannel::Channel(channel_peer.clone()),
        };
        if let Ok(full_res) = client.invoke(&full_req).await {
            let pinned_id_opt = match full_res {
                tl::enums::messages::ChatFull::Full(cf) => match cf.full_chat {
                    tl::enums::ChatFull::ChannelFull(c) => c.pinned_msg_id,
                    _ => None,
                },
            };
            if let Some(pinned_id) = pinned_id_opt {
                let get_msg_req = tl::functions::channels::GetMessages {
                    channel: tl::enums::InputChannel::Channel(channel_peer.clone()),
                    id: vec![tl::enums::InputMessage::Id(tl::types::InputMessageId {
                        id: pinned_id,
                    })],
                };
                if let Ok(res) = client.invoke(&get_msg_req).await {
                    msgs.extend(unpack_messages(res));
                }
            }
        }

        // Strategy 3: Check early messages (IDs 1 through 10) - message #2 is the manifest
        let early_ids: Vec<tl::enums::InputMessage> = (1..=10)
            .map(|id| tl::enums::InputMessage::Id(tl::types::InputMessageId { id }))
            .collect();
        let early_req = tl::functions::channels::GetMessages {
            channel: tl::enums::InputChannel::Channel(channel_peer.clone()),
            id: early_ids,
        };
        if let Ok(res) = client.invoke(&early_req).await {
            msgs.extend(unpack_messages(res));
        }
    }

    // Strategy 4: Search for hashtag/text "#protofs_manifest_v1" (InputMessagesFilterEmpty)
    let text_search_req = tl::functions::messages::Search {
        peer: peer.clone(),
        q: "#protofs_manifest_v1".to_string(),
        from_id: None,
        saved_peer_id: None,
        top_msg_id: None,
        filter: tl::enums::MessagesFilter::InputMessagesFilterEmpty,
        min_date: 0,
        max_date: 0,
        offset_id: 0,
        add_offset: 0,
        limit: 20,
        max_id: 0,
        min_id: 0,
        hash: 0,
        saved_reaction: None,
    };
    if let Ok(res) = client.invoke(&text_search_req).await {
        msgs.extend(unpack_messages(res));
    }

    // Strategy 5: Search for document filename "manifest.json.zst" (InputMessagesFilterDocument)
    let doc_search_req = tl::functions::messages::Search {
        peer: peer.clone(),
        q: "manifest.json.zst".to_string(),
        from_id: None,
        saved_peer_id: None,
        top_msg_id: None,
        filter: tl::enums::MessagesFilter::InputMessagesFilterDocument,
        min_date: 0,
        max_date: 0,
        offset_id: 0,
        add_offset: 0,
        limit: 20,
        max_id: 0,
        min_id: 0,
        hash: 0,
        saved_reaction: None,
    };
    if let Ok(res) = client.invoke(&doc_search_req).await {
        msgs.extend(unpack_messages(res));
    }

    // Strategy 6: Latest history
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
    if let Ok(res) = client.invoke(&h_req).await {
        msgs.extend(unpack_messages(res));
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
        let input_channel = tl::types::InputChannel {
            channel_id: cid,
            access_hash,
        };
        let candidates = fetch_candidate_messages(&self.client, &peer, Some(&input_channel)).await;

        let mut manifest_msgs = Vec::new();
        for msg in candidates {
            if let tl::enums::Message::Message(m) = msg
                && is_manifest_message(&m)
                && let Some(tl::enums::MessageMedia::Document(ref doc_media)) = m.media
                && let Some(tl::enums::Document::Document(ref _doc)) = doc_media.document
            {
                manifest_msgs.push(m);
            }
        }

        // Prefer pinned message first, otherwise sort by ID descending (latest snapshot)
        manifest_msgs.sort_by(|a, b| {
            if a.pinned && !b.pinned {
                std::cmp::Ordering::Less
            } else if !a.pinned && b.pinned {
                std::cmp::Ordering::Greater
            } else {
                b.id.cmp(&a.id)
            }
        });

        for m in manifest_msgs {
            if let Some(tl::enums::MessageMedia::Document(doc_media)) = m.media
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
        let input_channel = tl::types::InputChannel {
            channel_id: cid,
            access_hash,
        };
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

        let candidates =
            fetch_candidate_messages(&self.client, &input_peer, Some(&input_channel)).await;
        let mut manifest_ids = Vec::new();
        let mut pinned_manifest_id = None;
        let mut all_pinned_ids = Vec::new();

        for msg in &candidates {
            if let tl::enums::Message::Message(m) = msg {
                if m.pinned {
                    all_pinned_ids.push(m.id);
                }
                if is_manifest_message(m) {
                    manifest_ids.push(m.id);
                    if m.pinned && pinned_manifest_id.is_none() {
                        pinned_manifest_id = Some(m.id);
                    }
                }
            }
        }
        manifest_ids.sort_unstable();
        manifest_ids.dedup();
        all_pinned_ids.sort_unstable();
        all_pinned_ids.dedup();

        // Choose primary manifest message:
        // Prefer already pinned manifest if present; otherwise the earliest manifest message (e.g. msg #2, the second topmost message in channel)
        let chosen_target_id = pinned_manifest_id.or_else(|| manifest_ids.first().copied());

        if let Some(target_id) = chosen_target_id {
            let edit_req = tl::functions::messages::EditMessage {
                no_webpage: true,
                invert_media: false,
                peer: input_peer.clone(),
                id: target_id,
                message: Some("#protofs_manifest_v1".to_string()),
                media: Some(media.clone()),
                reply_markup: None,
                entities: None,
                schedule_date: None,
                quick_reply_shortcut_id: None,
                rich_message: None,
                schedule_repeat_period: None,
            };
            match self.client.invoke(&edit_req).await {
                Ok(_) => {
                    // Ensure the target manifest message is pinned
                    let _ = self
                        .client
                        .invoke(&tl::functions::messages::UpdatePinnedMessage {
                            silent: true,
                            unpin: false,
                            pm_oneside: false,
                            peer: input_peer.clone(),
                            id: target_id,
                        })
                        .await;

                    // Clean up: unpin any other pinned messages so only ONE pinned message exists
                    for &other_pinned in &all_pinned_ids {
                        if other_pinned != target_id {
                            let _ = self
                                .client
                                .invoke(&tl::functions::messages::UpdatePinnedMessage {
                                    silent: true,
                                    unpin: true,
                                    pm_oneside: false,
                                    peer: input_peer.clone(),
                                    id: other_pinned,
                                })
                                .await;
                        }
                    }

                    // Delete duplicate manifest messages to prevent leftover duplicates
                    for &dup_id in &manifest_ids {
                        if dup_id != target_id {
                            let _ = self.do_delete_message(channel_id, dup_id).await;
                        }
                    }
                    return Ok(target_id);
                }
                Err(e) => {
                    tracing::warn!(
                        "Failed to edit existing pinned manifest #{}: {}. Falling back to sending new message.",
                        target_id,
                        e
                    );
                }
            }
        }

        // Fallback: Send new manifest message
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

        // Pin the new manifest message
        let _ = self
            .client
            .invoke(&tl::functions::messages::UpdatePinnedMessage {
                silent: true,
                unpin: false,
                pm_oneside: false,
                peer: input_peer.clone(),
                id: msg_id,
            })
            .await;

        // Unpin any other pinned messages
        for &other_pinned in &all_pinned_ids {
            if other_pinned != msg_id {
                let _ = self
                    .client
                    .invoke(&tl::functions::messages::UpdatePinnedMessage {
                        silent: true,
                        unpin: true,
                        pm_oneside: false,
                        peer: input_peer.clone(),
                        id: other_pinned,
                    })
                    .await;
            }
        }

        // Delete any older duplicate manifest messages
        for &dup_id in &manifest_ids {
            if dup_id != msg_id {
                let _ = self.do_delete_message(channel_id, dup_id).await;
            }
        }
        Ok(msg_id)
    }
}
