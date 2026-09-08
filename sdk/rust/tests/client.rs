use macrofold::{
    resources::{ListCheckpointsParams, ListProjectsParams, WriteFileParams},
    Client, RequestOptions,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
const ID: &str = "00000000-0000-4000-8000-000000000001";

#[test]
fn credential_environment() {
    // Each environment case runs in its own process; other async tests cannot race env mutation.
    if let Ok(mode) = std::env::var("MACROFOLD_SDK_AUTH_PROBE") {
        let client = Client::new();
        if mode == "missing" {
            assert!(client
                .err()
                .unwrap()
                .to_string()
                .contains("MACROFOLD_API_KEY"));
        } else {
            let client = client.unwrap();
            assert_eq!(client.configuration().base_path, macrofold::DEFAULT_ORIGIN);
            assert_eq!(
                client.configuration().bearer_access_token.as_deref(),
                Some("environment-fixture")
            );
            assert!(Client::builder().api_key("").build().is_err());
            assert_eq!(
                Client::builder()
                    .api_key("explicit")
                    .build()
                    .unwrap()
                    .configuration()
                    .bearer_access_token
                    .as_deref(),
                Some("explicit")
            );
        }
        return;
    }
    for mode in ["missing", "present"] {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap());
        child
            .args(["--exact", "credential_environment"])
            .env("MACROFOLD_SDK_AUTH_PROBE", mode)
            .env_remove("MACROFOLD_API_KEY");
        if mode == "present" {
            child.env("MACROFOLD_API_KEY", "environment-fixture");
        }
        assert!(child.output().unwrap().status.success());
    }
}

