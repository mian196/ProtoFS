use super::xml::{render_lockdiscovery, render_multistatus, WebDavProp};
use crate::error::{ProtoFsError, Result};
use crate::mtproto::TelegramTransport;
use crate::sync::SyncEngine;
use crate::vfs::{DriveMetadata, FolderNode, ROOT_PARENT_ID, VfsNode};
use chrono::Utc;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, RwLock};

pub const DEFAULT_WEBDAV_PORT: u16 = 28491;
pub const VIRTUAL_QUOTA_TOTAL: u64 = 10 * 1024 * 1024 * 1024 * 1024; // 10 TB virtual capacity

#[derive(Debug, Clone)]
pub struct WebDavConfig {
    pub enabled: bool,
    pub port: u16,
    pub auto_mount: bool,
    pub auth_token: Option<String>,
}

impl Default for WebDavConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_WEBDAV_PORT,
            auto_mount: false,
            auth_token: None,
        }
    }
}

pub struct WebDavServer<T: TelegramTransport + 'static> {
    engine: Arc<SyncEngine<T>>,
    drives: Arc<RwLock<Vec<DriveMetadata>>>,
    config: Arc<RwLock<WebDavConfig>>,
    shutdown_tx: Option<watch::Sender<bool>>,
    bound_addr: Arc<RwLock<Option<SocketAddr>>>,
}

impl<T: TelegramTransport + 'static> WebDavServer<T> {
    pub fn new(
        engine: Arc<SyncEngine<T>>,
        drives: Arc<RwLock<Vec<DriveMetadata>>>,
        config: WebDavConfig,
    ) -> Self {
        Self {
            engine,
            drives,
            config: Arc::new(RwLock::new(config)),
            shutdown_tx: None,
            bound_addr: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn get_bound_addr(&self) -> Option<SocketAddr> {
        *self.bound_addr.read().await
    }

    pub async fn is_running(&self) -> bool {
        self.bound_addr.read().await.is_some()
    }

    pub async fn port(&self) -> u16 {
        if let Some(addr) = *self.bound_addr.read().await {
            addr.port()
        } else {
            self.config.read().await.port
        }
    }

    pub async fn auto_mount(&self) -> bool {
        self.config.read().await.auto_mount
    }

    pub async fn get_config(&self) -> WebDavConfig {
        self.config.read().await.clone()
    }

    pub async fn update_config(&self, new_config: WebDavConfig) {
        *self.config.write().await = new_config;
    }

    pub async fn set_config(&mut self, new_config: WebDavConfig) {
        *self.config.write().await = new_config;
    }

    pub async fn start(&mut self) -> Result<SocketAddr> {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        self.shutdown_tx = Some(shutdown_tx);

        let port = self.config.read().await.port;
        let addr: SocketAddr = format!("127.0.0.1:{}", port)
            .parse()
            .map_err(|e| ProtoFsError::Internal(format!("Invalid socket address: {}", e)))?;

        let listener = TcpListener::bind(addr).await.map_err(|e| {
            ProtoFsError::Internal(format!("Failed to bind WebDAV server on {}: {}", addr, e))
        })?;

        let actual_addr = listener.local_addr().map_err(|e| {
            ProtoFsError::Internal(format!("Failed to get local address: {}", e))
        })?;

        *self.bound_addr.write().await = Some(actual_addr);

        let engine = self.engine.clone();
        let drives = self.drives.clone();
        let config = self.config.clone();
        let bound_addr_holder = self.bound_addr.clone();

        tokio::spawn(async move {
            tracing::info!("ProtoFS WebDAV server listening on http://{}", actual_addr);
            let mut rx = shutdown_rx;

            loop {
                tokio::select! {
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((stream, peer)) => {
                                let eng = engine.clone();
                                let drvs = drives.clone();
                                let cfg = config.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = handle_webdav_connection(stream, peer, eng, drvs, cfg).await {
                                        tracing::debug!("WebDAV connection error from {}: {}", peer, e);
                                    }
                                });
                            }
                            Err(e) => {
                                tracing::warn!("WebDAV accept error: {}", e);
                            }
                        }
                    }
                    _ = rx.changed() => {
                        if *rx.borrow() {
                            tracing::info!("WebDAV server received shutdown signal");
                            break;
                        }
                    }
                }
            }
            *bound_addr_holder.write().await = None;
        });

        Ok(actual_addr)
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
        *self.bound_addr.write().await = None;
    }
}

