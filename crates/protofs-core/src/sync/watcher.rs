use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};
use tracing::{info, warn};

use crate::error::{ProtoFsError, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncEvent {
    Created(PathBuf),
    Modified(PathBuf),
    Removed(PathBuf),
}

pub struct SyncWatcher {
    _watcher: RecommendedWatcher,
    rx: Receiver<notify::Result<Event>>,
    watched_path: PathBuf,
}

impl SyncWatcher {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let (tx, rx) = channel();
        let path_buf = path.as_ref().to_path_buf();

        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = tx.send(res);
            },
            Config::default(),
        )
        .map_err(|e| ProtoFsError::Io(std::io::Error::other(e.to_string())))?;

        watcher
            .watch(path.as_ref(), RecursiveMode::Recursive)
            .map_err(|e| ProtoFsError::Io(std::io::Error::other(e.to_string())))?;

        info!(
            "Native OS filesystem watcher registered for: {:?}",
            path.as_ref()
        );

        Ok(Self {
            _watcher: watcher,
            rx,
            watched_path: path_buf,
        })
    }

    pub fn watched_path(&self) -> &Path {
        &self.watched_path
    }

    pub fn try_recv(&self) -> Option<SyncEvent> {
        while let Ok(event_res) = self.rx.try_recv() {
            match event_res {
                Ok(event) => {
                    let first_path = event.paths.into_iter().next()?;
                    match event.kind {
                        EventKind::Create(_) => return Some(SyncEvent::Created(first_path)),
                        EventKind::Modify(_) => return Some(SyncEvent::Modified(first_path)),
                        EventKind::Remove(_) => return Some(SyncEvent::Removed(first_path)),
                        _ => {}
                    }
                }
                Err(e) => {
                    warn!("Filesystem watcher error: {:?}", e);
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn test_sync_watcher_detects_file_creation() {
        let dir = tempdir().unwrap();
        let watcher = SyncWatcher::new(dir.path()).unwrap();

        // Create a test file
        let file_path = dir.path().join("test_camera.jpg");
        let mut f = File::create(&file_path).unwrap();
        f.write_all(b"IMAGE_BYTES").unwrap();
        f.sync_all().unwrap();

        // Allow OS watcher thread to pick up event
        std::thread::sleep(std::time::Duration::from_millis(150));

        let event = watcher.try_recv();
        assert!(event.is_some());
    }
}
