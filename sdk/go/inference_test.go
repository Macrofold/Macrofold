package macrofold

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestImmediateInferenceApplication(t *testing.T) {
	origin := os.Getenv("MACROFOLD_FIXTURE_ORIGIN")
	if origin == "" {
		t.Skip("Run pnpm test:sdks for isolated application acceptance")
	}
	bytes, err := os.ReadFile(os.Getenv("MACROFOLD_FIXTURE_INFERENCE_INPUT"))
	if err != nil {
		t.Fatal(err)
	}
	var input InferenceCreate
	if err = json.Unmarshal(bytes, &input); err != nil {
		t.Fatal(err)
	}
	client, err := NewClient(WithBaseURL(origin), WithAPIKey(os.Getenv("MACROFOLD_FIXTURE_KEY")))
	if err != nil {
		t.Fatal(err)
	}
	deploymentID := os.Getenv("MACROFOLD_FIXTURE_DEPLOYMENT")
	deployment, err := client.ModelDeployments.Get(context.Background(), deploymentID, nil)
	if err != nil || deployment.State != "stopped" || deployment.ServingRevisionId.Get() != nil || deployment.InfrastructureCost.EstimatedMicroUsd.Get() != nil || deployment.CostPolicy.RequestChargeMicroUsd != "0" {
		t.Fatalf("invalid stopped deployment projection: %#v %v", deployment, err)
	}
	selected, err := client.ModelDeployments.GetRevision(context.Background(), deploymentID, os.Getenv("MACROFOLD_FIXTURE_DEPLOYMENT_REVISION"), nil)
	if err != nil || selected.Source.ModelDeploymentExternalSource == nil || selected.Hosting.ModelDeploymentHostingOneOf1 == nil {
		t.Fatalf("invalid external revision: %#v %v", selected, err)
	}
	grants, err := client.ModelDeployments.ListGrants(context.Background(), deploymentID, nil)
	if err != nil || len(grants.Data) != 1 {
		t.Fatalf("invalid application grants: %#v %v", grants, err)
	}
	stoppedBytes, err := os.ReadFile(os.Getenv("MACROFOLD_FIXTURE_DEPLOYMENT_INFERENCE_INPUT"))
	if err != nil {
		t.Fatal(err)
	}
	var stoppedInput InferenceCreate
	if err = json.Unmarshal(stoppedBytes, &stoppedInput); err != nil {
		t.Fatal(err)
	}
	_, err = client.Inferences.Create(context.Background(), &stoppedInput)
	var stopped *RequestError
	if !errors.As(err, &stopped) || stopped.Response == nil || stopped.Response.StatusCode != 409 || stopped.Code != "deployment_not_ready" {
		t.Fatalf("stopped deployment must reject without dispatch: %v", err)
	}
	readyID := os.Getenv("MACROFOLD_FIXTURE_READY_DEPLOYMENT_GO")
	readyRevision := os.Getenv("MACROFOLD_FIXTURE_READY_DEPLOYMENT_REVISION_GO")
	readyBytes, err := os.ReadFile(os.Getenv("MACROFOLD_FIXTURE_READY_DEPLOYMENT_INPUT_GO"))
	if err != nil {
		t.Fatal(err)
	}
	var readyInput InferenceCreate
	if err = json.Unmarshal(readyBytes, &readyInput); err != nil {
		t.Fatal(err)
	}
	deployedReceipt := func(result *RunResult, nativeExtra bool) {
		t.Helper()
		if result == nil || !result.Final || result.Inference == nil {
			t.Fatal("missing deployment receipt")
		}
		value := result.Inference
		if value.Outcome != "value" || value.Deployment == nil || value.Deployment.DeploymentId != readyID || value.Deployment.DeploymentRevisionId != readyRevision || value.CostAttribution == nil || value.CostAttribution.Basis != "deployment" || value.CostAttribution.InfrastructureCostIncluded {
			t.Fatalf("incorrect deployment attribution: %#v", value)
		}
		if value.Billing.BillingMode != "byok" || value.Billing.GetChargedMicroUsd() != "0" || value.Billing.GetBudgetCostMicroUsd() != "0" || value.Billing.GetReportedMicroUsd() != "0" || value.Billing.ProviderCostMicroUsd.Get() != nil || value.Billing.ProviderReportedCostUsd.Get() != nil || value.Billing.UpstreamInferenceCostUsd.Get() != nil {
			t.Fatalf("incorrect deployment fees: %#v", value.Billing)
		}
		if value.Usage.GetInputTokens() != "11" || value.Usage.GetOutputTokens() != "4" {
			t.Fatalf("incorrect deployment usage: %#v", value.Usage)
		}
		encoded, err := json.Marshal(value.Value)
		if err != nil {
			t.Fatal(err)
		}
		var native struct {
			ProviderNativeExtra map[string]bool `json:"provider_native_extra"`
			Choices             []struct {
				Message struct {
					Content     string   `json:"content"`
					Annotations []string `json:"annotations"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err = json.Unmarshal(encoded, &native); err != nil {
			t.Fatal(err)
		}
		if len(native.Choices) != 1 || native.Choices[0].Message.Content != "Hello from the deployment SDK fixture." || (nativeExtra && (!native.ProviderNativeExtra["retained"] || native.Choices[0].Message.Annotations == nil)) {
			t.Fatalf("native response fields were lost: %s", encoded)
		}
	}
	readyOptions := []RequestOption{WithIdempotencyKey(fmt.Sprintf("go-deployment-%d", time.Now().UnixNano()))}
	readyResponse, err := client.Inferences.Create(context.Background(), &readyInput, readyOptions...)
	if err != nil {
		t.Fatalf("deployment did not complete: %#v %v", readyResponse, err)
	}
	readyResult := readyResponse.Result
	if readyResponse.Status == "running" {
		readyResult, err = client.Runs.Wait(context.Background(), readyResponse.RunId)
		if err != nil {
			t.Fatal(err)
		}
	}
	deployedReceipt(readyResult, true)
	deployedText, deployedTerminal := "", false
	err = client.Inferences.Stream(context.Background(), &readyInput, func(event InferenceStreamEvent) error {
		if event.Type == "output.delta" && event.Data.Text != nil {
			deployedText += *event.Data.Text
		}
		if event.Type == "run.succeeded" {
			deployedReceipt(event.Data.Result, false)
			deployedTerminal = true
		}
		return nil
	})
	if err != nil || deployedText != "Hello from the deployment SDK fixture." || !deployedTerminal {
		t.Fatalf("deployment stream failed: %q %v", deployedText, err)
	}
	servicePolicy := ModelDeploymentServicePolicyOneOf1AsModelDeploymentServicePolicy(NewModelDeploymentServicePolicyOneOf1(2))
	_, err = client.ModelDeployments.SetService(context.Background(), readyID, NewModelDeploymentServiceInput(readyRevision, "stopped", servicePolicy))
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := client.Inferences.Create(context.Background(), &readyInput, readyOptions...)
	if err != nil || recovered.RunId != readyResponse.RunId {
		t.Fatalf("deployment replay after stop failed: %#v %v", recovered, err)
	}
	deployedReceipt(recovered.Result, true)
	receipt := func(result *RunResult) {
		t.Helper()
		if result == nil || !result.Final || result.PersistenceStatus != "not_required" || result.Inference == nil {
			t.Fatalf("missing finalized receipt: %#v", result)
		}
		value := result.Inference
		if value.Outcome != "value" || value.Usage.GetInputTokens() != "100" || value.Usage.GetOutputTokens() != "10" || value.Usage.Completeness != "complete" || value.Billing.BillingMode != "managed" || value.Billing.Provisional || value.Billing.GetChargedMicroUsd() == "" || value.Billing.GetChargedMicroUsd() == "0" {
			t.Fatalf("incorrect receipt: %#v", value)
		}
	}
	options := []RequestOption{WithIdempotencyKey(fmt.Sprintf("go-immediate-%d", time.Now().UnixNano()))}
	response, err := client.Inferences.Create(context.Background(), &input, options...)
	if err != nil {
		t.Fatal(err)
	}
	if response.Status != "succeeded" {
		t.Fatalf("not terminal: %#v", response)
	}
	receipt(response.Result)
	replay, err := client.Inferences.Create(context.Background(), &input, options...)
	if err != nil || replay.RunId != response.RunId {
		t.Fatalf("invalid replay: %#v %v", replay, err)
	}
	text, terminal := "", false
	err = client.Inferences.Stream(context.Background(), &input, func(event InferenceStreamEvent) error {
		if event.Type == "output.delta" && event.Data.Text != nil {
			text += *event.Data.Text
		}
		if event.Type == "run.succeeded" {
			receipt(event.Data.Result)
			terminal = true
		}
		return nil
	})
	if err != nil || text != "Hello from the SDK fixture." || !terminal {
		t.Fatalf("stream failed: %q %v %v", text, terminal, err)
	}
	rejectedInput := input
	rejectedInput.Input = map[string]interface{}{"messages": []map[string]string{{"role": "user", "content": "sdk-provider-error"}}}
	rejectedReceipt := func(result *RunResult) {
		t.Helper()
		if result == nil || result.ExecutionOutcome != "failure" || result.Inference == nil || result.Inference.GetReasonCode() == "" {
			t.Fatalf("missing failed receipt: %#v", result)
		}
		value := result.Inference.ProviderError
		if value == nil || value.HttpStatus != 402 || value.Message != "SDK provider spending limit reached." || value.GetCode() != "insufficient_quota" || value.HasTruncated() {
			t.Fatalf("incorrect upstream diagnostic: %#v", value)
		}
	}
	rejected, err := client.Inferences.Create(context.Background(), &rejectedInput)
	if err != nil || rejected.Status != "failed" {
		t.Fatalf("provider failure not terminal: %#v %v", rejected, err)
	}
	rejectedReceipt(rejected.Result)
	failed := false
	err = client.Inferences.Stream(context.Background(), &rejectedInput, func(event InferenceStreamEvent) error {
		if event.Type == "run.failed" {
			rejectedReceipt(event.Data.Result)
			failed = true
		}
		return nil
	})
	if err != nil || !failed {
		t.Fatalf("failed stream diagnostic missing: %v", err)
	}
}

const inferenceID = "01900000-0000-7000-8000-000000000001"
const inferenceURLs = `{"status":"http://example.test/status","result":"http://example.test/result","events":"http://example.test/events","stream":"http://example.test/stream","cancel":"http://example.test/cancel"}`
const inferenceRecovery = `{"run_id":"` + inferenceID + `","session_id":null,"worktree_id":null,"status":"running","recovery_reason":"finalization_pending","urls":` + inferenceURLs + `}`
const inferenceBusy = `{"error":{"code":"inference_service_unavailable","message":"Busy","retryable":true,"request_id":"` + inferenceID + `","details":{"reason":"local_capacity"}}}`

func inferenceInput() *InferenceCreate {
	input := NewInferenceCreate(map[string]interface{}{}, DecisionBindingAsInferenceBinding(NewDecisionBinding("openrouter", "fixture", "managed")))
	input.SetLimits(*NewInferenceLimits("1000", 10, 10))
	return input
}

func TestImmediateInferenceDefaultAndExplicitRetry(t *testing.T) {
	for _, retries := range []int{0, 1} {
		t.Run(fmt.Sprint(retries), func(t *testing.T) {
			keys := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				keys = append(keys, r.Header.Get("Idempotency-Key"))
				w.Header().Set("Content-Type", "application/json")
				if len(keys) == 1 {
					if retries == 0 {
						w.Header().Set("X-Run-Id", inferenceID)
					}
					w.WriteHeader(503)
					fmt.Fprint(w, inferenceBusy)
				} else {
					w.WriteHeader(202)
					fmt.Fprint(w, inferenceRecovery)
				}
			}))
			defer server.Close()
			client, err := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
			if err != nil {
				t.Fatal(err)
			}
			result, err := client.Inferences.Create(context.Background(), inferenceInput(), WithIdempotencyKey("saved-key"), WithInferenceRetries(retries))
			if retries == 0 {
				var failure *RequestError
				if !errors.As(err, &failure) || failure.IdempotencyKey != "saved-key" || failure.RunID != inferenceID {
					t.Fatalf("missing identity: %v", err)
				}
			} else if err != nil || result.GetRecoveryReason() != "finalization_pending" {
				t.Fatalf("unexpected recovery: %v %v", result, err)
			}
			if len(keys) != retries+1 {
				t.Fatalf("attempts: %v", keys)
			}
			for _, key := range keys {
				if key != "saved-key" {
					t.Fatal(keys)
				}
			}
		})
	}
}
func TestImmediateInferenceHonorsFullRetryHintWithinDeadline(t *testing.T) {
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		w.Header().Set("Retry-After", time.Now().Add(time.Hour).UTC().Format(http.TimeFormat))
		w.WriteHeader(503)
		fmt.Fprint(w, inferenceBusy)
	}))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	_, err := client.Inferences.Create(context.Background(), inferenceInput(), WithInferenceRetries(2), WithInferenceTimeout(time.Second))
	if err == nil || count != 1 {
		t.Fatalf("hint shortened/retried: %v %d", err, count)
	}
}
func TestImmediateInferenceDoesNotRetryAmbiguousFailure(t *testing.T) {
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		connection, _, _ := w.(http.Hijacker).Hijack()
		connection.Close()
	}))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	_, err := client.Inferences.Create(context.Background(), inferenceInput(), WithIdempotencyKey("saved"), WithInferenceRetries(2))
	var failure *RequestError
	if count != 1 || !errors.As(err, &failure) || failure.IdempotencyKey != "saved" {
		t.Fatalf("ambiguous retry/identity: %d %v", count, err)
	}
}
func TestImmediateInferenceInterruptedStreamKeepsReceipt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("X-Request-Id", inferenceID)
		fmt.Fprintf(w, "data: {\"schema_version\":1,\"run_id\":\"%s\",\"type\":\"run.accepted\",\"occurred_at\":\"2026-10-16T00:00:00Z\",\"data\":{\"run_id\":\"%s\",\"session_id\":null,\"worktree_id\":null,\"status\":\"running\",\"urls\":%s,\"delivery\":\"live\"}}\n\n", inferenceID, inferenceID, inferenceURLs)
	}))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	events := 0
	err := client.Inferences.Stream(context.Background(), inferenceInput(), func(event InferenceStreamEvent) error { events++; return nil }, WithIdempotencyKey("saved"))
	var failure *RequestError
	if !errors.As(err, &failure) || failure.RunID != inferenceID || failure.RequestID != inferenceID || failure.URLs["result"] == "" || events != 1 {
		t.Fatalf("missing receipt: %#v %d", err, events)
	}
}
