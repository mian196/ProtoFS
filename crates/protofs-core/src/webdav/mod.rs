pub mod server;
pub mod xml;

pub use server::{DEFAULT_WEBDAV_PORT, VIRTUAL_QUOTA_TOTAL, WebDavConfig, WebDavServer};
pub use xml::{WebDavProp, render_lockdiscovery, render_multistatus};