async fn handle_webdav_connection<T: TelegramTransport + 'static>(
    mut stream: TcpStream,
    _peer: SocketAddr,
    engine: Arc<SyncEngine<T>>,
    drives: Arc<RwLock<Vec<DriveMetadata>>>,
    config: Arc<RwLock<WebDavConfig>>,
) -> Result<()> {
    let mut buffer = vec![0u8; 8192];
    let bytes_read = stream
        .read(&mut buffer)
        .await
        .map_err(|e| ProtoFsError::Internal(format!("Read error: {}", e)))?;

    if bytes_read == 0 {
        return Ok(());
    }

    let request_str = String::from_utf8_lossy(&buffer[..bytes_read]);
    let mut lines = request_str.lines();
    let request_line = match lines.next() {
        Some(l) => l,
        None => return Ok(()),
    };

    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Ok(());
    }

    let method = parts[0];
    let raw_path = parts[1];
    let decoded_path = urlencoding_decode(raw_path);

    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() || line == "\r" {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }

    let depth = headers.get("depth").map(|s| s.as_str()).unwrap_or("1");

    match method {
        "OPTIONS" => {
            let response = "HTTP/1.1 200 OK\r\n\
                DAV: 1, 2\r\n\
                MS-Author-Via: DAV\r\n\
                Allow: OPTIONS, GET, HEAD, PROPFIND, PROPPATCH, MKCOL, PUT, DELETE, MOVE, COPY, LOCK, UNLOCK\r\n\
                Content-Length: 0\r\n\
                Connection: close\r\n\r\n";
            stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        }
        "PROPFIND" => {
            handle_propfind(&mut stream, &decoded_path, depth, &engine, &drives).await?;
        }
        "GET" | "HEAD" => {
            handle_get_or_head(&mut stream, method == "HEAD", &decoded_path, &headers, &engine, &drives).await?;
        }
        "MKCOL" => {
            handle_mkcol(&mut stream, &decoded_path, &engine, &drives).await?;
        }
        "DELETE" => {
            handle_delete(&mut stream, &decoded_path, &engine, &drives).await?;
        }
        "MOVE" => {
            let destination = headers.get("destination").cloned().unwrap_or_default();
            handle_move(&mut stream, &decoded_path, &destination, &engine, &drives).await?;
        }
        "LOCK" => {
            let token = uuid::Uuid::new_v4().to_string();
            let xml = render_lockdiscovery(&decoded_path, &token);
            let response = format!(
                "HTTP/1.1 200 OK\r\n\
                Content-Type: application/xml; charset=utf-8\r\n\
                Lock-Token: <urn:uuid:{}>\r\n\
                Content-Length: {}\r\n\
                Connection: close\r\n\r\n{}",
                token,
                xml.len(),
                xml
            );
            stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        }
        "UNLOCK" => {
            let response = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
            stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        }
        "PROPPATCH" => {
            let xml = r#"<?xml version="1.0" encoding="utf-8" ?><D:multistatus xmlns:D="DAV:"></D:multistatus>"#;
            let response = format!(
                "HTTP/1.1 207 Multi-Status\r\nContent-Type: application/xml; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                xml.len(),
                xml
            );
            stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        }
        _ => {
            let response = "HTTP/1.1 501 Not Implemented\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        }
    }

    let _ = config;
    Ok(())
}

