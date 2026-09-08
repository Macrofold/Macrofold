use crate::{
    apis::{configuration::Configuration, runs_api},
    models::{run::Status, Event},
};
use futures_util::StreamExt;
use std::time::Duration;

pub type ClientError = Box<dyn std::error::Error + Send + Sync>;
pub struct Client {
    configuration: Configuration,
}
impl Client {
    pub fn new() -> Result<Self, ClientError> {
        Self::builder().build()
    }
    pub fn builder() -> crate::ClientBuilder {
        crate::ClientBuilder::default()
    }
    pub fn with_credentials(origin: &str, token: &str) -> Result<Self, ClientError> {
        if token.trim().is_empty() {
            return Err("missing Macrofold API key: use api_key or set MACROFOLD_API_KEY".into());
        }
        let url = url::Url::parse(origin)?;
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
            || (url.scheme() != "https" && !(url.scheme() == "http" && local))
        {
            return Err("use an HTTPS service origin (HTTP is allowed for localhost)".into());
        }
        let configuration = Configuration {
            base_path: origin.trim_end_matches('/').into(),
            bearer_access_token: Some(token.into()),
            client: reqwest::Client::builder()
                .default_headers(
                    [(
                        reqwest::header::HeaderName::from_static("x-client-type"),
                        reqwest::header::HeaderValue::from_static("sdk"),
                    )]
                    .into_iter()
                    .collect(),
                )
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(70))
                .build()?,
            ..Configuration::default()
        };
        Ok(Self { configuration })
    }
    /// Pass this configuration to the generated, typed API methods.
    pub fn configuration(&self) -> &Configuration {
        &self.configuration
    }

    /// Return false from receive, or drop this future, to detach without cancelling the run.
    pub async fn stream(
        &self,
        run_id: &str,
        after: &str,
        receive: impl FnMut(Event) -> bool,
    ) -> Result<(), ClientError> {
        self.stream_in_organization(run_id, after, None, receive)
            .await
    }

    pub(crate) async fn stream_in_organization(
        &self,
        run_id: &str,
        after: &str,
        organization: Option<&str>,
        mut receive: impl FnMut(Event) -> bool,
    ) -> Result<(), ClientError> {
        if after.is_empty() || !after.bytes().all(|b| b.is_ascii_digit()) {
            return Err("use a numeric event cursor".into());
        }
        let mut cursor: u64 = after.parse()?;
        let mut failures = 0u32;
        loop {
            let previous = cursor;
            let attempt = self
                .connection(run_id, &mut cursor, organization, &mut receive)
                .await;
            if cursor > previous {
                failures = 0;
            }
            match attempt {
                Ok(true) => return Ok(()),
                Ok(false) => {
                    failures = 0;
                    let run = runs_api::get_run(&self.configuration, run_id, organization).await?;
                    if matches!(
                        run.status,
                        Status::Succeeded | Status::Failed | Status::Cancelled | Status::TimedOut
                    ) {
                        let remaining = runs_api::list_run_events(
                            &self.configuration,
                            run_id,
                            Some(&cursor.to_string()),
                            None,
                            Some(1),
                            organization,
                        )
                        .await?;
                        if remaining.data.is_empty() {
                            return Ok(());
                        }
                    }
                }
                Err(error) => {
                    let transient = error
                        .downcast_ref::<reqwest::Error>()
                        .map(|e| {
                            e.is_timeout()
                                || e.is_connect()
                                || e.is_body()
                                || e.status()
                                    .map(|s| s.as_u16() == 429 || s.is_server_error())
                                    .unwrap_or(false)
                        })
                        .unwrap_or(false);
                    failures += 1;
                    if !transient || failures > 8 {
                        return Err(error);
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis((250u64 << failures).min(10000))).await;
        }
    }
    async fn connection(
        &self,
        run_id: &str,
        cursor: &mut u64,
        organization: Option<&str>,
        receive: &mut impl FnMut(Event) -> bool,
    ) -> Result<bool, ClientError> {
        let mut request = self
            .configuration
            .client
            .get(format!(
                "{}/v1/runs/{}/stream",
                self.configuration.base_path,
                crate::apis::urlencode(run_id)
            ))
            .bearer_auth(
                self.configuration
                    .bearer_access_token
                    .as_deref()
                    .unwrap_or_default(),
            )
            .header("X-Client-Type", "sdk")
            .header("Accept", "text/event-stream")
            .header("Last-Event-ID", cursor.to_string())
            .query(&[("after", cursor.to_string())]);
        if let Some(organization) = organization {
            request = request.header("X-Organization-Id", organization);
        }
        let response = request.send().await?.error_for_status()?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(format!("event stream rejected: HTTP {}", response.status()).into());
        }
        let mut chunks = response.bytes_stream();
        let mut line = Vec::new();
        let mut data = Vec::new();
        while let Some(chunk) = chunks.next().await {
            for byte in chunk? {
                if byte != b'\n' {
                    line.push(byte);
                    if line.len() + data.len() > 4 * 1024 * 1024 {
                        return Err("SSE frame exceeds client limit".into());
                    }
                    continue;
                }
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if line.is_empty() {
                    if let Ok(event) = serde_json::from_slice::<Event>(&data) {
                        if let Ok(sequence) = event.sequence.parse::<u64>() {
                            if sequence > *cursor {
                                let terminal = matches!(
                                    event.r#type.as_str(),
                                    "run.succeeded"
                                        | "run.failed"
                                        | "run.cancelled"
                                        | "run.timed_out"
                                );
                                let keep = receive(event);
                                *cursor = sequence;
                                if terminal || !keep {
                                    return Ok(true);
                                }
                            }
                        }
                    }
                    data.clear();
                } else if let Some(value) = line.strip_prefix(b"data:") {
                    data.extend_from_slice(value.strip_prefix(b" ").unwrap_or(value));
                    data.push(b'\n');
                }
                line.clear();
            }
        }
        Ok(false)
    }
}
