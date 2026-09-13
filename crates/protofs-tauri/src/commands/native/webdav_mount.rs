use std::path::Path;

use chrono::Utc;
use protofs_core::vfs::VfsNode;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::common::*;
use crate::commands::{AppState, CommandResponse, VirtualDriveStatus, WebDavServerStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedWebDavSettings {
    pub enabled: bool,
    pub port: u16,
    pub auto_mount: bool,
}

impl Default for PersistedWebDavSettings {
    fn default() -> Self {
        Self { enabled: true, port: protofs_core::webdav::DEFAULT_WEBDAV_PORT, auto_mount: false }
    }
}

pub fn load_webdav_settings(cache: &protofs_core::cache::CacheDatabase) -> PersistedWebDavSettings {
    if let Ok(Some(b)) = cache.get_secure_secret("webdav_settings")
        && let Ok(cfg) = serde_json::from_slice::<PersistedWebDavSettings>(&b) { return cfg; }
    PersistedWebDavSettings::default()
}

pub fn save_webdav_settings(cache: &protofs_core::cache::CacheDatabase, cfg: &PersistedWebDavSettings) {
    if let Ok(b) = serde_json::to_vec(cfg) { let _ = cache.set_secure_secret("webdav_settings", &b); }
}

pub async fn project_vfs_to_disk(state: &AppState, drive_id: &str, mount_root: &Path) -> Result<(), String> {
    let tree = state.engine.get_or_create_tree(drive_id).await;
    let mut folder_paths = std::collections::HashMap::new();
    folder_paths.insert("root".to_string(), mount_root.to_path_buf());

    for n in tree.all_nodes() {
        if let VfsNode::Folder(f) = n && !f.is_trashed {
            let rel = tree.resolve_relative_path(&f.id);
            let abs = if rel.is_empty() { mount_root.to_path_buf() } else { mount_root.join(&rel) };
            ensure_dir(&abs);
            folder_paths.insert(f.id.clone(), abs);
        }
    }

    for n in tree.all_nodes() {
        if let VfsNode::File(f) = n && !f.is_trashed {
            let p_dir = folder_paths.get(&f.parent_id).cloned().unwrap_or_else(|| mount_root.to_path_buf());
            let file_path = p_dir.join(&f.name);
            if !file_path.exists() {
                let stub = format!("ProtoFS Cloud Virtual File\nName: {}\nSize: {} bytes\n", f.name, f.size_bytes);
                let _ = std::fs::write(&file_path, stub.as_bytes());
            }
        }
    }

    let readme_path = mount_root.join("ProtoFS_Virtual_Drive_Info.txt");
    if !readme_path.exists() {
        let readme = "ProtoFS Virtual Cloud Drive\n===========================\nFiles displayed here stream directly from your Telegram cloud storage.\n";
        let _ = std::fs::write(&readme_path, readme.as_bytes());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_webdav_config_command(app: tauri::AppHandle) -> Result<CommandResponse<WebDavServerStatus>, String> {
    let state = app.state::<AppState>();
    let server = state.webdav_server.read().await;
    let port = server.port().await;
    Ok(CommandResponse::ok(WebDavServerStatus {
        is_running: server.is_running().await, port, url: format!("http://127.0.0.1:{}/", port), auto_mount: server.auto_mount().await,
    }))
}

#[tauri::command]
pub async fn configure_webdav_command(app: tauri::AppHandle, enabled: bool, port: u16, auto_mount: bool) -> Result<CommandResponse<WebDavServerStatus>, String> {
    let state = app.state::<AppState>();
    let target_port = if port > 0 { port } else { protofs_core::webdav::DEFAULT_WEBDAV_PORT };
    save_webdav_settings(&state.cache, &PersistedWebDavSettings { enabled, port: target_port, auto_mount });

    let mut server = state.webdav_server.write().await;
    let was_running = server.is_running().await;
    let old_port = server.port().await;

    if !enabled {
        if was_running { server.stop().await; }
    } else {
        server.set_config(protofs_core::webdav::WebDavConfig { enabled: true, port: target_port, auto_mount, auth_token: None }).await;
        if was_running && old_port != target_port {
            server.stop().await;
            let _ = server.start().await;
        } else if !was_running {
            let _ = server.start().await;
        }
    }

    let final_port = server.port().await;
    Ok(CommandResponse::ok(WebDavServerStatus {
        is_running: server.is_running().await, port: final_port, url: format!("http://127.0.0.1:{}/", final_port), auto_mount,
    }))
}

#[tauri::command]
pub async fn get_virtual_drive_status_command(app: tauri::AppHandle, drive_id: String) -> Result<CommandResponse<VirtualDriveStatus>, String> {
    let state = app.state::<AppState>();
    let server = state.webdav_server.read().await;
    let webdav_running = server.is_running().await;
    let webdav_port = server.port().await;
    let webdav_url = if drive_id.is_empty() { format!("http://127.0.0.1:{}/", webdav_port) } else { format!("http://127.0.0.1:{}/{}/", webdav_port, drive_id) };

    if drive_id.is_empty() {
        return Ok(CommandResponse::ok(VirtualDriveStatus {
            is_mounted: false, drive_id: String::new(), drive_letter: "P".to_string(), mount_path: "P:\\".to_string(),
            driver_mode: "WebDAV Streaming Network Drive (Zero-Install)".to_string(), winfsp_available: false,
            webdav_available: webdav_running, webdav_url, available_letters: get_available_drive_letters(),
            cached_files_count: 0, cached_bytes: 0, last_mounted_at: None,
        }));
    }

    let mount_state = load_mount_state(&app);
    let mount_dir = get_protofs_mount_dir(&app, &drive_id);
    let (cached_files_count, cached_bytes) = count_dir_files_and_bytes_async(mount_dir).await;
    let (is_mounted, drive_letter, mount_path, last_mounted_at) = if let Some(info) = mount_state.mounts.get(&drive_id) {
        (is_drive_letter_mounted(&info.drive_letter), info.drive_letter.clone(), format!("{}:\\", info.drive_letter), Some(info.mounted_at.clone()))
    } else {
        (false, "P".to_string(), "P:\\".to_string(), None)
    };

    Ok(CommandResponse::ok(VirtualDriveStatus {
        is_mounted, drive_id, drive_letter, mount_path,
        driver_mode: "WebDAV Streaming Network Drive (Zero-Install)".to_string(), winfsp_available: false,
        webdav_available: webdav_running, webdav_url, available_letters: get_available_drive_letters(),
        cached_files_count, cached_bytes, last_mounted_at,
    }))
}

#[tauri::command]
pub async fn mount_virtual_drive_command(
    app: tauri::AppHandle, drive_id: String, requested_letter: Option<String>, on_demand_stream: bool,
) -> Result<CommandResponse<VirtualDriveStatus>, String> {
    let state = app.state::<AppState>();
    let mount_dir = get_protofs_mount_dir(&app, &drive_id);

    {
        let mut server = state.webdav_server.write().await;
        if !server.is_running().await { let _ = server.start().await; }
    }
    let (webdav_running, webdav_port) = {
        let server = state.webdav_server.read().await;
        (server.is_running().await, server.port().await)
    };

    let _ = project_vfs_to_disk(&state, &drive_id, &mount_dir).await;

    let available = get_available_drive_letters();
    let target_letter = requested_letter
        .map(|l| l.trim().to_uppercase().chars().next().unwrap_or('P').to_string())
        .filter(|l| available.contains(l) || is_drive_letter_mounted(l))
        .unwrap_or_else(|| if available.contains(&"P".to_string()) { "P".to_string() } else { available.first().cloned().unwrap_or_else(|| "P".to_string()) });

    #[cfg(target_os = "windows")]
    {
        let drive_arg = format!("{}:", target_letter);
        let _ = silent_command("subst").args([&drive_arg, "/D"]).output();
        let _ = silent_command("net").args(["use", &drive_arg, "/delete", "/y"]).output();

        let mut mounted = false;
        if webdav_running {
            let target = format!("http://127.0.0.1:{}/", webdav_port);
            if let Ok(out) = silent_command("net").args(["use", &drive_arg, &target, "/persistent:no"]).output() && out.status.success() {
                mounted = true;
            }
        }
        if !mounted {
            let dir_str = mount_dir.to_string_lossy().to_string();
            let _ = silent_command("subst").args([&drive_arg, &dir_str]).output();
        }

        let lbl_key = format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\DriveIcons\{}\DefaultLabel", target_letter);
        let _ = silent_command("reg").args(["add", &lbl_key, "/ve", "/t", "REG_SZ", "/d", "ProtoFS", "/f"]).output();
        for k in [format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2\##127.0.0.1@{webdav_port}#DavWWWRoot"),
                  format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2\##127.0.0.1@{webdav_port}#")] {
            let _ = silent_command("reg").args(["add", &k, "/v", "_LabelFromReg", "/t", "REG_SZ", "/d", "ProtoFS", "/f"]).output();
        }
        let ps = format!(r#"$s = New-Object -ComObject Shell.Application; $d = $s.NameSpace("{target_letter}:\"); if ($d) {{ $d.Self.Name = "ProtoFS" }}"#);
        let _ = silent_command("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &ps]).output();
    }

    #[cfg(target_os = "macos")]
    if webdav_running {
        let _ = silent_command("osascript").args(["-e", &format!("mount volume \"http://127.0.0.1:{}/{}\"", webdav_port, drive_id)]).output();
    }
    #[cfg(target_os = "linux")]
    if webdav_running {
        let _ = silent_command("gio").args(["mount", &format!("dav://127.0.0.1:{}/{}", webdav_port, drive_id)]).output();
    }

    let now_str = Utc::now().to_rfc3339();
    let mut mount_state = load_mount_state(&app);
    mount_state.mounts.insert(drive_id.clone(), PersistedMountInfo {
        drive_id: drive_id.clone(), drive_letter: target_letter.clone(), mount_path: mount_dir.to_string_lossy().to_string(),
        mounted_at: now_str.clone(), on_demand: on_demand_stream,
    });
    save_mount_state(&app, &mount_state);

    let (cached_files_count, cached_bytes) = count_dir_files_and_bytes_async(mount_dir).await;
    Ok(CommandResponse::ok(VirtualDriveStatus {
        is_mounted: true, drive_id: drive_id.clone(), drive_letter: target_letter.clone(), mount_path: format!("{}:\\", target_letter),
        driver_mode: "WebDAV Streaming Network Drive (Zero-Install)".to_string(), winfsp_available: false, webdav_available: webdav_running,
        webdav_url: format!("http://127.0.0.1:{}/{}/", webdav_port, drive_id), available_letters: get_available_drive_letters(),
        cached_files_count, cached_bytes, last_mounted_at: Some(now_str),
    }))
}

#[tauri::command]
pub async fn unmount_virtual_drive_command(app: tauri::AppHandle, drive_id: String) -> Result<CommandResponse<VirtualDriveStatus>, String> {
    let mut mount_state = load_mount_state(&app);
    let letter = mount_state.mounts.remove(&drive_id).map(|i| i.drive_letter).unwrap_or_else(|| "P".to_string());
    save_mount_state(&app, &mount_state);

    #[cfg(target_os = "windows")]
    {
        let drive_arg = format!("{}:", letter);
        let _ = silent_command("net").args(["use", &drive_arg, "/delete", "/y"]).output();
        let _ = silent_command("subst").args([&drive_arg, "/D"]).output();
        let lbl_key = format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\DriveIcons\{}", letter);
        let _ = silent_command("reg").args(["delete", &lbl_key, "/f"]).output();
    }
    #[cfg(target_os = "macos")]
    let _ = silent_command("diskutil").args(["unmount", &format!("/Volumes/ProtoFS - {}", drive_id)]).output();
    #[cfg(target_os = "linux")]
    {
        let server = app.state::<AppState>().webdav_server.read().await;
        let _ = silent_command("gio").args(["mount", "-u", &format!("dav://127.0.0.1:{}/{}", server.port().await, drive_id)]).output();
    }

    let state = app.state::<AppState>();
    let server = state.webdav_server.read().await;
    let webdav_running = server.is_running().await;
    let webdav_port = server.port().await;
    let mount_dir = get_protofs_mount_dir(&app, &drive_id);
    let (cached_files_count, cached_bytes) = count_dir_files_and_bytes_async(mount_dir).await;

    Ok(CommandResponse::ok(VirtualDriveStatus {
        is_mounted: false, drive_id: drive_id.clone(), drive_letter: letter.clone(), mount_path: format!("{}:\\", letter),
        driver_mode: "WebDAV Streaming Network Drive (Zero-Install)".to_string(), winfsp_available: false, webdav_available: webdav_running,
        webdav_url: format!("http://127.0.0.1:{}/{}/", webdav_port, drive_id), available_letters: get_available_drive_letters(),
        cached_files_count, cached_bytes, last_mounted_at: None,
    }))
}

pub fn unmount_all_virtual_drives_cleanup(app: &tauri::AppHandle) {
    let mount_state = load_mount_state(app);
    for (_drive_id, info) in mount_state.mounts {
        #[cfg(target_os = "windows")]
        {
            let drive_arg = format!("{}:", info.drive_letter);
            let _ = silent_command("net").args(["use", &drive_arg, "/delete", "/y"]).output();
            let _ = silent_command("subst").args([&drive_arg, "/D"]).output();
            let k = format!(r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\DriveIcons\{}", info.drive_letter);
            let _ = silent_command("reg").args(["delete", &k, "/f"]).output();
        }
    }
}
