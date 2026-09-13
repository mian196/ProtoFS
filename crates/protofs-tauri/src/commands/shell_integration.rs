use super::{CommandResponse, ensure_dir, silent_command};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellIntegrationStatus {
    pub send_to_enabled: bool,
    pub context_menu_enabled: bool,
    pub platform: String,
    pub send_to_path: String,
    pub target_exe: String,
}

#[tauri::command]
pub async fn get_shell_integration_status_command()
-> Result<CommandResponse<ShellIntegrationStatus>, String> {
    let target_exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "protofs-tauri.exe".to_string());

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        let send_to_dir = std::path::PathBuf::from(&appdata).join("Microsoft\\Windows\\SendTo");
        let send_to_cmd = send_to_dir.join("ProtoFS.cmd");
        let send_to_lnk = send_to_dir.join("ProtoFS.lnk");
        let send_to_enabled = send_to_cmd.exists() || send_to_lnk.exists();

        let reg_output = silent_command("reg")
            .args(["query", r"HKCU\Software\Classes\*\shell\ProtoFS"])
            .output();
        let context_menu_enabled = match reg_output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        };

        Ok(CommandResponse::ok(ShellIntegrationStatus {
            send_to_enabled,
            context_menu_enabled,
            platform: "windows".to_string(),
            send_to_path: send_to_dir.to_string_lossy().to_string(),
            target_exe,
        }))
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let desktop_file = std::path::PathBuf::from(&home)
            .join(".local/share/applications/protofs-upload.desktop");
        let enabled = desktop_file.exists();

        Ok(CommandResponse::ok(ShellIntegrationStatus {
            send_to_enabled: enabled,
            context_menu_enabled: enabled,
            platform: "linux".to_string(),
            send_to_path: desktop_file.to_string_lossy().to_string(),
            target_exe,
        }))
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Ok(CommandResponse::ok(ShellIntegrationStatus {
            send_to_enabled: false,
            context_menu_enabled: false,
            platform: std::env::consts::OS.to_string(),
            send_to_path: String::new(),
            target_exe,
        }))
    }
}

