use chrono::Utc;
use tauri::Manager;

use super::common::*;
use crate::commands::{AppState, CommandResponse, VirtualDriveStatus};

fn make_virtual_drive_status(
    is_mounted: bool,
    drive_id: String,
    drive_letter: String,
    webdav: (bool, u16),
    cache_stats: (usize, u64),
    last_mounted_at: Option<String>,
) -> VirtualDriveStatus {
    let (webdav_running, webdav_port) = webdav;
    let (cached_files_count, cached_bytes) = cache_stats;
    let webdav_url = if drive_id.is_empty() {
        format!("http://127.0.0.1:{}/", webdav_port)
    } else {
        format!("http://127.0.0.1:{}/{}/", webdav_port, drive_id)
    };
    VirtualDriveStatus {
        is_mounted,
        drive_id,
        drive_letter: drive_letter.clone(),
        mount_path: format!("{}:\\", drive_letter),
        driver_mode: "WebDAV Streaming Network Drive (Zero-Install)".to_string(),
        winfsp_available: false,
        webdav_available: webdav_running,
        webdav_url,
        available_letters: get_available_drive_letters(),
        cached_files_count,
        cached_bytes,
        last_mounted_at,
    }
}

#[tauri::command]
pub async fn get_virtual_drive_status_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<VirtualDriveStatus>, String> {
    let state = app.state::<AppState>();
    let server = state.webdav_server.read().await;
    let webdav_running = server.is_running().await;
    let webdav_port = server.port().await;

    if drive_id.is_empty() {
        return Ok(CommandResponse::ok(make_virtual_drive_status(
            false,
            String::new(),
            "P".to_string(),
            (webdav_running, webdav_port),
            (0, 0),
            None,
        )));
    }

    let mount_state = load_mount_state(&app);
    let mount_dir = get_protofs_mount_dir(&app, &drive_id);
    let (cached_files_count, cached_bytes) = count_dir_files_and_bytes_async(mount_dir).await;
    let (is_mounted, drive_letter, last_mounted_at) =
        if let Some(info) = mount_state.mounts.get(&drive_id) {
            (
                is_drive_letter_mounted(&info.drive_letter),
                info.drive_letter.clone(),
                Some(info.mounted_at.clone()),
            )
        } else {
            (false, "P".to_string(), None)
        };

    Ok(CommandResponse::ok(make_virtual_drive_status(
        is_mounted,
        drive_id,
        drive_letter,
        (webdav_running, webdav_port),
        (cached_files_count, cached_bytes),
        last_mounted_at,
    )))
}

#[tauri::command]
pub async fn mount_virtual_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
    requested_letter: Option<String>,
    on_demand_stream: bool,
) -> Result<CommandResponse<VirtualDriveStatus>, String> {
    let state = app.state::<AppState>();
    let mount_dir = get_protofs_mount_dir(&app, &drive_id);

    {
        let mut server = state.webdav_server.write().await;
        if !server.is_running().await {
            let _ = server.start().await;
        }
    }
    let (webdav_running, webdav_port) = {
        let server = state.webdav_server.read().await;
        (server.is_running().await, server.port().await)
    };

    let _ = project_vfs_to_disk(&state, &drive_id, &mount_dir).await;

    let available = get_available_drive_letters();
    let target_letter = requested_letter
        .map(|l| {
            l.trim()
                .to_uppercase()
                .chars()
                .next()
                .unwrap_or('P')
                .to_string()
        })
        .filter(|l| available.contains(l) || is_drive_letter_mounted(l))
        .unwrap_or_else(|| {
            if available.contains(&"P".to_string()) {
                "P".to_string()
            } else {
                available
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "P".to_string())
            }
        });

    #[cfg(target_os = "windows")]
    {
        let drive_arg = format!("{}:", target_letter);
        let _ = silent_command("subst").args([&drive_arg, "/D"]).output();
        let _ = silent_command("net")
            .args(["use", &drive_arg, "/delete", "/y"])
            .output();

        let mut mounted = false;
        if webdav_running {
            let target = format!("http://127.0.0.1:{}/", webdav_port);
            if let Ok(out) = silent_command("net")
                .args(["use", &drive_arg, &target, "/persistent:no"])
                .output()
                && out.status.success()
            {
                mounted = true;
            }
        }
        if !mounted {
            let dir_str = mount_dir.to_string_lossy().to_string();
            let _ = silent_command("subst")
                .args([&drive_arg, &dir_str])
                .output();
        }

        let lbl_key = format!(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\DriveIcons\{}\DefaultLabel",
            target_letter
        );
        let _ = silent_command("reg")
            .args([
                "add", &lbl_key, "/ve", "/t", "REG_SZ", "/d", "ProtoFS", "/f",
            ])
            .output();
        for k in [
            format!(
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2\##127.0.0.1@{webdav_port}#DavWWWRoot"
            ),
            format!(
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\MountPoints2\##127.0.0.1@{webdav_port}#"
            ),
        ] {
            let _ = silent_command("reg")
                .args([
                    "add",
                    &k,
                    "/v",
                    "_LabelFromReg",
                    "/t",
                    "REG_SZ",
                    "/d",
                    "ProtoFS",
                    "/f",
                ])
                .output();
        }
        let ps = format!(
            r#"$s = New-Object -ComObject Shell.Application; $d = $s.NameSpace("{target_letter}:\"); if ($d) {{ $d.Self.Name = "ProtoFS" }}"#
        );
        let _ = silent_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
            .output();
    }

    #[cfg(target_os = "macos")]
    if webdav_running {
        let _ = silent_command("osascript")
            .args([
                "-e",
                &format!(
                    "mount volume \"http://127.0.0.1:{}/{}\"",
                    webdav_port, drive_id
                ),
            ])
            .output();
    }
    #[cfg(target_os = "linux")]
    if webdav_running {
        let _ = silent_command("gio")
            .args([
                "mount",
                &format!("dav://127.0.0.1:{}/{}", webdav_port, drive_id),
            ])
            .output();
    }

    let now_str = Utc::now().to_rfc3339();
    let mut mount_state = load_mount_state(&app);
    mount_state.mounts.insert(
        drive_id.clone(),
        PersistedMountInfo {
            drive_id: drive_id.clone(),
            drive_letter: target_letter.clone(),
            mount_path: mount_dir.to_string_lossy().to_string(),
            mounted_at: now_str.clone(),
            on_demand: on_demand_stream,
        },
    );
    save_mount_state(&app, &mount_state);

    let (cached_files_count, cached_bytes) = count_dir_files_and_bytes_async(mount_dir).await;
    Ok(CommandResponse::ok(make_virtual_drive_status(
        true,
        drive_id,
        target_letter,
        (webdav_running, webdav_port),
        (cached_files_count, cached_bytes),
        Some(now_str),
    )))
}

