use chrono::Utc;
use protofs_core::vfs::{DriveMetadata, FileNode, VfsNode};
use tauri::Manager;

use super::settings::save_secure_secret_command;
use super::{AppState, CommandResponse, ParsedShareLink, ShareLinkInfo, guess_mime};

pub fn url_encode(input: &str) -> String {
    let mut encoded = String::new();
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            encoded.push(b as char);
        } else {
            encoded.push_str(&format!("%{:02X}", b));
        }
    }
    encoded
}

pub fn url_decode(input: &str) -> String {
    let mut decoded = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..=i + 2]).unwrap_or(""), 16)
            {
                decoded.push(val);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            decoded.push(b' ');
            i += 1;
            continue;
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}

#[tauri::command]
pub async fn generate_share_link_command(
    app: tauri::AppHandle,
    drive_id: String,
    file_id: String,
    include_key: Option<String>,
) -> Result<CommandResponse<ShareLinkInfo>, String> {
    let state = app.state::<AppState>();
    let tree = state.engine.get_or_create_tree(&drive_id).await;
    let file = match tree.get_file(&file_id) {
        Some(f) => f.clone(),
        None => return Ok(CommandResponse::err(format!("File {} not found", file_id))),
    };

    let drives_guard = state.drives.read().await;
    let drive = drives_guard
        .iter()
        .find(|d| d.id == drive_id)
        .cloned()
        .unwrap_or_else(|| DriveMetadata {
            id: drive_id.clone(),
            name: "Cloud Drive".to_string(),
            channel_id: -1001928374650,
            pinned_manifest_msg_id: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        });
    drop(drives_guard);

    let clean_cid = drive.channel_id.abs();
    let clean_cid_str = clean_cid.to_string();
    let stripped_cid = if clean_cid_str.starts_with("100") && clean_cid_str.len() > 3 {
        &clean_cid_str[3..]
    } else {
        &clean_cid_str
    };

    let telegram_message_link = format!(
        "https://t.me/c/{}/{}",
        stripped_cid, file.telegram_message_id
    );
    let telegram_web_link = format!(
        "https://web.telegram.org/a/#-{}_{}",
        clean_cid, file.telegram_message_id
    );

    let mut protofs_app_link = format!(
        "protofs://share?drive={}&file={}&channel={}&msg={}&name={}&size={}&enc={}",
        url_encode(&drive_id),
        url_encode(&file_id),
        drive.channel_id,
        file.telegram_message_id,
        url_encode(&file.name),
        file.size_bytes,
        file.is_encrypted
    );

    if let Some(ref key) = include_key
        && !key.trim().is_empty()
    {
        protofs_app_link.push_str(&format!("#key={}", url_encode(key.trim())));
    }

    let zero_knowledge_note = if file.is_encrypted {
        if include_key
            .as_ref()
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false)
        {
            "Zero-Knowledge Protection: The encryption key is included in the URL fragment hash (#key=...). In adherence to RFC 3986, fragment hashes are processed client-side only and never transmitted over the network or to Telegram servers.".to_string()
        } else {
            "Zero-Knowledge Protection: This file is encrypted with AES-256-GCM. The recipient must possess the decryption key to open it.".to_string()
        }
    } else {
        "Public Telegram Link: This file was uploaded in plaintext. Anyone with channel access can view or download it directly.".to_string()
    };

    Ok(CommandResponse::ok(ShareLinkInfo {
        file_id: file.id,
        file_name: file.name,
        drive_id: drive.id,
        drive_name: drive.name,
        channel_id: drive.channel_id,
        telegram_message_id: file.telegram_message_id,
        size_bytes: file.size_bytes,
        mime_type: file.mime_type,
        is_encrypted: file.is_encrypted,
        telegram_message_link,
        telegram_web_link,
        protofs_app_link,
        channel_invite_url: None,
        zero_knowledge_note,
    }))
}

