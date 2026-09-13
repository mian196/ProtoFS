use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedMountState {
    pub mounts: HashMap<String, PersistedMountInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PersistedMountInfo {
    pub drive_id: String,
    pub drive_letter: String,
    pub mount_path: String,
    pub mounted_at: String,
    pub on_demand: bool,
}

pub fn ensure_dir(path: &Path) {
    if let Err(e) = std::fs::create_dir_all(path) {
        tracing::warn!("Failed to create directory {}: {}", path.display(), e);
    }
}

pub fn get_protofs_mount_dir(app: &tauri::AppHandle, drive_id: &str) -> PathBuf {
    use tauri::Manager;
    let base_dir = if let Ok(dir) = app.path().app_data_dir() {
        dir
    } else if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("ProtoFS")
    } else {
        PathBuf::from("ProtoFS_Data")
    };
    let mount_dir = base_dir.join("mount").join(drive_id);
    ensure_dir(&mount_dir);
    mount_dir
}

pub async fn project_vfs_to_disk(
    state: &crate::commands::AppState,
    drive_id: &str,
    mount_root: &Path,
) -> Result<(), String> {
    use protofs_core::vfs::VfsNode;
    let tree = state.engine.get_or_create_tree(drive_id).await;
    let mut folder_paths = std::collections::HashMap::new();
    folder_paths.insert("root".to_string(), mount_root.to_path_buf());

    for n in tree.all_nodes() {
        if let VfsNode::Folder(f) = n
            && !f.is_trashed
        {
            let rel = tree.resolve_relative_path(&f.id);
            let abs = if rel.is_empty() {
                mount_root.to_path_buf()
            } else {
                mount_root.join(&rel)
            };
            ensure_dir(&abs);
            folder_paths.insert(f.id.clone(), abs);
        }
    }

    for n in tree.all_nodes() {
        if let VfsNode::File(f) = n
            && !f.is_trashed
        {
            let p_dir = folder_paths
                .get(&f.parent_id)
                .cloned()
                .unwrap_or_else(|| mount_root.to_path_buf());
            let file_path = p_dir.join(&f.name);
            if !file_path.exists() {
                let stub = format!(
                    "ProtoFS Cloud Virtual File\nName: {}\nSize: {} bytes\n",
                    f.name, f.size_bytes
                );
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

pub fn load_mount_state(app: &tauri::AppHandle) -> PersistedMountState {
    let path = get_protofs_mount_dir(app, "_system").join("mount_state.json");
    if path.exists()
        && let Ok(bytes) = std::fs::read(&path)
        && let Ok(state) = serde_json::from_slice::<PersistedMountState>(&bytes)
    {
        return state;
    }
    PersistedMountState::default()
}

pub fn save_mount_state(app: &tauri::AppHandle, state: &PersistedMountState) {
    let dir = get_protofs_mount_dir(app, "_system");
    ensure_dir(&dir);
    let path = dir.join("mount_state.json");
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(&path, json.into_bytes());
    }
}

pub async fn count_dir_files_and_bytes_async(dir: PathBuf) -> (usize, u64) {
    tokio::task::spawn_blocking(move || count_dir_files_and_bytes_sync(&dir))
        .await
        .unwrap_or((0, 0))
}

pub fn count_dir_files_and_bytes_sync(dir: &Path) -> (usize, u64) {
    let mut count = 0;
    let mut bytes = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    let (sub_c, sub_b) = count_dir_files_and_bytes_sync(&entry.path());
                    count += sub_c;
                    bytes += sub_b;
                } else {
                    count += 1;
                    bytes += meta.len();
                }
            }
        }
    }
    (count, bytes)
}

/// Creates a std::process::Command configured on Windows with CREATE_NO_WINDOW
/// (0x08000000) so no console window flashes or pops up for child processes.
pub fn silent_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn is_drive_letter_mounted(letter: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        let path_str = format!("{}:\\", letter.trim_end_matches([':', '\\', '/']));
        Path::new(&path_str).exists()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = letter;
        false
    }
}

/// Decision D-23: Prioritize 'P:', then scan downwards from 'Z:' to 'D:'.
pub fn get_available_drive_letters() -> Vec<String> {
    let mut available = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if !Path::new("P:\\").exists() {
            available.push("P".to_string());
        }
        for c in (b'D'..=b'Z').rev() {
            let letter = (c as char).to_string();
            if letter != "P" && !Path::new(&format!("{}:\\", letter)).exists() {
                available.push(letter);
            }
        }
    }
    if available.is_empty() {
        available.push("P".to_string());
    }
    available
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mount_state_json_roundtrip() {
        let mut state = PersistedMountState::default();
        state.mounts.insert(
            "drive_1".to_string(),
            PersistedMountInfo {
                drive_id: "drive_1".to_string(),
                drive_letter: "P".to_string(),
                mount_path: "P:\\".to_string(),
                mounted_at: "2026-01-01T00:00:00Z".to_string(),
                on_demand: true,
            },
        );
        let json = serde_json::to_string(&state).expect("serialize mount state");
        let deserialized: PersistedMountState =
            serde_json::from_str(&json).expect("deserialize mount state");
        assert_eq!(
            deserialized.mounts.get("drive_1"),
            state.mounts.get("drive_1")
        );
    }

    #[test]
    fn test_available_drive_letters_priority() {
        let letters = get_available_drive_letters();
        assert!(!letters.is_empty());
        if !is_drive_letter_mounted("P") {
            assert_eq!(letters[0], "P");
        }
    }
}
