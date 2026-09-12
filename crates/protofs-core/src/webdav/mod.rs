pub mod server;
pub mod xml;

pub use server::{WebDavConfig, WebDavServer, DEFAULT_WEBDAV_PORT, VIRTUAL_QUOTA_TOTAL};
pub use xml::{render_lockdiscovery, render_multistatus, WebDavProp};
