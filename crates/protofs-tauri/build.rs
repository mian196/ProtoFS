fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let dist = std::path::PathBuf::from(&manifest_dir).join("../../frontend/dist");
    if !dist.exists() {
        let _ = std::fs::create_dir_all(&dist);
    }
    let index_file = dist.join("index.html");
    if !index_file.exists() {
        let _ = std::fs::write(index_file, "<!DOCTYPE html><html><body>ProtoFS</body></html>");
    }
    tauri_build::build()
}

