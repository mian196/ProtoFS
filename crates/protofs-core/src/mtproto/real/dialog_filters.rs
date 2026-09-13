use grammers_tl_types as tl;
use tracing::{info, warn};

use super::RealTelegramTransport;
use crate::error::Result;

#[allow(dead_code)]
impl RealTelegramTransport {
    pub(crate) async fn do_sync_chat_folder(&self, folder_title: &str, channel_ids: &[i64]) -> Result<()> {
        let effective_title = if folder_title.is_empty() || folder_title.chars().count() > 12 {
            "ProtoFS"
        } else {
            folder_title
        };

        let req = tl::functions::messages::GetDialogFilters {};
        let filters_res = self.client.invoke(&req).await;
        let filters: Vec<tl::enums::DialogFilter> = match filters_res {
            Ok(tl::enums::messages::DialogFilters::Filters(f)) => f.filters,
            Err(e) => {
                warn!("Failed to get dialog filters from Telegram: {}", e);
                return Ok(());
            }
        };

        let mut include_peers: Vec<tl::enums::InputPeer> = Vec::new();
        for &cid in channel_ids {
            let (resolved_id, access_hash) = self.resolve_channel_peer(cid).await;
            if access_hash != 0 {
                include_peers.push(tl::enums::InputPeer::Channel(tl::types::InputPeerChannel {
                    channel_id: resolved_id,
                    access_hash,
                }));
            } else {
                warn!("Could not resolve access hash for channel {}, skipping from chat folder", cid);
            }
        }

        let mut existing_folder_id: Option<i32> = None;
        let mut max_id: i32 = 1;

        for f in &filters {
            match f {
                tl::enums::DialogFilter::Filter(filter) => {
                    max_id = max_id.max(filter.id);
                    let title_text = match &filter.title {
                        tl::enums::TextWithEntities::Entities(twe) => &twe.text,
                    };
                    if title_text.eq_ignore_ascii_case(effective_title)
                        || title_text.eq_ignore_ascii_case("ProtoFS")
                        || title_text.eq_ignore_ascii_case("ProtoFS-Drive")
                        || title_text.eq_ignore_ascii_case("ProtoFS-Drives")
                    {
                        existing_folder_id = Some(filter.id);
                        break;
                    }
                }
                tl::enums::DialogFilter::Chatlist(chatlist) => {
                    max_id = max_id.max(chatlist.id);
                    let title_text = match &chatlist.title {
                        tl::enums::TextWithEntities::Entities(twe) => &twe.text,
                    };
                    if title_text.eq_ignore_ascii_case(effective_title)
                        || title_text.eq_ignore_ascii_case("ProtoFS")
                        || title_text.eq_ignore_ascii_case("ProtoFS-Drive")
                        || title_text.eq_ignore_ascii_case("ProtoFS-Drives")
                    {
                        existing_folder_id = Some(chatlist.id);
                        break;
                    }
                }
                tl::enums::DialogFilter::Default => {}
            }
        }

        let folder_id = existing_folder_id.unwrap_or(max_id + 1);

        let filter_obj = tl::types::DialogFilter {
            contacts: false,
            non_contacts: false,
            groups: false,
            broadcasts: false,
            bots: false,
            exclude_muted: false,
            exclude_read: false,
            exclude_archived: false,
            title_noanimate: false,
            id: folder_id,
            title: tl::enums::TextWithEntities::Entities(tl::types::TextWithEntities {
                text: effective_title.to_string(),
                entities: Vec::new(),
            }),
            emoticon: Some("💾".to_string()),
            pinned_peers: Vec::new(),
            include_peers,
            exclude_peers: Vec::new(),
            color: None,
        };

        let update_req = tl::functions::messages::UpdateDialogFilter {
            id: folder_id,
            filter: Some(tl::enums::DialogFilter::Filter(filter_obj)),
        };

        if let Err(e) = self.client.invoke(&update_req).await {
            warn!("Failed to update Telegram chat folder '{}': {}", effective_title, e);
        } else {
            info!(
                "Successfully synchronized Telegram chat folder '{}' (id: {}) with {} channel(s)",
                effective_title, folder_id, channel_ids.len()
            );
        }

        Ok(())
    }
}
