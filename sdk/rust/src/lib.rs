//! Macrofold's typed REST API and incremental, resumable run streaming.
pub mod apis;
pub mod models;
mod streaming;
pub use streaming::{Client, ClientError};
