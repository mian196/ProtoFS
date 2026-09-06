use clap::{Parser, Subcommand};
use protofs_core::cache::CacheDatabase;
use protofs_core::manifest::ManifestSnapshot;

#[derive(Parser)]
#[command(name = "protofs-cli")]
#[command(about = "ProtoFS: Unlimited cloud file storage powered by Telegram MTProto", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Inspect or verify a compressed manifest.json.zst file
    Manifest {
        #[command(subcommand)]
        sub: ManifestCommands,
    },
    /// Search local SQLite cache index using FTS5
    Search {
        #[arg(short, long)]
        db: String,
        #[arg(short, long)]
        drive: String,
        #[arg(short, long)]
        query: String,
    },
    /// Print version and architecture info
    Info,
}

#[derive(Subcommand)]
enum ManifestCommands {
    /// Decompress and display manifest summary
    Inspect {
        #[arg(short, long)]
        path: String,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();

    match cli.command {
        Commands::Info => {
            println!("ProtoFS CLI v0.2.0");
            println!("Storage Architecture: Parent ID Pattern + Zstd Compressed Manifest + SQLite FTS5 Cache");
            println!("Encryption: Chunked AEAD (AES-256-GCM via STREAM) + Argon2id");
        }
        Commands::Manifest { sub } => match sub {
            ManifestCommands::Inspect { path } => {
                let data = std::fs::read(&path)?;
                let manifest = ManifestSnapshot::from_compressed_bytes(&data)?;
                println!("Manifest Header for Drive '{}':", manifest.header.drive_id);
                println!("  Version: {}", manifest.header.version);
                println!("  Generated At: {}", manifest.header.generated_at);
                println!("  Folders: {}", manifest.header.folder_count);
                println!("  Files: {}", manifest.header.file_count);
            }
        },
        Commands::Search { db, drive, query } => {
            let cache = CacheDatabase::open(db)?;
            let results = cache.search(&drive, &query)?;
            println!("Found {} results for '{}':", results.len(), query);
            for r in results {
                println!("  [{}] {} (ID: {})", r.kind, r.name, r.id);
            }
        }
    }

    Ok(())
}
