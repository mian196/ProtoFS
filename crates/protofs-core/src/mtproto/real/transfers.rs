use chrono::Utc;
use grammers_tl_types as tl;
use tokio::time::{sleep, Duration};

use super::RealTelegramTransport;
use crate::error::{ProtoFsError, Result};
use crate::mtproto::transport::TelegramMessage;

pub const MTPROTO_CHUNK_SIZE: usize = 512 * 1024;

fn parse_flood_wait_seconds(err: &str) -> Option<u64> {
    err.split("FLOOD_WAIT_")
        .nth(1)?
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse::<u64>()
        .ok()
}

impl RealTelegramTransport {
    pub(crate) async fn upload_bytes_to_telegram(
        &self,
        filename: &str,
        data: &[u8],
    ) -> Result<tl::enums::InputFile> {
        let _permit = self.transfer_semaphore.acquire().await.map_err(|_| {
            ProtoFsError::Internal("Transfer semaphore closed".to_string())
        })?;

        let temp = tempfile::NamedTempFile::new().map_err(ProtoFsError::Io)?;
        std::fs::write(temp.path(), data).map_err(ProtoFsError::Io)?;
        let uploaded = self.client.upload_file(temp.path()).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to upload file '{}': {}", filename, e))
        })?;
        Ok(uploaded.raw)
    }

    pub(crate) async fn do_upload_document(
        &self,
        channel_id: i64,
        filename: &str,
        caption: &str,
        data: &[u8],
    ) -> Result<TelegramMessage> {
        let (channel_id, access_hash) = self.resolve_channel_peer(channel_id).await;
        let mut retries = 0;

        loop {
            let input_file = self.upload_bytes_to_telegram(filename, data).await?;
            let input_peer = tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
                channel_id,
                access_hash,
            });

            let media =
                tl::enums::InputMedia::UploadedDocument(tl::types::InputMediaUploadedDocument {
                    file: input_file,
                    mime_type: "application/octet-stream".to_string(),
                    attributes: vec![tl::enums::DocumentAttribute::Filename(
                        tl::types::DocumentAttributeFilename {
                            file_name: filename.to_string(),
                        },
                    )],
                    nosound_video: false,
                    force_file: true,
                    ttl_seconds: None,
                    spoiler: false,
                    stickers: None,
                    thumb: None,
                    video_cover: None,
                    video_timestamp: None,
                });

            let send_req = tl::functions::messages::SendMedia {
                silent: false,
                background: false,
                clear_draft: false,
                noforwards: false,
                update_stickersets_order: false,
                invert_media: false,
                peer: input_peer,
                reply_to: None,
                media,
                message: caption.to_string(),
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

            match self.client.invoke(&send_req).await {
                Ok(updates) => {
                    let msg_id =
                        super::messages::extract_message_id_from_updates(&updates).unwrap_or(1);
                    return Ok(TelegramMessage {
                        id: msg_id,
                        channel_id,
                        caption: Some(caption.to_string()),
                        document_size: Some(data.len() as u64),
                        document_name: Some(filename.to_string()),
                        is_pinned: false,
                        date: Utc::now(),
                    });
                }
                Err(e) => {
                    let err_str = e.to_string();
                    if err_str.contains("FLOOD_WAIT_")
                        && retries < 2
                        && let Some(secs) = parse_flood_wait_seconds(&err_str)
                        && secs <= 60
                    {
                        sleep(Duration::from_secs(secs + 1)).await;
                        retries += 1;
                        continue;
                    }
                    return Err(ProtoFsError::Mtproto(format!(
                        "Failed to send document: {}",
                        e
                    )));
                }
            }
        }
    }

    pub(crate) async fn do_download_range(
        &self,
        channel_id: i64,
        message_id: i32,
        offset: u64,
        limit: u32,
    ) -> Result<Vec<u8>> {
        let _permit = self.transfer_semaphore.acquire().await.map_err(|_| {
            ProtoFsError::Internal("Transfer semaphore closed".to_string())
        })?;

        let (channel_id, access_hash) = self.resolve_channel_peer(channel_id).await;
        let get_msg_req = tl::functions::channels::GetMessages {
            channel: tl::enums::InputChannel::Channel(tl::types::InputChannel {
                channel_id,
                access_hash,
            }),
            id: vec![tl::enums::InputMessage::Id(tl::types::InputMessageId {
                id: message_id,
            })],
        };

        let res = self.client.invoke(&get_msg_req).await.map_err(|e| {
            ProtoFsError::Mtproto(format!("Failed to fetch message #{}: {}", message_id, e))
        })?;

        let messages = match res {
            tl::enums::messages::Messages::Messages(m) => m.messages,
            tl::enums::messages::Messages::Slice(s) => s.messages,
            tl::enums::messages::Messages::ChannelMessages(c) => c.messages,
            tl::enums::messages::Messages::NotModified(_) => Vec::new(),
        };

        for msg in messages {
            if let tl::enums::Message::Message(m) = msg
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
                    offset: offset as i64,
                    limit: limit as i32,
                };
                if let Ok(file_res) = self.client.invoke(&download_req).await {
                    let bytes = match file_res {
                        tl::enums::upload::File::File(f) => f.bytes,
                        tl::enums::upload::File::CdnRedirect(_) => Vec::new(),
                    };
                    return Ok(bytes);
                }
            }
        }

        Ok(Vec::new())
    }
}