async fn handle_propfind<T: TelegramTransport + 'static>(
    stream: &mut TcpStream,
    path: &str,
    depth: &str,
    engine: &SyncEngine<T>,
    drives_lock: &RwLock<Vec<DriveMetadata>>,
) -> Result<()> {
    let clean = path.trim_matches('/');
    let drives = drives_lock.read().await.clone();
    let mut props = Vec::new();
    let now_rfc1123 = Utc::now().to_rfc2822();

    if clean.is_empty() {
        // Root listing: return Root collection + child Drives if Depth != 0
        props.push(WebDavProp {
            href: "/".to_string(),
            is_dir: true,
            display_name: "ProtoFS Cloud Storage".to_string(),
            size_bytes: 0,
            mime_type: "httpd/unix-directory".to_string(),
            last_modified_rfc1123: now_rfc1123.clone(),
            quota_available_bytes: VIRTUAL_QUOTA_TOTAL,
            quota_used_bytes: 0,
        });

        if depth != "0" {
            for d in &drives {
                props.push(WebDavProp {
                    href: format!("/{}", d.id),
                    is_dir: true,
                    display_name: d.name.clone(),
                    size_bytes: 0,
                    mime_type: "httpd/unix-directory".to_string(),
                    last_modified_rfc1123: d.updated_at.to_rfc2822(),
                    quota_available_bytes: VIRTUAL_QUOTA_TOTAL,
                    quota_used_bytes: 0,
                });
            }
        }
    } else {
        // Path inside a specific drive
        let parts: Vec<&str> = clean.split('/').filter(|p| !p.is_empty()).collect();
        let drive_id = parts[0];
        let subpath = if parts.len() > 1 {
            parts[1..].join("/")
        } else {
            String::new()
        };

        let tree = engine.get_or_create_tree(drive_id).await;

        if subpath.is_empty() {
            // Drive root folder
            let drive_name = drives
                .iter()
                .find(|d| d.id == drive_id)
                .map(|d| d.name.clone())
                .unwrap_or_else(|| drive_id.to_string());

            props.push(WebDavProp {
                href: format!("/{}", drive_id),
                is_dir: true,
                display_name: drive_name,
                size_bytes: 0,
                mime_type: "httpd/unix-directory".to_string(),
                last_modified_rfc1123: now_rfc1123.clone(),
                quota_available_bytes: VIRTUAL_QUOTA_TOTAL,
                quota_used_bytes: 0,
            });

            if depth != "0" {
                for node in tree.list_children(ROOT_PARENT_ID) {
                    if node.is_trashed() {
                        continue;
                    }
                    props.push(vfs_node_to_prop(&format!("/{}", drive_id), node));
                }
            }
        } else if let Some(target_node) = tree.find_by_path(&subpath) {
            let parent_href = format!("/{}", clean);
            props.push(vfs_node_to_prop_exact(&parent_href, target_node));

            if depth != "0"
                && let VfsNode::Folder(f) = target_node
            {
                for child in tree.list_children(&f.id) {
                    if child.is_trashed() {
                        continue;
                    }
                    props.push(vfs_node_to_prop(&parent_href, child));
                }
            }
        } else {
            let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
            return Ok(());
        }
    }

    let xml = render_multistatus(&props);
    let response = format!(
        "HTTP/1.1 207 Multi-Status\r\n\
        Content-Type: application/xml; charset=utf-8\r\n\
        Content-Length: {}\r\n\
        Connection: close\r\n\r\n{}",
        xml.len(),
        xml
    );

    stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
    Ok(())
}

