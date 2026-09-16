use macrofold::{resources::ReadCustomerAgentFileParams, Client};

#[tokio::test]
async fn customer_path_stream_files_and_ownership() {
    let Ok(binding) = std::env::var("MACROFOLD_FIXTURE_CUSTOMER_AGENT") else {
        return;
    };
    let run = std::env::var("MACROFOLD_FIXTURE_CUSTOMER_RUN").unwrap();
    let client = Client::with_credentials(
        &std::env::var("MACROFOLD_FIXTURE_ORIGIN").unwrap(),
        &std::env::var("MACROFOLD_FIXTURE_KEY").unwrap(),
    )
    .unwrap();
    let api = client.customer_agents();
    let customer = "customer / 日本語";
    assert_eq!(
        api.get(customer, &binding).await.unwrap().customer_id,
        customer
    );
    let mut last = String::new();
    api.stream_run(customer, &binding, &run, "0", |event| {
        last = event.r#type;
        true
    })
    .await
    .unwrap();
    assert_eq!(last, "run.succeeded");
    let bytes = api
        .read_file(
            customer,
            &binding,
            ReadCustomerAgentFileParams {
                path: format!("notes/run-{}.md", run),
                download: None,
            },
        )
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert!(String::from_utf8(bytes.to_vec())
        .unwrap()
        .contains("optional customer-agent path"));
    assert!(api.get_run("wrong customer", &binding, &run).await.is_err());
}
