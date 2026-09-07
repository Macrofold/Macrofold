use macrofold::{apis::projects_api, Client};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
const ID: &str = "00000000-0000-4000-8000-000000000001";
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
    let client = Client::new(&origin, "fixture").unwrap();
    let result =
        projects_api::list_projects(client.configuration(), None, Some(3), None, None, None)
            .await
            .unwrap();
    assert!(result.data.is_empty());
    let request = requests.await.unwrap().remove(0).to_lowercase();
    assert!(request.contains("limit=3"));
    assert!(request.contains("authorization: bearer fixture"));
}
#[tokio::test]
async fn stream_reconnects_without_duplicates_and_preserves_utf8() {
    let running = serde_json::json!({"id":ID,"organization_id":ID,"session_id":ID,"workspace_id":ID,"harness":"codex","model":"simulator","status":"running","created_at":"2026-09-07T00:00:00Z"}).to_string();
    let (origin, requests) = server(vec![
        (200, event("1", "output.delta")),
        (200, running),
        (
            200,
            event("1", "output.delta") + &event("2", "run.succeeded"),
        ),
    ])
    .await;
    let client = Client::new(&origin, "fixture").unwrap();
    let mut events = Vec::new();
    client
        .stream(ID, "0", |e| {
            assert_eq!(e.data["text"], "hello 🌍");
            events.push(e.sequence);
            true
        })
        .await
        .unwrap();
    assert_eq!(events, vec!["1", "2"]);
    let requests = requests.await.unwrap();
    assert!(requests[2].to_lowercase().contains("last-event-id: 1"));
    assert!(requests[2].contains("after=1"));
}
#[tokio::test]
async fn denial_is_not_retried_and_callback_can_detach() {
    let (origin, requests) = server(vec![(403, "{}".into())]).await;
    let client = Client::new(&origin, "fixture").unwrap();
    assert!(client
        .stream(ID, "0", |_| panic!("unexpected event"))
        .await
        .is_err());
    assert_eq!(requests.await.unwrap().len(), 1);
    let (origin, requests) = server(vec![(200, event("1", "output.delta"))]).await;
    let client = Client::new(&origin, "fixture").unwrap();
    client.stream(ID, "0", |_| false).await.unwrap();
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
        assert!(Client::new(origin, "fixture").is_err());
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
    let client = Client::new(&origin, "fixture").unwrap();
    let project = projects_api::create_project(
        client.configuration(),
        "request-1",
        macrofold::models::ProjectCreate::new("Research".into()),
        None,
    )
    .await
    .unwrap();
    assert_eq!(project.name, "Research");
    let file = std::env::temp_dir().join(format!("macrofold-{}", uuid::Uuid::new_v4()));
    tokio::fs::write(&file, b"hello\0world").await.unwrap();
    let result = macrofold::apis::workspaces_api::write_file(
        client.configuration(),
        ID,
        "notes/a + b.bin",
        "revision-1",
        "request-2",
        file.clone(),
        None,
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
    let client = Client::new(&origin, &std::env::var("MACROFOLD_FIXTURE_KEY").unwrap()).unwrap();
    let project = projects_api::create_project(
        client.configuration(),
        "rust-project",
        macrofold::models::ProjectCreate::new("Rust application fixture".into()),
        None,
    )
    .await
    .unwrap();
    let mut body = macrofold::models::RunCreate::new("Verify Rust persisted execution.".into());
    body.project_id = Some(project.id);
    body.harness = Some(macrofold::models::run_create::Harness::Codex);
    body.model = Some("fixture-model".into());
    body.billing_mode = Some(macrofold::models::run_create::BillingMode::Managed);
    let run =
        macrofold::apis::runs_api::create_run(client.configuration(), "rust-run-fixture", Some(body), None)
            .await
            .unwrap();
    let mut terminal = String::new();
    client
        .stream(&run.run_id.to_string(), "0", |event| {
            terminal = event.r#type;
            true
        })
        .await
        .unwrap();
    assert_eq!(terminal, "run.succeeded");
    let result = macrofold::apis::runs_api::get_run_result(
        client.configuration(),
        &run.run_id.to_string(),
        None,
    )
    .await
    .unwrap();
    assert!(result.r#final);
    assert!(result.output_text.unwrap().contains("Simulation completed"));
}