async fn handle_get_or_head<T: TelegramTransport + 'static>(
    stream: &mut TcpStream,
    is_head: bool,
    path: &str,
    headers: &HashMap<String, String>,
    engine: &SyncEngine<T>,
    drives: &RwLock<Vec<DriveMetadata>>,
) -> Result<()> {
    let clean = path.trim_matches('/');
    let parts: Vec<&str> = clean.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        return Ok(());
    }

    let drive_id = parts[0];
    let file_subpath = parts[1..].join("/");
    let tree = engine.get_or_create_tree(drive_id).await;

    let file_node = match tree.find_by_path(&file_subpath) {
        Some(VfsNode::File(f)) => f.clone(),
        _ => {
            let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
            return Ok(());
        }
    };

    let mime = file_node.mime_type.as_deref().unwrap_or("application/octet-stream");
    let total_size = file_node.size_bytes;

    // Handle Range Header if present
    let (start_byte, end_byte, is_range) = if let Some(range_header) = headers.get("range") {
        if let Some(spec) = range_header.strip_prefix("bytes=") {
            let range_parts: Vec<&str> = spec.split('-').collect();
            let start = range_parts[0].parse::<u64>().unwrap_or(0);
            let end = if range_parts.len() > 1 && !range_parts[1].is_empty() {
                range_parts[1].parse::<u64>().unwrap_or(total_size.saturating_sub(1))
            } else {
                total_size.saturating_sub(1)
            };
            (start, end.min(total_size.saturating_sub(1)), true)
        } else {
            (0, total_size.saturating_sub(1), false)
        }
    } else {
        (0, total_size.saturating_sub(1), false)
    };

    let content_len = if total_size == 0 {
        0
    } else {
        end_byte - start_byte + 1
    };

    let header_str = if is_range {
        format!(
            "HTTP/1.1 206 Partial Content\r\n\
            Content-Type: {}\r\n\
            Content-Range: bytes {}-{}/{}\r\n\
            Content-Length: {}\r\n\
            Accept-Ranges: bytes\r\n\
            Connection: close\r\n\r\n",
            mime, start_byte, end_byte, total_size, content_len
        )
    } else {
        format!(
            "HTTP/1.1 200 OK\r\n\
            Content-Type: {}\r\n\
            Content-Length: {}\r\n\
            Accept-Ranges: bytes\r\n\
            Connection: close\r\n\r\n",
            mime, total_size
        )
    };

    stream.write_all(header_str.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;

    if is_head || total_size == 0 || content_len == 0 {
        return Ok(());
    }

    let channel_id = {
        let drives_guard = drives.read().await;
        drives_guard.iter().find(|d| d.id == drive_id).map(|d| d.channel_id).unwrap_or(0)
    };

    // Read and decrypt file data on-demand
    if let Ok((_node, data)) = engine.download_file_data(drive_id, &file_node.id, None, channel_id).await {
        let start = start_byte as usize;
        let end = (end_byte as usize + 1).min(data.len());
        if start < data.len() {
            let slice = &data[start..end];
            let _ = stream.write_all(slice).await;
        }
    }

    Ok(())
}

async fn handle_mkcol<T: TelegramTransport + 'static>(
    stream: &mut TcpStream,
    path: &str,
    engine: &SyncEngine<T>,
    _drives: &RwLock<Vec<DriveMetadata>>,
) -> Result<()> {
    let clean = path.trim_matches('/');
    let parts: Vec<&str> = clean.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        let response = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        return Ok(());
    }

    let drive_id = parts[0];
    let folder_name = parts.last().unwrap().to_string();
    let parent_subpath = parts[1..parts.len() - 1].join("/");

    let mut tree = engine.get_or_create_tree(drive_id).await;
    let parent_id = if parent_subpath.is_empty() {
        ROOT_PARENT_ID.to_string()
    } else if let Some(VfsNode::Folder(f)) = tree.find_by_path(&parent_subpath) {
        f.id.clone()
    } else {
        let response = "HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        return Ok(());
    };

    let new_folder = FolderNode {
        id: format!("f_{}", Utc::now().timestamp_millis()),
        drive_id: drive_id.to_string(),
        parent_id,
        name: folder_name,
        is_trashed: false,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    tree.insert(VfsNode::Folder(new_folder));

    let response = "HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
    Ok(())
}