#[tauri::command]
pub async fn parse_share_link_command(
    link_url: String,
) -> Result<CommandResponse<ParsedShareLink>, String> {
    let trimmed = link_url.trim();
    if trimmed.is_empty() {
        return Ok(CommandResponse::err("Link URL cannot be empty"));
    }

    if trimmed.starts_with("protofs://share") {
        let (main_part, frag_part) = match trimmed.split_once('#') {
            Some((m, f)) => (m, Some(f)),
            None => (trimmed, None),
        };

        let key = frag_part.and_then(|f| f.strip_prefix("key=").map(url_decode));

        let query_str = main_part.split_once('?').map(|(_, q)| q).unwrap_or("");
        let mut drive_id = None;
        let mut file_id = None;
        let mut channel_id = None;
        let mut msg_id = None;
        let mut name = "Shared_File".to_string();
        let mut size_bytes = 0u64;
        let mut is_encrypted = false;

        for pair in query_str.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                match k {
                    "drive" => drive_id = Some(url_decode(v)),
                    "file" => file_id = Some(url_decode(v)),
                    "channel" => channel_id = v.parse::<i64>().ok(),
                    "msg" => msg_id = v.parse::<i32>().ok(),
                    "name" => name = url_decode(v),
                    "size" => size_bytes = v.parse::<u64>().unwrap_or(0),
                    "enc" => is_encrypted = v == "true" || v == "1",
                    _ => {}
                }
            }
        }

        return Ok(CommandResponse::ok(ParsedShareLink {
            is_valid: true,
            drive_id,
            file_id,
            channel_id,
            telegram_message_id: msg_id,
            name,
            size_bytes,
            is_encrypted,
            encryption_key: key,
            original_url: trimmed.to_string(),
        }));
    }

    if trimmed.contains("t.me/c/") {
        let after = trimmed.split("t.me/c/").nth(1).unwrap_or("");
        let parts: Vec<&str> = after.split('/').collect();
        if parts.len() >= 2 {
            let cid_num: i64 = parts[0].parse().unwrap_or(0);
            let mid_num: i32 = parts[1]
                .split('?')
                .next()
                .unwrap_or("")
                .parse()
                .unwrap_or(0);
            if cid_num > 0 && mid_num > 0 {
                let full_channel_id = -1000000000000 - cid_num;
                return Ok(CommandResponse::ok(ParsedShareLink {
                    is_valid: true,
                    drive_id: None,
                    file_id: None,
                    channel_id: Some(full_channel_id),
                    telegram_message_id: Some(mid_num),
                    name: format!("Telegram_Message_{}.bin", mid_num),
                    size_bytes: 0,
                    is_encrypted: false,
                    encryption_key: None,
                    original_url: trimmed.to_string(),
                }));
            }
        }
    }

    Ok(CommandResponse::err(
        "Invalid share link format. Expected protofs://share?... or https://t.me/c/...".to_string(),
    ))
}

#[tauri::command]
pub async fn import_shared_link_command(
    app: tauri::AppHandle,
    target_drive_id: String,
    target_parent_id: String,
    link_url: String,
    custom_name: Option<String>,
    custom_key: Option<String>,
) -> Result<CommandResponse<FileNode>, String> {
    let parsed_res = parse_share_link_command(link_url.clone()).await?;
    let parsed = match parsed_res.data {
        Some(p) if p.is_valid => p,
        _ => {
            return Ok(CommandResponse::err(
                parsed_res
                    .error
                    .unwrap_or_else(|| "Invalid share link".to_string()),
            ));
        }
    };

    let msg_id = match parsed.telegram_message_id {
        Some(m) if m > 0 => m,
        _ => (Utc::now().timestamp_subsec_millis() as i32) + 2000,
    };

    let final_name = custom_name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or(parsed.name);

    let state = app.state::<AppState>();
    let id = format!("file_{}", Utc::now().timestamp_millis());
    let mime = Some(guess_mime(&final_name));
    let is_encrypted = parsed.is_encrypted;
    let iv = if is_encrypted {
        Some(format!(
            "{:016x}",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ))
    } else {
        None
    };

    let new_file = FileNode {
        id: id.clone(),
        drive_id: target_drive_id.clone(),
        parent_id: target_parent_id,
        name: final_name,
        size_bytes: parsed.size_bytes,
        mime_type: mime,
        telegram_message_id: msg_id,
        is_encrypted,
        encryption_iv: iv,
        sha256_hash: None,
        is_pinned_offline: false,
        is_trashed: false,
        version: 1,
        history: Vec::new(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    if let Err(e) = state
        .engine
        .add_node(&target_drive_id, VfsNode::File(new_file.clone()))
        .await
    {
        return Ok(CommandResponse::err(e.to_string()));
    }

    let key_to_store = custom_key.or(parsed.encryption_key);
    if let Some(key) = key_to_store
        && !key.trim().is_empty()
    {
        let secret_key = format!("protofs_key_{}_{}", target_drive_id, id);
        let _ = save_secure_secret_command(app, secret_key, key).await;
    }

    Ok(CommandResponse::ok(new_file))
}
