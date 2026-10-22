use macrofold::{models, Client, RequestError, RequestOptions};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
const ID: &str = "01900000-0000-7000-8000-000000000001";

#[test]
fn deployment_boolean_constants_keep_json_types_and_literal_constraints() {
    use models::model_deployment_cost_policy::InfrastructureCostIncluded;
    use models::model_deployment_hosting_one_of_1::ExternalHostingAcknowledged;

    let cost: InfrastructureCostIncluded = serde_json::from_value(serde_json::json!(false)).unwrap();
    assert_eq!(serde_json::to_value(cost).unwrap(), serde_json::json!(false));
    for invalid in [serde_json::json!(true), serde_json::json!("false")] {
        assert!(serde_json::from_value::<InfrastructureCostIncluded>(invalid).is_err());
    }
    let acknowledged: ExternalHostingAcknowledged =
        serde_json::from_value(serde_json::json!(true)).unwrap();
    assert_eq!(serde_json::to_value(acknowledged).unwrap(), serde_json::json!(true));
    for invalid in [serde_json::json!(false), serde_json::json!("true")] {
        assert!(serde_json::from_value::<ExternalHostingAcknowledged>(invalid).is_err());
    }
}

#[tokio::test]
#[ignore = "Run pnpm test:sdks for isolated application acceptance"]
async fn application_immediate_json_and_sse() {
    let origin = std::env::var("MACROFOLD_FIXTURE_ORIGIN").unwrap();
    let client =
        Client::with_credentials(&origin, &std::env::var("MACROFOLD_FIXTURE_KEY").unwrap())
            .unwrap();
    let input: models::InferenceCreate = serde_json::from_slice(
        &std::fs::read(std::env::var("MACROFOLD_FIXTURE_INFERENCE_INPUT").unwrap()).unwrap(),
    )
    .unwrap();
    let deployment_id = std::env::var("MACROFOLD_FIXTURE_DEPLOYMENT").unwrap();
    let deployment = client
        .model_deployments()
        .get(&deployment_id, Default::default())
        .await
        .unwrap();
    assert_eq!(deployment.state, models::model_deployment::State::Stopped);
    assert!(deployment.serving_revision_id.is_none());
    assert!(deployment.infrastructure_cost.estimated_micro_usd.is_none());
    assert_eq!(
        serde_json::to_value(&deployment.cost_policy.request_charge_micro_usd).unwrap(),
        serde_json::json!("0")
    );
    let selected = client
        .model_deployments()
        .get_revision(
            &deployment_id,
            &std::env::var("MACROFOLD_FIXTURE_DEPLOYMENT_REVISION").unwrap(),
            Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(&selected.source).unwrap()["kind"],
        "external"
    );
    assert_eq!(
        serde_json::to_value(&selected.hosting).unwrap()["kind"],
        "external_openai"
    );
    assert_eq!(
        client
            .model_deployments()
            .list_grants(&deployment_id, Default::default())
            .await
            .unwrap()
            .data
            .len(),
        1
    );
    let stopped_input: models::InferenceCreate = serde_json::from_slice(
        &std::fs::read(std::env::var("MACROFOLD_FIXTURE_DEPLOYMENT_INFERENCE_INPUT").unwrap())
            .unwrap(),
    )
    .unwrap();
    let stopped = client.inferences().create(stopped_input).await.unwrap_err();
    let request = stopped.downcast_ref::<RequestError>().unwrap();
    let api = request.source.downcast_ref::<macrofold::apis::Error<macrofold::apis::inferences_api::CreateInferenceError>>().unwrap();
    match api {
        macrofold::apis::Error::ResponseError(response) => {
            assert_eq!(response.status.as_u16(), 409);
            assert!(response.content.contains("deployment_not_ready"));
        }
        _ => panic!("stopped deployment must reject before dispatch"),
    }
    let ready_id = std::env::var("MACROFOLD_FIXTURE_READY_DEPLOYMENT_RUST").unwrap();
    let ready_revision = std::env::var("MACROFOLD_FIXTURE_READY_DEPLOYMENT_REVISION_RUST").unwrap();
    let ready_input: models::InferenceCreate = serde_json::from_slice(
        &std::fs::read(std::env::var("MACROFOLD_FIXTURE_READY_DEPLOYMENT_INPUT_RUST").unwrap())
            .unwrap(),
    )
    .unwrap();
    let deployed_receipt = |result: &models::RunResult, native_extra: bool| {
        assert!(result.r#final);
        let value = serde_json::to_value(result.inference.as_ref().unwrap()).unwrap();
        assert_eq!(value["outcome"], "value");
        assert_eq!(value["deployment"]["deployment_id"], ready_id);
        assert_eq!(
            value["deployment"]["deployment_revision_id"],
            ready_revision
        );
        assert_eq!(value["cost_attribution"]["basis"], "deployment");
        assert_eq!(
            value["cost_attribution"]["infrastructure_cost_included"],
            false
        );
        assert_eq!(value["billing"]["billing_mode"], "byok");
        for field in [
            "charged_micro_usd",
            "budget_cost_micro_usd",
            "reported_micro_usd",
        ] {
            assert_eq!(value["billing"][field], "0");
        }
        for field in [
            "provider_cost_micro_usd",
            "provider_reported_cost_usd",
            "upstream_inference_cost_usd",
        ] {
            assert!(value["billing"][field].is_null());
        }
        assert_eq!(value["usage"]["input_tokens"], "11");
        assert_eq!(value["usage"]["output_tokens"], "4");
        assert_eq!(
            value["value"]["choices"][0]["message"]["content"],
            "Hello from the deployment SDK fixture."
        );
        if native_extra {
            assert_eq!(value["value"]["provider_native_extra"]["retained"], true);
            assert_eq!(
                value["value"]["choices"][0]["message"]["annotations"],
                serde_json::json!([])
            );
        }
    };
    let ready_options = RequestOptions {
        idempotency_key: Some(uuid::Uuid::new_v4().to_string()),
        ..Default::default()
    };
    let ready_response = client
        .inferences()
        .with_options(ready_options.clone())
        .create(ready_input.clone())
        .await
        .unwrap();
    let ready_result = if ready_response.status == models::inference_response::Status::Running {
        client
            .runs()
            .wait(&ready_response.run_id.to_string())
            .await
            .unwrap()
    } else {
        ready_response.result.as_ref().unwrap().as_ref().clone()
    };
    deployed_receipt(&ready_result, true);
    let mut deployed_text = String::new();
    let mut deployed_terminal = false;
    client
        .inferences()
        .stream(ready_input.clone(), |event| {
            if event.r#type == models::inference_stream_event::Type::OutputDelta {
                deployed_text.push_str(event.data.text.as_deref().unwrap());
            }
            if event.r#type == models::inference_stream_event::Type::RunSucceeded {
                deployed_receipt(event.data.result.as_ref().unwrap(), false);
                deployed_terminal = true;
            }
            true
        })
        .await
        .unwrap();
    assert_eq!(deployed_text, "Hello from the deployment SDK fixture.");
    assert!(deployed_terminal);
    let stop: models::ModelDeploymentServiceInput = serde_json::from_value(serde_json::json!({ "deployment_revision_id": ready_revision, "desired_state": "stopped", "policy": { "max_concurrent_requests": 2, "stop_at": null } })).unwrap();
    client
        .model_deployments()
        .set_service(&ready_id, stop)
        .await
        .unwrap();
    let recovered = client
        .inferences()
        .with_options(ready_options)
        .create(ready_input)
        .await
        .unwrap();
    assert_eq!(recovered.run_id, ready_response.run_id);
    deployed_receipt(recovered.result.as_ref().unwrap(), true);
    let receipt = |result: &models::RunResult| {
        assert!(result.r#final);
        assert_eq!(result.persistence_status, "not_required");
        let value = serde_json::to_value(result.inference.as_ref().unwrap()).unwrap();
        assert_eq!(value["outcome"], "value");
        assert_eq!(value["usage"]["input_tokens"], "100");
        assert_eq!(value["usage"]["output_tokens"], "10");
        assert_eq!(value["usage"]["completeness"], "complete");
        assert_eq!(value["billing"]["billing_mode"], "managed");
        assert_eq!(value["billing"]["provisional"], false);
        assert!(
            value["billing"]["charged_micro_usd"]
                .as_str()
                .unwrap()
                .parse::<u64>()
                .unwrap()
                > 0
        );
    };
    let options = RequestOptions {
        idempotency_key: Some(uuid::Uuid::new_v4().to_string()),
        ..Default::default()
    };
    let response = client
        .inferences()
        .with_options(options.clone())
        .create(input.clone())
        .await
        .unwrap();
    assert_eq!(
        response.status,
        models::inference_response::Status::Succeeded
    );
    receipt(response.result.as_ref().unwrap());
    let replay = client
        .inferences()
        .with_options(options)
        .create(input.clone())
        .await
        .unwrap();
    assert_eq!(response.run_id, replay.run_id);
    let mut text = String::new();
    let mut terminal = false;
    client
        .inferences()
        .stream(input, |event| {
            if event.r#type == models::inference_stream_event::Type::OutputDelta {
                text.push_str(event.data.text.as_deref().unwrap());
            }
            if event.r#type == models::inference_stream_event::Type::RunSucceeded {
                receipt(event.data.result.as_ref().unwrap());
                terminal = true;
            }
            true
        })
        .await
        .unwrap();
    assert_eq!(text, "Hello from the SDK fixture.");
    assert!(terminal);
}
fn urls() -> serde_json::Value {
    serde_json::json!({"status":"https://example.test/status","result":"https://example.test/result","events":"https://example.test/events","stream":"https://example.test/stream","cancel":"https://example.test/cancel"})
}
fn recovery() -> String {
    serde_json::json!({"run_id":ID,"session_id":null,"worktree_id":null,"status":"running","recovery_reason":"finalization_pending","urls":urls()}).to_string()
}
fn busy() -> String {
    serde_json::json!({"error":{"code":"inference_service_unavailable","message":"Busy","retryable":true,"request_id":ID,"details":{"reason":"local_capacity"}}}).to_string()
}
fn input() -> models::InferenceCreate {
    serde_json::from_value(serde_json::json!({"input":{},"model_binding":{"provider":"openrouter","model":"fixture","billing_mode":"managed"},"limits":{"max_cost_micro_usd":"1000","max_output_tokens":10,"timeout_seconds":10}})).unwrap()
}
async fn server(
    replies: Vec<(u16, &'static str, String)>,
) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let handle = tokio::spawn(async move {
        let mut requests = vec![];
        for (status, headers, body) in replies {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![];
            loop {
                let mut buffer = [0; 4096];
                let count = socket.read(&mut buffer).await.unwrap();
                if count == 0 {
                    break;
                }
                bytes.extend_from_slice(&buffer[..count]);
                if bytes.windows(4).any(|v| v == b"\r\n\r\n") {
                    break;
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            socket.write_all(format!("HTTP/1.1 {} Response\r\nConnection: close\r\nContent-Length: {}\r\n{}\r\n{}",status,body.len(),headers,body).as_bytes()).await.unwrap();
        }
        requests
    });
    (origin, handle)
}
#[tokio::test]
async fn default_is_single_attempt_and_error_retains_identity() {
    let (origin, requests) = server(vec![(
        503,
        "Content-Type: application/json\r\nX-Run-Id: 01900000-0000-7000-8000-000000000001\r\n",
        busy(),
    )])
    .await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let error = client
        .inferences()
        .with_options(RequestOptions {
            idempotency_key: Some("saved".into()),
            ..Default::default()
        })
        .create(input())
        .await
        .unwrap_err();
    assert_eq!(
        error
            .downcast_ref::<RequestError>()
            .unwrap()
            .idempotency_key
            .as_deref(),
        Some("saved")
    );
    assert_eq!(requests.await.unwrap().len(), 1);
    assert_eq!(
        error
            .downcast_ref::<RequestError>()
            .unwrap()
            .run_id
            .as_deref(),
        Some(ID)
    );
}
#[tokio::test]
async fn explicit_retry_keeps_same_key_and_returns_recovery_without_polling() {
    let (origin, requests) = server(vec![
        (503, "Content-Type: application/json\r\n", busy()),
        (202, "Content-Type: application/json\r\n", recovery()),
    ])
    .await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let value = client
        .inferences()
        .with_options(RequestOptions {
            idempotency_key: Some("saved".into()),
            inference_retries: 1,
            ..Default::default()
        })
        .create(input())
        .await
        .unwrap();
    assert_eq!(value.run_id.to_string(), ID);
    assert!(value.result.is_none());
    for request in requests.await.unwrap() {
        assert!(request.to_lowercase().contains("idempotency-key: saved"));
    }
}
#[tokio::test]
async fn retry_hint_is_not_shortened_to_fit_timeout() {
    let (origin, requests) = server(vec![(
        503,
        "Content-Type: application/json\r\nRetry-After: 3600\r\n",
        busy(),
    )])
    .await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    assert!(client
        .inferences()
        .with_options(RequestOptions {
            inference_retries: 2,
            inference_timeout: Some(Duration::from_secs(1)),
            ..Default::default()
        })
        .create(input())
        .await
        .is_err());
    assert_eq!(requests.await.unwrap().len(), 1);
}
#[tokio::test]
async fn interrupted_stream_retains_accepted_run_and_urls() {
    let accepted = serde_json::json!({"schema_version":1,"run_id":ID,"type":"run.accepted","occurred_at":"2026-10-16T00:00:00Z","data":{"run_id":ID,"session_id":null,"worktree_id":null,"status":"running","delivery":"live","urls":urls()}});
    let (origin, requests) = server(vec![(
        200,
        "Content-Type: text/event-stream\r\nX-Request-Id: 01900000-0000-7000-8000-000000000001\r\n",
        format!("data: {}\n\n", accepted),
    )])
    .await;
    let client = Client::with_credentials(&origin, "fixture").unwrap();
    let mut events = 0;
    let error = client
        .inferences()
        .with_options(RequestOptions {
            idempotency_key: Some("saved".into()),
            ..Default::default()
        })
        .stream(input(), |_| {
            events += 1;
            true
        })
        .await
        .unwrap_err();
    let detail = error.downcast_ref::<RequestError>().unwrap();
    assert_eq!(detail.run_id.as_deref(), Some(ID));
    assert_eq!(detail.urls, Some(urls()));
    assert_eq!(detail.request_id.as_deref(), Some(ID));
    assert_eq!(events, 1);
    requests.await.unwrap();
}