#[tauri::command]
pub async fn unmount_virtual_drive_command(
    app: tauri::AppHandle,
    drive_id: String,
) -> Result<CommandResponse<VirtualDriveStatus>, String> {
    let mut mount_state = load_mount_state(&app);
    let letter = mount_state
        .mounts
        .remove(&drive_id)
        .map(|i| i.drive_letter)
        .unwrap_or_else(|| "P".to_string());
    save_mount_state(&app, &mount_state);

    #[cfg(target_os = "windows")]
    {
        let drive_arg = format!("{}:", letter);
        let _ = silent_command("net")
            .args(["use", &drive_arg, "/delete", "/y"])
            .output();
        let _ = silent_command("subst").args([&drive_arg, "/D"]).output();
        let lbl_key = format!(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\DriveIcons\{}",
            letter
        );
        let _ = silent_command("reg")
            .args(["delete", &lbl_key, "/f"])
            .output();
    }
    #[cfg(target_os = "macos")]
    let _ = silent_command("diskutil")
        .args(["unmount", &format!("/Volumes/ProtoFS - {}", drive_id)])
        .output();
    #[cfg(target_os = "linux")]
    {
        let state = app.state::<AppState>();
        let server = state.webdav_server.read().await;
        let port = server.port().await;
        drop(server);
        let _ = silent_command("gio")
            .args([
                "mount",
                "-u",
                &format!("dav://127.0.0.1:{}/{}", port, drive_id),
            ])
            .output();
    }

    let state = app.state::<AppState>();
    let server = state.webdav_server.read().await;
    let webdav_running = server.is_running().await;
    let webdav_port = server.port().await;
    let mount_dir = get_protofs_mount_dir(&app, &drive_id);
    let (cached_files_count, cached_bytes) = count_dir_files_and_bytes_async(mount_dir).await;

    Ok(CommandResponse::ok(make_virtual_drive_status(
        false,
        drive_id,
        letter,
        (webdav_running, webdav_port),
        (cached_files_count, cached_bytes),
        None,
    )))
}

pub fn unmount_all_virtual_drives_cleanup(app: &tauri::AppHandle) {
    let mount_state = load_mount_state(app);
    for (_drive_id, _info) in mount_state.mounts {
        #[cfg(target_os = "windows")]
        {
            let drive_arg = format!("{}:", _info.drive_letter);
            let _ = silent_command("net")
                .args(["use", &drive_arg, "/delete", "/y"])
                .output();
            let _ = silent_command("subst").args([&drive_arg, "/D"]).output();
            let k = format!(
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\DriveIcons\{}",
                _info.drive_letter
            );
            let _ = silent_command("reg").args(["delete", &k, "/f"]).output();
        }
    }
}
