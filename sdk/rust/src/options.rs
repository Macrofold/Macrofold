use crate::{Client, ClientError, DEFAULT_ORIGIN};

/// Constructor options. An explicitly empty key is an error, never an environment fallback.
#[derive(Default)]
pub struct ClientBuilder {
    origin: Option<String>,
    key: Option<String>,
}
impl ClientBuilder {
    pub fn base_url(mut self, origin: impl Into<String>) -> Self {
        self.origin = Some(origin.into());
        self
    }
    pub fn api_key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }
    pub fn build(self) -> Result<Client, ClientError> {
        let key = self
            .key
            .or_else(|| std::env::var("MACROFOLD_API_KEY").ok())
            .unwrap_or_default();
        Client::with_credentials(self.origin.as_deref().unwrap_or(DEFAULT_ORIGIN), &key)
    }
}
#[derive(Debug, Clone, Default)]
pub struct RequestOptions {
    pub idempotency_key: Option<String>,
    pub organization: Option<String>,
}
#[derive(Debug)]
pub struct RequestError {
    pub idempotency_key: Option<String>,
    pub source: ClientError,
}
impl std::fmt::Display for RequestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.source.fmt(f)
    }
}
impl std::error::Error for RequestError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.source.as_ref())
    }
}
pub(crate) fn request_error(
    error: impl std::error::Error + Send + Sync + 'static,
    key: Option<String>,
) -> ClientError {
    Box::new(RequestError {
        idempotency_key: key,
        source: Box::new(error),
    })
}