#[tokio::test]
async fn resource_error_retains_identity_without_repeating_mutation() {
    let (origin, requests) = server(vec![(
        503,
        r#"{"error":{"code":"unavailable","message":"retry later"}}"#.into(),
    )])
    .await;
    let client = Client::builder()
        .base_url(origin)
        .api_key("explicit")
        .build()
        .unwrap();
    let error = client
        .projects()
        .create(macrofold::models::ProjectCreate::new("Research".into()))
        .await
        .unwrap_err();
    let failure = error.downcast_ref::<macrofold::RequestError>().unwrap();
    let key = failure.idempotency_key.as_deref().unwrap();
    assert!(uuid::Uuid::parse_str(key).is_ok());
    let requests = requests.await.unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0]
        .to_lowercase()
        .contains(&format!("idempotency-key: {key}")));
    assert!(failure.source.to_string().contains("503"));
}
async fn server(responses: Vec<(u16, String)>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = Vec::new();
        for (status, body) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buffer = [0; 4096];
                let count = socket.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let size: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap_or("0")
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + size {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            let content_type = if body.starts_with("data:") {
                "text/event-stream"
            } else {
                "application/json"
            };
            socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
            // Split UTF-8 and event boundaries across transport writes.
            for part in body.as_bytes().chunks(7) {
                socket.write_all(part).await.unwrap();
            }
        }
        requests
    });
    (origin, task)
}
fn event(sequence: &str, kind: &str) -> String {
    format!(
        "data: {}\r\n\r\n",
        serde_json::json!({"id":ID,"schema_version":1,"run_id":ID,"sequence":sequence,"type":kind,"occurred_at":"2026-09-07T00:00:00Z","ingested_at":"2026-09-07T00:00:00Z","data":{"text":"hello 🌍"}})
    )
}
#[tokio::test]
async fn typed_request_preserves_query_and_authorization() {
    let (origin, requests) = server(vec![(200, r#"{"data":[],"next_cursor":null}"#.into())]).await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let result = client
        .projects()
        .list(ListProjectsParams {
            limit: Some(3),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(result.data.is_empty());
    let request = requests.await.unwrap().remove(0).to_lowercase();
    assert!(request.contains("limit=3"));
    assert!(request.contains("authorization: bearer fixture"));
}
#[tokio::test]
async fn stream_reconnects_without_duplicates_and_preserves_utf8() {
    let succeeded = serde_json::json!({"id":ID,"organization_id":ID,"session_id":ID,"workspace_id":ID,"harness":"codex","model":"simulator","status":"succeeded","created_at":"2026-09-07T00:00:00Z"}).to_string();
    let remaining = format!(
        r#"{{"data":[{}],"next_cursor":null}}"#,
        event("2", "run.succeeded")
            .trim()
            .strip_prefix("data: ")
            .unwrap()
    );
    let (origin, requests) = server(vec![
        (200, event("1", "output.delta")),
        (200, succeeded),
        (200, remaining),
        (
            200,
            event("1", "output.delta") + &event("2", "run.succeeded"),
        ),
    ])
    .await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let mut events = Vec::new();
    client
        .runs()
        .with_options(RequestOptions {
            organization: Some(ID.into()),
            ..Default::default()
        })
        .stream(ID, "0", |e| {
            assert_eq!(e.data["text"], "hello 🌍");
            events.push(e.sequence);
            true
        })
        .await
        .unwrap();
    assert_eq!(events, vec!["1", "2"]);
    let requests = requests.await.unwrap();
    assert_eq!(requests.len(), 4);
    assert!(requests.iter().all(|request| request
        .to_lowercase()
        .contains(&format!("x-organization-id: {ID}"))));
    assert!(requests[2].contains("/events?after=1&limit=1"));
    assert!(requests[3].to_lowercase().contains("last-event-id: 1"));
    assert!(requests[3].contains("after=1"));
    assert!(client
        .configuration()
        .client
        .get("http://localhost")
        .build()
        .unwrap()
        .headers()
        .get("X-Organization-Id")
        .is_none());
}
#[tokio::test]
async fn denial_is_not_retried_and_callback_can_detach() {
    let (origin, requests) = server(vec![(403, "{}".into())]).await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    assert!(client
        .runs()
        .stream(ID, "0", |_| panic!("unexpected event"))
        .await
        .is_err());
    assert_eq!(requests.await.unwrap().len(), 1);
    let (origin, requests) = server(vec![(200, event("1", "output.delta"))]).await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    client.runs().stream(ID, "0", |_| false).await.unwrap();
    assert_eq!(requests.await.unwrap().len(), 1);
}
#[test]
fn origin_and_financial_precision() {
    for origin in [
        "http://example.com",
        "https://user:secret@example.com",
        "https://example.com/path",
        "https://example.com?key=secret",
    ] {
        assert!(Client::with_credentials(origin, "fixture").is_err());
    }
    let limits = macrofold::models::Limits {
        timeout_seconds: Some(300),
        max_cost_micro_usd: Some("9007199254740993".into()),
    };
    assert_eq!(
        serde_json::to_value(limits).unwrap()["max_cost_micro_usd"],
        "9007199254740993"
    );
}

#[tokio::test]
async fn mutation_and_binary_wire_contract() {
    let project = serde_json::json!({"id":ID,"organization_id":ID,"name":"Research","persistence":"persistent","created_at":"2026-09-07T00:00:00Z"}).to_string();
    let operation = serde_json::json!({"id":ID,"kind":"file.write","status":"succeeded","created_at":"2026-09-07T00:00:00Z","result":{"revision":"revision-2"}}).to_string();
    let (origin, requests) = server(vec![(201, project), (200, operation)]).await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let project = client
        .projects()
        .with_options(RequestOptions {
            idempotency_key: Some("request-1".into()),
            ..Default::default()
        })
        .create(macrofold::models::ProjectCreate::new("Research".into()))
        .await
        .unwrap();
    assert_eq!(project.name, "Research");
    let file = std::env::temp_dir().join(format!("macrofold-{}", uuid::Uuid::new_v4()));
    tokio::fs::write(&file, b"hello\0world").await.unwrap();
    let result = client
        .workspaces()
        .with_options(RequestOptions {
            idempotency_key: Some("request-2".into()),
            ..Default::default()
        })
        .write_file(
            ID,
            file.clone(),
            WriteFileParams {
                path: "notes/a + b.bin".into(),
                if_match: "revision-1".into(),
            },
        )
        .await;
    tokio::fs::remove_file(file).await.unwrap();
    assert_eq!(
        result.unwrap().status,
        macrofold::models::operation::Status::Succeeded
    );
    let requests = requests.await.unwrap();
    assert!(requests[0]
        .to_lowercase()
        .contains("content-type: application/json"));
    assert!(requests[0].contains("\"name\":\"Research\""));
    let binary = requests[1].to_lowercase();
    assert!(binary.contains("content-type: application/octet-stream"));
    assert!(binary.contains("idempotency-key: request-2"));
    assert!(binary.contains("if-match: revision-1"));
    assert!(binary.contains("path=notes%2fa+%2b+b.bin"));
    assert!(binary.ends_with("hello\0world"));
}

#[tokio::test]
#[ignore = "Run pnpm test:sdks for isolated application acceptance"]
async fn application_workflow() {
    let origin = std::env::var("MACROFOLD_FIXTURE_ORIGIN").expect("disposable application origin");
    let client =
        Client::with_credentials(&origin, &std::env::var("MACROFOLD_FIXTURE_KEY").unwrap())
            .unwrap();
    let files_workspace = std::env::var("MACROFOLD_FIXTURE_FILES_WORKSPACE").unwrap();
    for (path, expected) in [
        ("notes/日本語 + #?.bin", vec![0, 255, 10, 128]),
        ("empty.txt", vec![]),
    ] {
        let response = client
            .workspaces()
            .read_file(
                &files_workspace,
                macrofold::resources::ReadFileParams {
                    path: path.into(),
                    download: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            response.bytes().await.unwrap().as_ref(),
            expected.as_slice()
        );
    }
    let error = client
        .workspaces()
        .read_file(
            &files_workspace,
            macrofold::resources::ReadFileParams {
                path: "missing.txt".into(),
                download: None,
            },
        )
        .await
        .unwrap_err();
    let failure = error.downcast_ref::<macrofold::RequestError>().unwrap();
    let source = failure
        .source
        .downcast_ref::<macrofold::apis::Error<macrofold::apis::workspaces_api::ReadFileError>>()
        .unwrap();
    match source {
        macrofold::apis::Error::ResponseError(response) => {
            assert_eq!(response.status.as_u16(), 404)
        }
        other => panic!("expected an HTTP missing-file error, got {other:?}"),
    }
    let project = client
        .projects()
        .create(macrofold::models::ProjectCreate::new(
            "Rust application fixture".into(),
        ))
        .await
        .unwrap();
    let mut body = macrofold::models::RunCreate::new("Verify Rust persisted execution.".into());
    let agent = client
        .agents()
        .create(macrofold::models::AgentCreate::new(
            "Rust preset".into(),
            macrofold::models::agent_create::Harness::Codex,
            "fixture-model".into(),
            macrofold::models::agent_create::BillingMode::Managed,
        ))
        .await
        .unwrap();
    body.project_id = Some(project.id);
    body.agent_id = Some(agent.id);
    let run = client.runs().create(body).await.unwrap();
    let mut text = String::new();
    client
        .runs()
        .stream_text(&run.run_id.to_string(), "0", |part| {
            text.push_str(&part);
            true
        })
        .await
        .unwrap();
    let result = client.runs().wait(&run.run_id.to_string()).await.unwrap();
    assert_eq!(result.output_text.as_deref(), Some(text.as_str()));
    assert_eq!(result.persistence_status, "verified");
    assert_eq!(
        client
            .runs()
            .get(&run.run_id.to_string())
            .await
            .unwrap()
            .status,
        macrofold::models::run::Status::Succeeded
    );
    assert!(!client
        .workspaces()
        .list_checkpoints(
            &run.workspace_id.to_string(),
            ListCheckpointsParams::default()
        )
        .await
        .unwrap()
        .data
        .is_empty());
    let note = client
        .workspaces()
        .read_file(
            &run.workspace_id.to_string(),
            macrofold::resources::ReadFileParams {
                path: format!("notes/run-{}.md", run.run_id),
                download: None,
            },
        )
        .await
        .unwrap();
    assert!(note
        .text()
        .await
        .unwrap()
        .contains("Verify Rust persisted execution"));
    assert!(result.r#final);
    assert!(result.output_text.unwrap().contains("Simulation completed"));
}

fn helper_state(status: &str) -> String {
    serde_json::json!({"id":ID,"organization_id":ID,"session_id":ID,"workspace_id":ID,"harness":"codex","model":"fixture","status":status,"failure_code":"fixture_failure","created_at":"2026-09-07T00:00:00Z"}).to_string()
}
fn helper_result(persistence: &str, outcome: &str) -> String {
    serde_json::json!({"run_id":ID,"final":true,"output_text":"Hello 🌍","execution_outcome":outcome,"persistence_status":persistence,"checkpoint_id":ID}).to_string()
}
#[tokio::test]
async fn text_filters_replay_and_keeps_organization() {
    let (origin, requests) = server(vec![
        (
            200,
            event("1", "output.delta") + &event("2", "tool.completed"),
        ),
        (200, helper_state("running")),
        (
            200,
            event("1", "output.delta")
                + &event("2", "tool.completed")
                + &event("3", "reasoning.delta")
                + &event("4", "run.succeeded"),
        ),
        (200, helper_state("succeeded")),
        (200, helper_result("verified", "success")),
    ])
    .await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let mut text = Vec::new();
    client
        .runs()
        .with_options(RequestOptions {
            organization: Some(ID.into()),
            ..Default::default()
        })
        .stream_text(ID, "0", |part| {
            text.push(part);
            true
        })
        .await
        .unwrap();
    assert_eq!(text, vec!["hello 🌍"]);
    let requests = requests.await.unwrap();
    assert!(requests.iter().all(|request| request.starts_with("GET ")
        && request
            .to_lowercase()
            .contains(&format!("x-organization-id: {ID}"))));
    assert!(requests[2].to_lowercase().contains("last-event-id: 2"));
}
#[tokio::test]
async fn text_after_terminal_raises_typed_failure_for_every_outcome() {
    for (status, persistence, outcome) in [
        ("failed", "verified", "failure"),
        ("cancelled", "not_required", "cancelled"),
        ("timed_out", "verified", "timed_out"),
        ("succeeded", "failed", "success"),
    ] {
        let (origin, requests) = server(vec![
            (200, "".into()),
            (200, helper_state(status)),
            (200, r#"{"data":[],"next_cursor":null}"#.into()),
            (200, helper_state(status)),
            (200, helper_result(persistence, outcome)),
        ])
        .await;
        let client = Client::with_credentials(&origin, "fixture").unwrap();
        let error = client
            .runs()
            .stream_text(ID, "99", |_| panic!("unexpected text"))
            .await
            .unwrap_err();
        let failure = error.downcast_ref::<macrofold::RunFailedError>().unwrap();
        assert_eq!(failure.run_id, ID);
        assert_eq!(serde_json::to_value(failure.status).unwrap(), status);
        assert_eq!(failure.failure_code.as_deref(), Some("fixture_failure"));
        assert!(failure.to_string().contains(ID));
        assert!(requests
            .await
            .unwrap()
            .iter()
            .all(|request| request.starts_with("GET ")));
    }
}
#[tokio::test]
async fn wait_checks_persistence_and_detachment_skips_completion() {
    let (origin, requests) = server(vec![
        (200, event("1", "output.delta")),
        (200, helper_state("persisting")),
        (200, helper_state("succeeded")),
        (200, helper_result("pending", "success")),
        (200, helper_state("succeeded")),
        (200, helper_result("verified", "success")),
    ])
    .await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    client.runs().stream_text(ID, "0", |_| false).await.unwrap();
    let result = client.runs().wait(ID).await.unwrap();
    assert_eq!(result.output_text.as_deref(), Some("Hello 🌍"));
    assert_eq!(result.checkpoint_id.unwrap().to_string(), ID);
    let requests = requests.await.unwrap();
    assert_eq!(requests.len(), 6);
    assert!(requests[1..]
        .iter()
        .all(|request| !request.contains("/stream") && request.starts_with("GET ")));
}
#[tokio::test]
async fn wait_timeout_drops_inflight_read_without_cancelling_execution() {
    use std::time::Duration;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let request = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = [0; 8192];
        let count = socket.read(&mut bytes).await.unwrap();
        let request = String::from_utf8_lossy(&bytes[..count]).into_owned();
        let closed = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut bytes))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(closed, 0);
        request
    });
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let error = client
        .runs()
        .wait_with_timeout(ID, Duration::from_millis(100))
        .await
        .unwrap_err();
    assert_eq!(
        error
            .downcast_ref::<macrofold::WaitTimeoutError>()
            .unwrap()
            .run_id,
        ID
    );
    assert!(request
        .await
        .unwrap()
        .starts_with(&format!("GET /v1/runs/{ID} ")));
    let error = client
        .runs()
        .wait_with_timeout(ID, Duration::ZERO)
        .await
        .unwrap_err();
    assert!(error.is::<macrofold::WaitTimeoutError>());
}
