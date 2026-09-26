use crate::{models, Client, ClientError, RequestOptions};
use std::time::Duration;

impl Client {
    /// Single POST, no token replay. Dropping the future detaches, not cancels.
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
        let result: Result<(), ClientError> = async {
            let cfg = self.configuration();
            let mut request = cfg
                .client
                .post(format!("{}/v1/inferences", cfg.base_path))
                .timeout(Duration::from_secs(300))
                .bearer_auth(cfg.bearer_access_token.as_deref().unwrap_or_default())
                .header("Accept", "text/event-stream")
                .header("Idempotency-Key", &key)
                .json(&input);
            if let Some(org) = &options.organization {
                request = request.header("X-Organization-Id", org);
            }
            let response = request.send().await?;
            if !response.status().is_success() {
                return Err(
                    format!("inference stream rejected: HTTP {}", response.status()).into(),
                );
            }
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
                let event: models::InferenceStreamEvent = serde_json::from_slice(data)?;
                let failed = event.r#type == "transport.error";
                let terminal = matches!(
                    event.r#type.as_str(),
                    "run.succeeded" | "run.failed" | "run.cancelled" | "run.timed_out"
                );
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
        result.map_err(|source| {
            Box::new(crate::RequestError {
                idempotency_key: Some(key),
                source,
            }) as ClientError
        })
    }
}