#[tauri::command]
pub async fn set_shell_integration_command(
    enable_send_to: bool,
    enable_context_menu: bool,
) -> Result<CommandResponse<ShellIntegrationStatus>, String> {
    let target_exe = std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "protofs-tauri.exe".to_string());

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
        let send_to_dir = std::path::PathBuf::from(&appdata).join("Microsoft\\Windows\\SendTo");
        if !send_to_dir.exists() {
            ensure_dir(&send_to_dir);
        }
        let send_to_cmd = send_to_dir.join("ProtoFS.cmd");

        if enable_send_to {
            let safe_exe = target_exe.replace('"', "\"\"");
            let cmd_content = format!(
                "@echo off\r\nstart \"\" \"{}\" --upload \"%*\"\r\n",
                safe_exe.replace('/', "\\")
            );
            std::fs::write(&send_to_cmd, cmd_content.as_bytes()).map_err(|e| e.to_string())?;
        } else {
            if send_to_cmd.exists() {
                let _ = std::fs::remove_file(&send_to_cmd);
            }
            let send_to_lnk = send_to_dir.join("ProtoFS.lnk");
            if send_to_lnk.exists() {
                let _ = std::fs::remove_file(&send_to_lnk);
            }
        }

        let esc_exe = target_exe.replace('/', "\\");
        if enable_context_menu {
            let _ = silent_command("reg")
                .args([
                    "add",
                    r"HKCU\Software\Classes\*\shell\ProtoFS",
                    "/ve",
                    "/d",
                    "Upload to ProtoFS",
                    "/f",
                ])
                .output();
            let _ = silent_command("reg")
                .args([
                    "add",
                    r"HKCU\Software\Classes\*\shell\ProtoFS",
                    "/v",
                    "Icon",
                    "/d",
                    &esc_exe,
                    "/f",
                ])
                .output();
            let cmd_val = format!("\"{}\" --upload \"%1\"", esc_exe);
            let _ = silent_command("reg")
                .args([
                    "add",
                    r"HKCU\Software\Classes\*\shell\ProtoFS\command",
                    "/ve",
                    "/d",
                    &cmd_val,
                    "/f",
                ])
                .output();

            let _ = silent_command("reg")
                .args([
                    "add",
                    r"HKCU\Software\Classes\Directory\shell\ProtoFS",
                    "/ve",
                    "/d",
                    "Upload to ProtoFS",
                    "/f",
                ])
                .output();
            let _ = silent_command("reg")
                .args([
                    "add",
                    r"HKCU\Software\Classes\Directory\shell\ProtoFS",
                    "/v",
                    "Icon",
                    "/d",
                    &esc_exe,
                    "/f",
                ])
                .output();
            let _ = silent_command("reg")
                .args([
                    "add",
                    r"HKCU\Software\Classes\Directory\shell\ProtoFS\command",
                    "/ve",
                    "/d",
                    &cmd_val,
                    "/f",
                ])
                .output();
        } else {
            let _ = silent_command("reg")
                .args(["delete", r"HKCU\Software\Classes\*\shell\ProtoFS", "/f"])
                .output();
            let _ = silent_command("reg")
                .args([
                    "delete",
                    r"HKCU\Software\Classes\Directory\shell\ProtoFS",
                    "/f",
                ])
                .output();
        }

        let reg_output = silent_command("reg")
            .args(["query", r"HKCU\Software\Classes\*\shell\ProtoFS"])
            .output();
        let context_menu_enabled = match reg_output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        };
        let send_to_enabled = send_to_cmd.exists();

        Ok(CommandResponse::ok(ShellIntegrationStatus {
            send_to_enabled,
            context_menu_enabled,
            platform: "windows".to_string(),
            send_to_path: send_to_dir.to_string_lossy().to_string(),
            target_exe,
        }))
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let app_dir = std::path::PathBuf::from(&home).join(".local/share/applications");
        let desktop_file = app_dir.join("protofs-upload.desktop");

        if enable_send_to || enable_context_menu {
            ensure_dir(&app_dir);
            let desktop_content = format!(
                "[Desktop Entry]\nType=Application\nName=Upload to ProtoFS\nExec=\"{}\" --upload %F\nIcon=protofs\nTerminal=false\nMimeType=all/allfiles;\nNoDisplay=true\n",
                target_exe
            );
            let _ = std::fs::write(&desktop_file, desktop_content.as_bytes());
        } else if desktop_file.exists() {
            let _ = std::fs::remove_file(&desktop_file);
        }

        let enabled = desktop_file.exists();
        Ok(CommandResponse::ok(ShellIntegrationStatus {
            send_to_enabled: enabled,
            context_menu_enabled: enabled,
            platform: "linux".to_string(),
            send_to_path: desktop_file.to_string_lossy().to_string(),
            target_exe,
        }))
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = (enable_send_to, enable_context_menu);
        Ok(CommandResponse::ok(ShellIntegrationStatus {
            send_to_enabled: false,
            context_menu_enabled: false,
            platform: std::env::consts::OS.to_string(),
            send_to_path: String::new(),
            target_exe,
        }))
    }
}

#[tauri::command]
pub async fn get_pending_uploads_command() -> Result<CommandResponse<Vec<String>>, String> {
    let mut pending = Vec::new();
    let args: Vec<String> = std::env::args().collect();
    let mut upload_mode = false;
    for arg in args.into_iter().skip(1) {
        if arg == "--upload" {
            upload_mode = true;
            continue;
        }
        if upload_mode && !arg.starts_with("--") {
            let p = std::path::PathBuf::from(&arg);
            if p.exists() {
                pending.push(arg);
            }
        }
    }
    Ok(CommandResponse::ok(pending))
}

#[tauri::command]
pub async fn open_path_in_explorer_command(path: String) -> Result<CommandResponse<bool>, String> {
    let p = std::path::Path::new(&path);
    if !p.is_absolute() {
        return Ok(CommandResponse::err("Path must be absolute".to_string()));
    }
    if path.contains("://") || path.contains('&') || path.contains('|') || path.contains(';') {
        return Ok(CommandResponse::err("Invalid path characters".to_string()));
    }
    #[cfg(target_os = "windows")]
    {
        let _ = silent_command("explorer").arg(&path).spawn();
        Ok(CommandResponse::ok(true))
    }
    #[cfg(target_os = "linux")]
    {
        let _ = silent_command("xdg-open").arg(&path).spawn();
        Ok(CommandResponse::ok(true))
    }
    #[cfg(target_os = "macos")]
    {
        let _ = silent_command("open").arg(&path).spawn();
        Ok(CommandResponse::ok(true))
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = path;
        Ok(CommandResponse::ok(false))
    }
}
