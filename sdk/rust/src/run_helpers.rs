use crate::{
    models::{Event, RunResult},
    resources::RunsResource,
    ClientError,
};
use std::time::Duration;

#[derive(Debug)]
pub struct RunFailedError {
    pub run_id: String,
    pub status: crate::models::run::Status,
    pub failure_code: Option<String>,
    pub result: RunResult,
}
impl std::fmt::Display for RunFailedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Run {} ended with status {:?} (persistence: {}).",
            self.run_id, self.status, self.result.persistence_status
        )
    }
}
impl std::error::Error for RunFailedError {}
#[derive(Debug)]
pub struct WaitTimeoutError {
    pub run_id: String,
}
impl std::fmt::Display for WaitTimeoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Timed out waiting for run {}. The agent has not been cancelled.",
            self.run_id
        )
    }
}
impl std::error::Error for WaitTimeoutError {}

impl RunsResource<'_> {
    pub async fn events(
        &self,
        run_id: &str,
        after: &str,
        receive: impl FnMut(Event) -> bool,
    ) -> Result<(), ClientError> {
        self.stream(run_id, after, receive).await
    }
    pub async fn stream_text(
        &self,
        run_id: &str,
        after: &str,
        mut receive: impl FnMut(String) -> bool,
    ) -> Result<(), ClientError> {
        let mut detached = false;
        self.events(run_id, after, |event| {
            if event.r#type == "output.delta" {
                if let Some(text) = event
                    .data
                    .get("text")
                    .and_then(|value| value.as_str())
                    .filter(|text| !text.is_empty())
                {
                    detached = !receive(text.to_owned());
                }
            }
            !detached
        })
        .await?;
        if !detached {
            self.wait(run_id).await?;
        }
        Ok(())
    }
    /// Dropping this future stops waiting; it never cancels the remote run.
    pub async fn wait(&self, run_id: &str) -> Result<RunResult, ClientError> {
        use crate::models::run::Status;
        loop {
            let run = self.get(run_id).await?;
            if matches!(
                run.status,
                Status::Succeeded | Status::Failed | Status::Cancelled | Status::TimedOut
            ) {
                let result = self.get_result(run_id).await?;
                if result.r#final && result.persistence_status != "pending" {
                    if run.status != Status::Succeeded
                        || result.execution_outcome != "success"
                        || !matches!(
                            result.persistence_status.as_str(),
                            "verified" | "not_required"
                        )
                    {
                        return Err(Box::new(RunFailedError {
                            run_id: run_id.into(),
                            status: run.status,
                            failure_code: run.failure_code,
                            result,
                        }));
                    }
                    return Ok(result);
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    pub async fn wait_with_timeout(
        &self,
        run_id: &str,
        timeout: Duration,
    ) -> Result<RunResult, ClientError> {
        if timeout.is_zero() {
            return Err(Box::new(WaitTimeoutError {
                run_id: run_id.into(),
            }));
        }
        tokio::time::timeout(timeout, self.wait(run_id))
            .await
            .map_err(|_| -> ClientError {
                Box::new(WaitTimeoutError {
                    run_id: run_id.into(),
                })
            })?
    }
}
