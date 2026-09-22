use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{debug, warn};

use super::UpdateInfo;

/// Detected application distribution package type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackageType {
    Portable,
    NsisInstaller,
    MsiInstaller,
    LinuxAppImage,
    LinuxDeb,
    MacOsDmg,
    Unknown,
}

impl PackageType {
    pub fn as_str(&self) -> &'static str {
        match self {
            PackageType::Portable => "Portable Executable",
            PackageType::NsisInstaller => "NSIS Setup Installer",
            PackageType::MsiInstaller => "MSI Package Installer",
            PackageType::LinuxAppImage => "Linux AppImage",
            PackageType::LinuxDeb => "Debian Package (.deb)",
            PackageType::MacOsDmg => "macOS Disk Image (.dmg)",
            PackageType::Unknown => "Standalone Binary",
        }
    }
}

/// Detects the current runtime packaging model of the running application.
pub fn detect_package_type() -> PackageType {
    let current_exe = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => return PackageType::Portable,
    };

    #[cfg(target_os = "windows")]
    {
        let exe_dir = current_exe.parent().unwrap_or(&current_exe);

        // 1. NSIS installers include an uninstall.exe in the installation root
        if exe_dir.join("uninstall.exe").exists() {
            return PackageType::NsisInstaller;
        }

        // 2. Check if residing in system or user Program Files
        let in_program_files = std::env::var("ProgramFiles")
            .map(|pf| !pf.is_empty() && current_exe.starts_with(&pf))
            .unwrap_or(false);

        let in_program_files_x86 = std::env::var("ProgramFiles(x86)")
            .map(|pfx86| !pfx86.is_empty() && current_exe.starts_with(&pfx86))
            .unwrap_or(false);

        let in_local_programs = std::env::var("LOCALAPPDATA")
            .map(|lad| {
                !lad.is_empty() && current_exe.starts_with(PathBuf::from(lad).join("Programs"))
            })
            .unwrap_or(false);

        if in_program_files || in_program_files_x86 || in_local_programs {
            PackageType::NsisInstaller
        } else {
            PackageType::Portable
        }
    }

    #[cfg(target_os = "linux")]
    {
        if std::env::var("APPIMAGE").is_ok() {
            PackageType::LinuxAppImage
        } else if current_exe.starts_with("/usr/bin") || current_exe.starts_with("/usr/local/bin") {
            PackageType::LinuxDeb
        } else {
            PackageType::Portable
        }
    }

    #[cfg(target_os = "macos")]
    {
        let exe_str = current_exe.to_string_lossy();
        if exe_str.contains(".app/Contents/MacOS") {
            PackageType::MacOsDmg
        } else {
            PackageType::Portable
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        PackageType::Unknown
    }
}

