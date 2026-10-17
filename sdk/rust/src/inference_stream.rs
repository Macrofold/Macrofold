use crate::{models, Client, ClientError, RequestOptions};
use std::time::Duration;
use tokio::time::Instant;

#[derive(Debug)]
pub struct InferenceHttpError {
    pub status: u16,
    pub code: String,
    pub request_id: Option<String>,
    pub details: serde_json::Value,
    pub retryable: bool,
}
impl std::fmt::Display for InferenceHttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "inference HTTP {}: {}", self.status, self.code)
    }
}
impl std::error::Error for InferenceHttpError {}

impl Client {
    async fn open_inference(
        &self,
        input: &models::InferenceCreate,
        options: &RequestOptions,
        key: &str,
        stream: bool,
        deadline: Instant,
    ) -> Result<reqwest::Response, ClientError> {
        if options.inference_retries > 2 {
            return Err("inference_retries must be 0–2".into());
        }
        let cfg = self.configuration();
        for attempt in 0..=options.inference_retries {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or("inference deadline expired")?;
            let mut request = cfg
                .client
                .post(format!("{}/v1/inferences", cfg.base_path))
                .timeout(remaining)
                .bearer_auth(cfg.bearer_access_token.as_deref().unwrap_or_default())
                .header("Idempotency-Key", key)
                .json(input);
            if stream {
                request = request.header("Accept", "text/event-stream");
            }
            if let Some(org) = &options.organization {
                request = request.header("X-Organization-Id", org);
            }
            let response = request.send().await?; // An ambiguous network failure is never replayed.
            if response.status().is_success() {
                return Ok(response);
            }
            let status = response.status().as_u16();
            let hint = response
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string();
            let request_id = response
                .headers()
                .get("x-request-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            let run_id = response
                .headers()
                .get("x-run-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            let body: serde_json::Value = response.json().await.map_err(|source| {
                inference_error(
                    Box::new(source),
                    key.to_string(),
                    run_id.clone(),
                    None,
                    request_id.clone(),
                )
            })?;
            let payload = &body["error"];
            let mut details = payload["details"].clone();
            if let Some(run_id) = run_id {
                if !details.is_object() {
                    details = serde_json::json!({});
                }
                if details["run_id"].is_null() {
                    details["run_id"] = run_id.into();
                }
            }
            let error = InferenceHttpError {
                status,
                code: payload["code"].as_str().unwrap_or("http_error").to_string(),
                request_id: request_id
                    .or_else(|| payload["request_id"].as_str().map(str::to_string)),
                details,
                retryable: payload["retryable"] == true,
            };
            let safe = payload["retryable"] == true
                && error.details["run_id"].is_null()
                && matches!(
                    error.code.as_str(),
                    "rate_limited"
                        | "inference_capacity_unavailable"
                        | "streaming_capacity_unavailable"
                        | "inference_service_unavailable"
                        | "inference_admission_timeout"
                        | "inference_host_budget_exhausted"
                );
            if attempt == options.inference_retries || !matches!(status, 429 | 503) || !safe {
                return Err(Box::new(error));
            }
            let seconds = hint
                .parse::<f64>()
                .ok()
                .filter(|v| *v >= 0.0)
                .or_else(|| {
                    chrono::DateTime::parse_from_rfc2822(&hint)
                        .ok()
                        .map(|date| {
                            ((date.timestamp_millis() - chrono::Utc::now().timestamp_millis())
                                as f64
                                / 1000.0)
                                .max(0.0)
                        })
                })
                .unwrap_or(0.0);
            let wait = seconds.max(0.2 * 2f64.powi(attempt.into()))
                + f64::from(uuid::Uuid::new_v4().as_bytes()[0] % 100 + 1) / 1000.0;
            if wait
                >= deadline
                    .saturating_duration_since(Instant::now())
                    .as_secs_f64()
            {
                return Err(Box::new(error));
            }
            tokio::time::sleep(Duration::from_secs_f64(wait)).await;
        }
        unreachable!()
    }
    pub(crate) async fn create_immediate_inference(
        &self,
        input: models::InferenceCreate,
        options: &RequestOptions,
    ) -> Result<models::InferenceResponse, ClientError> {
        let key = options
            .idempotency_key
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut run_id = None;
        let mut request_id = None;
        let result: Result<models::InferenceResponse, ClientError> = async {
            if input.stream == Some(true) {
                return Err("use inferences().stream for incremental output".into());
            }
            let deadline = Instant::now()
                + options
                    .inference_timeout
                    .unwrap_or(Duration::from_secs(300));
            let response = self
                .open_inference(&input, options, &key, false, deadline)
                .await?;
            run_id = response
                .headers()
                .get("x-run-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            request_id = response
                .headers()
                .get("x-request-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            Ok(response.json().await?)
        }
        .await;
        result.map_err(|source| inference_error(source, key, run_id, None, request_id))
    }
    /// Single POST by default. Dropping the future detaches; it never cancels the Run.
    pub async fn stream_inference(
        &self,
        mut input: models::InferenceCreate,
        options: &RequestOptions,
        mut receive: impl FnMut(models::InferenceStreamEvent) -> bool,
    ) -> Result<(), ClientError> {
        input.stream = Some(true);
        let key = options
            .idempotency_key
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut run_id = None;
        let mut urls = None;
        let mut request_id = None;
        let result: Result<(), ClientError> = async {
            let deadline = Instant::now()
                + options
                    .inference_timeout
                    .unwrap_or(Duration::from_secs(300));
            let response = self
                .open_inference(&input, options, &key, true, deadline)
                .await?;
            run_id = response
                .headers()
                .get("x-run-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            request_id = response
                .headers()
                .get("x-request-id")
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);
            if !response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .contains("text/event-stream")
            {
                return Err("expected a direct event stream".into());
            }
            let ended = crate::streaming::read_sse(response, |data| {
                let raw: serde_json::Value = serde_json::from_slice(data)?;
                run_id = raw["run_id"].as_str().map(str::to_string).or(run_id.take());
                if let Some(value) = raw["data"].get("urls") {
                    urls = Some(value.clone());
                }
                let failed = raw["type"] == "transport.error";
                let terminal = matches!(
                    raw["type"].as_str(),
                    Some("run.succeeded" | "run.failed" | "run.cancelled" | "run.timed_out")
                );
                let event: models::InferenceStreamEvent = serde_json::from_value(raw)?;
                if !receive(event) {
                    return Ok(true);
                }
                if failed {
                    return Err("stream interrupted; retrieve the saved run result".into());
                }
                Ok(terminal)
            })
            .await?;
            if !ended {
                return Err(
                    "stream ended before terminal result; retrieve the saved run result".into(),
                );
            }
            Ok(())
        }
        .await;
        result.map_err(|source| inference_error(source, key, run_id, urls, request_id))
    }
}
fn inference_error(
    source: ClientError,
    key: String,
    mut run_id: Option<String>,
    mut urls: Option<serde_json::Value>,
    known_request_id: Option<String>,
) -> ClientError {
    if source.is::<crate::RequestError>() {
        return source;
    }
    let request_id = if let Some(error) = source.downcast_ref::<InferenceHttpError>() {
        run_id = error.details["run_id"]
            .as_str()
            .map(str::to_string)
            .or(run_id);
        urls = error.details.get("urls").cloned().or(urls);
        error.request_id.clone().or(known_request_id)
    } else {
        known_request_id
    };
    Box::new(crate::RequestError {
        idempotency_key: Some(key),
        run_id,
        urls,
        request_id,
        source,
    })
}
