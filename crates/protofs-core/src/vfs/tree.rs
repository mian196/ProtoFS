use crate::error::{ProtoFsError, Result};
use crate::vfs::model::{FileNode, FileVersion, FolderNode, ROOT_PARENT_ID, VfsNode};
use chrono::Utc;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default, Clone)]
pub struct VfsTree {
    nodes: HashMap<String, VfsNode>,
    children_by_parent: HashMap<String, HashSet<String>>,
}

impl VfsTree {
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            children_by_parent: HashMap::new(),
        }
    }

    pub fn insert(&mut self, node: VfsNode) {
        let id = node.id().to_string();
        let parent_id = node.parent_id().to_string();

        if let Some(old_node) = self.nodes.get(&id) {
            let old_parent = old_node.parent_id().to_string();
            if let Some(children) = self.children_by_parent.get_mut(&old_parent) {
                children.remove(&id);
            }
        }

        self.children_by_parent
            .entry(parent_id)
            .or_default()
            .insert(id.clone());

        self.nodes.insert(id, node);
    }

    pub fn get(&self, id: &str) -> Option<&VfsNode> {
        self.nodes.get(id)
    }

    pub fn get_folder(&self, id: &str) -> Option<&FolderNode> {
        match self.nodes.get(id) {
            Some(VfsNode::Folder(f)) => Some(f),
            _ => None,
        }
    }

    pub fn get_file(&self, id: &str) -> Option<&FileNode> {
        match self.nodes.get(id) {
            Some(VfsNode::File(f)) => Some(f),
            _ => None,
        }
    }

    pub fn list_children(&self, parent_id: &str) -> Vec<&VfsNode> {
        self.children_by_parent
            .get(parent_id)
            .map(|child_ids| {
                child_ids
                    .iter()
                    .filter_map(|id| self.nodes.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn rename(&mut self, id: &str, new_name: &str) -> Result<()> {
        let node = self
            .nodes
            .get_mut(id)
            .ok_or_else(|| ProtoFsError::NodeNotFound(id.to_string()))?;
        let now = Utc::now();
        match node {
            VfsNode::Folder(f) => {
                f.name = new_name.to_string();
                f.updated_at = now;
            }
            VfsNode::File(f) => {
                f.name = new_name.to_string();
                f.updated_at = now;
            }
        }
        Ok(())
    }

    pub fn move_node(&mut self, id: &str, new_parent_id: &str) -> Result<()> {
        let node = self
            .nodes
            .get(id)
            .ok_or_else(|| ProtoFsError::NodeNotFound(id.to_string()))?;
        let old_parent_id = node.parent_id().to_string();

        if old_parent_id == new_parent_id {
            return Ok(());
        }

        if let Some(children) = self.children_by_parent.get_mut(&old_parent_id) {
            children.remove(id);
        }

        self.children_by_parent
            .entry(new_parent_id.to_string())
            .or_default()
            .insert(id.to_string());

        let node_mut = self.nodes.get_mut(id).unwrap();
        let now = Utc::now();
        match node_mut {
            VfsNode::Folder(f) => {
                f.parent_id = new_parent_id.to_string();
                f.updated_at = now;
            }
            VfsNode::File(f) => {
                f.parent_id = new_parent_id.to_string();
                f.updated_at = now;
            }
        }
        Ok(())
    }

    pub fn resolve_breadcrumbs(&self, folder_id: &str) -> Vec<(String, String)> {
        let mut crumbs = Vec::new();
        let mut current_id = folder_id.to_string();
        while current_id != ROOT_PARENT_ID {
            if let Some(VfsNode::Folder(f)) = self.nodes.get(&current_id) {
                crumbs.push((f.id.clone(), f.name.clone()));
                current_id = f.parent_id.clone();
            } else {
                break;
            }
        }
        crumbs.reverse();
        crumbs
    }

    pub fn remove(&mut self, id: &str) -> Option<VfsNode> {
        if let Some(node) = self.nodes.remove(id) {
            let parent_id = node.parent_id().to_string();
            if let Some(children) = self.children_by_parent.get_mut(&parent_id) {
                children.remove(id);
            }
            self.children_by_parent.remove(id);
            Some(node)
        } else {
            None
        }
    }

    pub fn remove_recursive(&mut self, id: &str) -> Vec<VfsNode> {
        let mut removed = Vec::new();
        let mut stack = vec![id.to_string()];

        while let Some(node_id) = stack.pop() {
            if let Some(children) = self.children_by_parent.remove(&node_id) {
                stack.extend(children);
            }
            if let Some(node) = self.remove(&node_id) {
                removed.push(node);
            }
        }
        removed
    }

    #[allow(clippy::too_many_arguments)]
    pub fn record_file_version(
        &mut self,
        file_id: &str,
        new_message_id: i32,
        new_size: u64,
        new_mime: Option<String>,
        new_sha256: Option<String>,
        is_encrypted: bool,
        encryption_iv: Option<String>,
    ) -> Result<u32> {
        let node = self
            .nodes
            .get_mut(file_id)
            .ok_or_else(|| ProtoFsError::NodeNotFound(file_id.to_string()))?;

        if let VfsNode::File(f) = node {
            let past_version = FileVersion {
                version: f.version,
                telegram_message_id: f.telegram_message_id,
                size_bytes: f.size_bytes,
                mime_type: f.mime_type.clone(),
                sha256_hash: f.sha256_hash.clone(),
                is_encrypted: f.is_encrypted,
                encryption_iv: f.encryption_iv.clone(),
                created_at: f.updated_at,
            };
            f.history.insert(0, past_version);
            if f.history.len() > 10 {
                f.history.truncate(10);
            }

            f.version += 1;
            f.telegram_message_id = new_message_id;
            f.size_bytes = new_size;
            f.mime_type = new_mime;
            f.sha256_hash = new_sha256;
            f.is_encrypted = is_encrypted;
            f.encryption_iv = encryption_iv;
            f.updated_at = Utc::now();
            Ok(f.version)
        } else {
            Err(ProtoFsError::Vfs(
                "Node is a folder, not a file".to_string(),
            ))
        }
    }

    pub fn restore_file_version(&mut self, file_id: &str, target_version: u32) -> Result<u32> {
        let node = self
            .nodes
            .get_mut(file_id)
            .ok_or_else(|| ProtoFsError::NodeNotFound(file_id.to_string()))?;

        if let VfsNode::File(f) = node {
            let pos = f
                .history
                .iter()
                .position(|v| v.version == target_version)
                .ok_or_else(|| {
                    ProtoFsError::Vfs(format!("Version {} not found in history", target_version))
                })?;

            let target = f.history.remove(pos);

            let current_demoted = FileVersion {
                version: f.version,
                telegram_message_id: f.telegram_message_id,
                size_bytes: f.size_bytes,
                mime_type: f.mime_type.clone(),
                sha256_hash: f.sha256_hash.clone(),
                is_encrypted: f.is_encrypted,
                encryption_iv: f.encryption_iv.clone(),
                created_at: f.updated_at,
            };
            f.history.insert(0, current_demoted);

            f.version = target.version;
            f.telegram_message_id = target.telegram_message_id;
            f.size_bytes = target.size_bytes;
            f.mime_type = target.mime_type;
            f.sha256_hash = target.sha256_hash;
            f.is_encrypted = target.is_encrypted;
            f.encryption_iv = target.encryption_iv;
            f.updated_at = Utc::now();

            Ok(f.version)
        } else {
            Err(ProtoFsError::Vfs(
                "Node is a folder, not a file".to_string(),
            ))
        }
    }

    pub fn resolve_relative_path(&self, node_id: &str) -> String {
        let mut parts = Vec::new();
        let mut curr_id = node_id.to_string();
        while curr_id != ROOT_PARENT_ID {
            if let Some(node) = self.nodes.get(&curr_id) {
                parts.push(node.name().to_string());
                curr_id = node.parent_id().to_string();
            } else {
                break;
            }
        }
        parts.reverse();
        parts.join("/")
    }

    pub fn all_nodes(&self) -> impl Iterator<Item = &VfsNode> {
        self.nodes.values()
    }

    pub fn count(&self) -> usize {
        self.nodes.len()
    }
}
