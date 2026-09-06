use std::collections::{HashMap, HashSet};
use crate::error::{ProtoFsError, Result};
use crate::vfs::model::{FileNode, FolderNode, VfsNode, ROOT_PARENT_ID};
use chrono::Utc;

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
        let node = self.nodes.get_mut(id).ok_or_else(|| ProtoFsError::NodeNotFound(id.to_string()))?;
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
        let node = self.nodes.get(id).ok_or_else(|| ProtoFsError::NodeNotFound(id.to_string()))?;
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

    pub fn all_nodes(&self) -> impl Iterator<Item = &VfsNode> {
        self.nodes.values()
    }

    pub fn count(&self) -> usize {
        self.nodes.len()
    }
}
