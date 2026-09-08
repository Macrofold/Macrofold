//! Macrofold's typed REST API and incremental, resumable run streaming.
pub mod apis;
pub mod models;
mod options;
pub mod resources;
mod run_helpers;
mod streaming;
pub(crate) use options::request_error;
pub use options::{ClientBuilder, RequestError, RequestOptions};
pub use resources::DEFAULT_ORIGIN;
pub use run_helpers::{RunFailedError, WaitTimeoutError};
pub use streaming::Client as Macrofold;
pub use streaming::{Client, ClientError};
