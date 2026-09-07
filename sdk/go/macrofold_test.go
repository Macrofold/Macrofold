package macrofold

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

const testID = "00000000-0000-4000-8000-000000000001"

func event(sequence, kind string) string {
	return fmt.Sprintf(`{"id":%q,"schema_version":1,"run_id":%q,"sequence":%q,"type":%q,"occurred_at":"2026-09-07T00:00:00Z","ingested_at":"2026-09-07T00:00:00Z","data":{"text":"hello 🌍"}}`, testID, testID, sequence, kind)
}
func TestTypedRequestAndError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("missing credential")
		}
		if r.URL.Query().Get("limit") != "3" {
			t.Error("missing query")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"data":[],"next_cursor":null}`)
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "fixture")
	if err != nil {
		t.Fatal(err)
	}
	result, _, err := client.ProjectsAPI.ListProjects(context.Background()).Limit(3).Execute()
	if err != nil || len(result.Data) != 0 {
		t.Fatalf("unexpected response: %v %v", result, err)
	}
}
func TestStreamingRotationAndDuplicateSuppression(t *testing.T) {
	connections := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("missing credential")
		}
		if !strings.HasSuffix(r.URL.Path, "/stream") {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"id":%q,"organization_id":%q,"session_id":%q,"workspace_id":%q,"harness":"codex","model":"simulator","status":"running","created_at":"2026-09-07T00:00:00Z"}`, testID, testID, testID, testID)
			return
		}
		connections++
		w.Header().Set("Content-Type", "text/event-stream")
		if connections == 1 {
			if r.Header.Get("Last-Event-ID") != "0" {
				t.Error("initial cursor")
			}
			fmt.Fprintf(w, ": heartbeat\r\ndata: %s\r\n\r\n", event("1", "output.delta"))
		} else {
			if r.Header.Get("Last-Event-ID") != "1" || r.URL.Query().Get("after") != "1" {
				t.Error("resume cursor")
			}
			fmt.Fprintf(w, "data: %s\n\ndata: %s\n\n", event("1", "output.delta"), event("2", "run.succeeded"))
		}
	}))
	defer server.Close()
	client, _ := NewClient(server.URL, "fixture")
	var sequences []string
	err := client.Stream(context.Background(), testID, "0", func(e Event) error {
		sequences = append(sequences, e.Sequence)
		if e.Data["text"] != "hello 🌍" {
			t.Error("UTF-8 lost")
		}
		return nil
	})
	if err != nil || strings.Join(sequences, ",") != "1,2" || connections != 2 {
		t.Fatalf("%v %v %d", err, sequences, connections)
	}
}
func TestStreamDenialAndCancellation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(403) }))
	defer server.Close()
	client, _ := NewClient(server.URL, "fixture")
	if err := client.Stream(context.Background(), testID, "0", func(Event) error { t.Fatal("unexpected event"); return nil }); err == nil || calls != 1 {
		t.Fatalf("expected single denial: %v %d", err, calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := client.Stream(ctx, testID, "0", func(Event) error { return nil }); err != context.Canceled || calls != 1 {
		t.Fatalf("cancellation: %v", err)
	}
}
func TestOriginAndRedirectBoundaries(t *testing.T) {
	for _, origin := range []string{"http://example.com", "https://user:secret@example.com", "https://example.com/path", "https://example.com?key=secret"} {
		if _, err := NewClient(origin, "fixture"); err == nil {
			t.Errorf("accepted %s", origin)
		}
	}
	reached := false
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	defer other.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, other.URL, 302) }))
	defer server.Close()
	client, _ := NewClient(server.URL, "fixture")
	_, response, err := client.ProjectsAPI.ListProjects(context.Background()).Execute()
	if err == nil || reached || response.StatusCode != 302 {
		t.Fatal("redirect must be refused")
	}
}
func TestFinancialStringsAndOversizedFrame(t *testing.T) {
	limits := NewLimits()
	limits.SetTimeoutSeconds(300)
	limits.SetMaxCostMicroUsd("9007199254740993")
	body := RunCreate{Prompt: "test", Limits: limits}
	encoded, err := json.Marshal(body)
	if err != nil || !strings.Contains(string(encoded), `"max_cost_micro_usd":"9007199254740993"`) {
		t.Fatalf("precision lost: %s %v", encoded, err)
	}
	if err := readEvents(strings.NewReader("data: "+strings.Repeat("x", 4*1024*1024)), func(Event) error { return nil }); err == nil {
		t.Fatal("unbounded frame accepted")
	}
}

