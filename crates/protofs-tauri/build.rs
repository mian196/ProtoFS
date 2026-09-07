fn main() {
    let dist = std::path::Path::new("../../frontend/dist");
    if !dist.exists() {
        let _ = std::fs::create_dir_all(dist);
        let index_file = dist.join("index.html");
        if !index_file.exists() {
            let _ = std::fs::write(index_file, "<!DOCTYPE html><html><body>ProtoFS</body></html>");
        }
    }
    tauri_build::build()
}
