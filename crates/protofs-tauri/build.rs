fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let dist = std::path::PathBuf::from(&manifest_dir).join("../../frontend/dist");
    if !dist.exists()
        && let Err(e) = std::fs::create_dir_all(&dist)
    {
        eprintln!("cargo:warning=Failed to create dist directory: {}", e);
    }
    let index_file = dist.join("index.html");
    if !index_file.exists()
        && let Err(e) = std::fs::write(
            index_file,
            "<!DOCTYPE html><html><body>ProtoFS</body></html>",
        )
    {
        eprintln!("cargo:warning=Failed to create dummy index.html: {}", e);
    }
    tauri_build::build()
}