async fn handle_delete<T: TelegramTransport + 'static>(
    stream: &mut TcpStream,
    path: &str,
    engine: &SyncEngine<T>,
    _drives: &RwLock<Vec<DriveMetadata>>,
) -> Result<()> {
    let clean = path.trim_matches('/');
    let parts: Vec<&str> = clean.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 {
        let response = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        return Ok(());
    }

    let drive_id = parts[0];
    let subpath = parts[1..].join("/");

    let mut tree = engine.get_or_create_tree(drive_id).await;
    if let Some(node) = tree.find_by_path(&subpath).cloned() {
        tree.remove_recursive(node.id());
        let response = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
    } else {
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
    }

    Ok(())
}

async fn handle_move<T: TelegramTransport + 'static>(
    stream: &mut TcpStream,
    source_path: &str,
    destination_header: &str,
    engine: &SyncEngine<T>,
    _drives: &RwLock<Vec<DriveMetadata>>,
) -> Result<()> {
    let dest_url = urlencoding_decode(destination_header);
    let dest_path = if let Some(idx) = dest_url.find("://") {
        let after_scheme = &dest_url[idx + 3..];
        after_scheme.find('/').map(|i| &after_scheme[i..]).unwrap_or("/")
    } else {
        &dest_url
    };

    let src_clean = source_path.trim_matches('/');
    let dest_clean = dest_path.trim_matches('/');

    let src_parts: Vec<&str> = src_clean.split('/').filter(|p| !p.is_empty()).collect();
    let dest_parts: Vec<&str> = dest_clean.split('/').filter(|p| !p.is_empty()).collect();

    if src_parts.len() < 2 || dest_parts.len() < 2 || src_parts[0] != dest_parts[0] {
        let response = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
        return Ok(());
    }

    let drive_id = src_parts[0];
    let src_subpath = src_parts[1..].join("/");
    let dest_new_name = dest_parts.last().unwrap().to_string();

    let mut tree = engine.get_or_create_tree(drive_id).await;
    if let Some(node) = tree.find_by_path(&src_subpath).cloned() {
        let _ = tree.rename(node.id(), &dest_new_name);
        let response = "HTTP/1.1 201 Created\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
    } else {
        let response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).await.map_err(|e| ProtoFsError::Internal(e.to_string()))?;
    }

    Ok(())
}

fn vfs_node_to_prop(parent_href: &str, node: &VfsNode) -> WebDavProp {
    let clean_parent = parent_href.trim_end_matches('/');
    let href = format!("{}/{}", clean_parent, node.name());
    vfs_node_to_prop_exact(&href, node)
}

fn vfs_node_to_prop_exact(href: &str, node: &VfsNode) -> WebDavProp {
    match node {
        VfsNode::Folder(f) => WebDavProp {
            href: href.to_string(),
            is_dir: true,
            display_name: f.name.clone(),
            size_bytes: 0,
            mime_type: "httpd/unix-directory".to_string(),
            last_modified_rfc1123: f.updated_at.to_rfc2822(),
            quota_available_bytes: VIRTUAL_QUOTA_TOTAL,
            quota_used_bytes: 0,
        },
        VfsNode::File(f) => WebDavProp {
            href: href.to_string(),
            is_dir: false,
            display_name: f.name.clone(),
            size_bytes: f.size_bytes,
            mime_type: f.mime_type.clone().unwrap_or_else(|| "application/octet-stream".to_string()),
            last_modified_rfc1123: f.updated_at.to_rfc2822(),
            quota_available_bytes: VIRTUAL_QUOTA_TOTAL,
            quota_used_bytes: 0,
        },
    }
}

fn urlencoding_decode(input: &str) -> String {
    let mut decoded = Vec::new();
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len()
            && let Ok(val) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..=i + 2]).unwrap_or(""), 16)
        {
            decoded.push(val);
            i += 3;
            continue;
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&decoded).to_string()
}