func TestMutationAndBinaryWireContract(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		body, _ := io.ReadAll(r.Body)
		if r.Header.Get("Idempotency-Key") != "request-1" {
			t.Error("lost idempotency")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "POST" {
			if r.Header.Get("Content-Type") != "application/json" || !strings.Contains(string(body), `"name":"Research"`) {
				t.Errorf("JSON body: %s", body)
			}
			fmt.Fprintf(w, `{"id":%q,"organization_id":%q,"name":"Research","persistence":"persistent","created_at":"2026-09-07T00:00:00Z"}`, testID, testID)
		} else {
			if r.Header.Get("Content-Type") != "application/octet-stream" || string(body) != "hello\x00world" || r.URL.Query().Get("path") != "notes/a + b.bin" || r.Header.Get("If-Match") != "revision-1" {
				t.Errorf("binary contract: %q %v", body, r.Header)
			}
			fmt.Fprintf(w, `{"id":%q,"kind":"file.write","status":"succeeded","created_at":"2026-09-07T00:00:00Z","result":{"revision":"revision-2"}}`, testID)
		}
	}))
	defer server.Close()
	client, _ := NewClient(server.URL, "fixture")
	project, _, err := client.ProjectsAPI.CreateProject(context.Background()).IdempotencyKey("request-1").ProjectCreate(*NewProjectCreate("Research")).Execute()
	if err != nil || project.Name != "Research" {
		t.Fatalf("project: %v %v", project, err)
	}
	file, err := os.CreateTemp(t.TempDir(), "upload")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	file.WriteString("hello\x00world")
	file.Seek(0, 0)
	operation, _, err := client.WorkspacesAPI.WriteFile(context.Background(), testID).Path("notes/a + b.bin").IfMatch("revision-1").IdempotencyKey("request-1").Body(file).Execute()
	if err != nil || operation.Status != "succeeded" || calls != 2 {
		t.Fatalf("operation: %v %v", operation, err)
	}
}

func TestApplicationWorkflow(t *testing.T) {
	origin := os.Getenv("MACROFOLD_FIXTURE_ORIGIN")
	if origin == "" {
		t.Skip("Run pnpm test:sdks for isolated application acceptance")
	}
	client, err := NewClient(origin, os.Getenv("MACROFOLD_FIXTURE_KEY"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	project, _, err := client.ProjectsAPI.CreateProject(ctx).IdempotencyKey("go-project").ProjectCreate(*NewProjectCreate("Go application fixture")).Execute()
	if err != nil {
		t.Fatal(err)
	}
	runBody := NewRunCreate("Verify Go persisted execution.")
	runBody.SetProjectId(project.Id)
	runBody.SetHarness("codex")
	runBody.SetModel("fixture-model")
	runBody.SetBillingMode("managed")
	run, _, err := client.RunsAPI.CreateRun(ctx).IdempotencyKey("go-run-fixture").RunCreate(*runBody).Execute()
	if err != nil {
		t.Fatal(err)
	}
	var terminal string
	err = client.Stream(ctx, run.RunId, "0", func(event Event) error { terminal = event.Type; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if terminal != "run.succeeded" {
		t.Fatalf("terminal: %s", terminal)
	}
	result, _, err := client.RunsAPI.GetRunResult(ctx, run.RunId).Execute()
	if err != nil {
		t.Fatal(err)
	}
	if !result.Final || !strings.Contains(result.GetOutputText(), "Simulation completed") {
		t.Fatal("missing persisted result")
	}
}