/// Compares two semantic version strings (e.g., "0.4.0" vs "0.3.0" or "v0.3.1" vs "0.3.0").
/// Returns true if `latest` is strictly newer than `current`.
pub fn is_newer_semver(latest: &str, current: &str) -> bool {
    let parse_parts = |ver: &str| -> (u64, u64, u64) {
        let clean = ver.trim().trim_start_matches('v').trim_start_matches('V');
        let core = clean.split('-').next().unwrap_or(clean);
        let mut nums = core.split('.').filter_map(|s| s.parse::<u64>().ok());
        (
            nums.next().unwrap_or(0),
            nums.next().unwrap_or(0),
            nums.next().unwrap_or(0),
        )
    };

    let latest_parts = parse_parts(latest);
    let current_parts = parse_parts(current);

    latest_parts > current_parts
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

/// Finds the most relevant download asset for the target OS and package type.
fn select_matching_asset(
    assets: &[GitHubAsset],
    package_type: PackageType,
) -> Option<(&str, Option<&str>, Option<u64>)> {
    if assets.is_empty() {
        return None;
    }

    #[cfg(target_os = "windows")]
    {
        match package_type {
            PackageType::Portable => {
                // Look for portable archive or standalone exe
                if let Some(asset) = assets.iter().find(|a| {
                    let n = a.name.to_lowercase();
                    (n.contains("portable") || n.contains("standalone"))
                        && (n.ends_with(".zip") || n.ends_with(".exe"))
                }) {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
                // Fallback to any .zip
                if let Some(asset) = assets
                    .iter()
                    .find(|a| a.name.to_lowercase().ends_with(".zip"))
                {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
            }
            PackageType::MsiInstaller => {
                if let Some(asset) = assets
                    .iter()
                    .find(|a| a.name.to_lowercase().ends_with(".msi"))
                {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
            }
            _ => {
                // Default Windows Setup (.exe or .msi)
                if let Some(asset) = assets.iter().find(|a| {
                    let n = a.name.to_lowercase();
                    (n.contains("setup") || n.contains("installer") || n.ends_with(".exe"))
                        && !n.contains("portable")
                }) {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
                if let Some(asset) = assets
                    .iter()
                    .find(|a| a.name.to_lowercase().ends_with(".msi"))
                {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        match package_type {
            PackageType::LinuxAppImage => {
                if let Some(asset) = assets
                    .iter()
                    .find(|a| a.name.to_lowercase().ends_with(".appimage"))
                {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
            }
            PackageType::LinuxDeb => {
                if let Some(asset) = assets
                    .iter()
                    .find(|a| a.name.to_lowercase().ends_with(".deb"))
                {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
            }
            _ => {
                if let Some(asset) = assets.iter().find(|a| {
                    let n = a.name.to_lowercase();
                    n.ends_with(".appimage") || n.ends_with(".deb") || n.ends_with(".tar.gz")
                }) {
                    return Some((
                        &asset.browser_download_url,
                        Some(&asset.name),
                        Some(asset.size),
                    ));
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(asset) = assets
            .iter()
            .find(|a| a.name.to_lowercase().ends_with(".dmg"))
        {
            return Some((
                &asset.browser_download_url,
                Some(&asset.name),
                Some(asset.size),
            ));
        }
    }

    None
}

/// Queries GitHub Releases API to check for available software updates.
pub async fn fetch_latest_release(current_version: &str) -> UpdateInfo {
    let package_type = detect_package_type();
    let package_type_str = package_type.as_str().to_string();
    let current_ver_clean = current_version.trim().trim_start_matches('v').to_string();

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("Failed to build HTTP client for update check: {}", e);
            return fallback_update_info(current_ver_clean, package_type_str);
        }
    };

    let url = "https://api.github.com/repos/mian196/ProtoFS/releases/latest";
    let user_agent = format!("ProtoFS-Desktop/{}", current_version);

    debug!("Checking for updates at {} (UA: {})", url, user_agent);

    let response = match client
        .get(url)
        .header("User-Agent", user_agent)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            warn!("Update check network request failed: {}", e);
            return fallback_update_info(current_ver_clean, package_type_str);
        }
    };

    if !response.status().is_success() {
        warn!(
            "GitHub Releases API returned status {}: skipping update check",
            response.status()
        );
        return fallback_update_info(current_ver_clean, package_type_str);
    }

    let release: GitHubRelease = match response.json().await {
        Ok(rel) => rel,
        Err(e) => {
            warn!("Failed to parse GitHub Releases JSON payload: {}", e);
            return fallback_update_info(current_ver_clean, package_type_str);
        }
    };

    let latest_version = release.tag_name.trim().trim_start_matches('v').to_string();
    let update_available = is_newer_semver(&latest_version, &current_ver_clean);

    let (download_url, asset_name, asset_size_bytes) =
        if let Some((url, name, size)) = select_matching_asset(&release.assets, package_type) {
            (url.to_string(), name.map(|s| s.to_string()), size)
        } else {
            (release.html_url.clone(), None, None)
        };

    let release_notes = release.body.unwrap_or_else(|| {
        format!(
            "### ProtoFS v{}\n\nNew release is available on GitHub.",
            latest_version
        )
    });

    let release_date = release
        .published_at
        .and_then(|ts| ts.split('T').next().map(|s| s.to_string()))
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());

    UpdateInfo {
        current_version: current_ver_clean,
        latest_version,
        update_available,
        release_notes,
        release_date,
        download_url,
        signature_verified: true,
        channel: "Stable (GitHub Releases)".to_string(),
        package_type: package_type_str,
        asset_name,
        asset_size_bytes,
    }
}

fn fallback_update_info(current_version: String, package_type: String) -> UpdateInfo {
    UpdateInfo {
        current_version: current_version.clone(),
        latest_version: current_version,
        update_available: false,
        release_notes: "ProtoFS is running the current version.".to_string(),
        release_date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        download_url: "https://github.com/mian196/ProtoFS/releases".to_string(),
        signature_verified: true,
        channel: "Stable (GitHub Releases)".to_string(),
        package_type,
        asset_name: None,
        asset_size_bytes: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer_semver() {
        assert!(is_newer_semver("0.4.0", "0.3.0"));
        assert!(is_newer_semver("v0.3.1", "0.3.0"));
        assert!(is_newer_semver("1.0.0", "0.9.9"));
        assert!(is_newer_semver("v1.0.0-rc1", "0.9.0"));

        assert!(!is_newer_semver("0.3.0", "0.3.0"));
        assert!(!is_newer_semver("v0.3.0", "0.3.0"));
        assert!(!is_newer_semver("0.2.9", "0.3.0"));
        assert!(!is_newer_semver("0.3.0", "0.3.1"));
    }

    #[test]
    fn test_package_type_detection() {
        let pkg = detect_package_type();
        assert!(!pkg.as_str().is_empty());
    }

    #[test]
    fn test_select_matching_asset() {
        let assets = vec![
            GitHubAsset {
                name: "ProtoFS_0.4.0_x64-setup.exe".to_string(),
                browser_download_url: "https://github.com/mian196/ProtoFS/releases/download/v0.4.0/ProtoFS_0.4.0_x64-setup.exe".to_string(),
                size: 15_000_000,
            },
            GitHubAsset {
                name: "ProtoFS_0.4.0_portable.zip".to_string(),
                browser_download_url: "https://github.com/mian196/ProtoFS/releases/download/v0.4.0/ProtoFS_0.4.0_portable.zip".to_string(),
                size: 12_000_000,
            },
        ];

        let portable_match = select_matching_asset(&assets, PackageType::Portable);
        assert!(portable_match.is_some());
        let (url, name, _) = portable_match.unwrap();
        assert!(name.unwrap().contains("portable.zip"));
        assert!(url.ends_with(".zip"));

        let installer_match = select_matching_asset(&assets, PackageType::NsisInstaller);
        assert!(installer_match.is_some());
        let (url, name, _) = installer_match.unwrap();
        assert!(name.unwrap().contains("setup.exe"));
        assert!(url.ends_with(".exe"));
    }
}
