package macrofold

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

const testID = "00000000-0000-4000-8000-000000000001"

func TestConstructorAndResourceFailure(t *testing.T) {
	t.Setenv("MACROFOLD_API_KEY", "environment-fixture")
	client, err := NewClient()
	if err != nil || client.GetConfig().Servers[0].URL != DefaultOrigin {
		t.Fatalf("default origin: %v", err)
	}
	if _, err := NewClient(WithAPIKey("")); err == nil {
		t.Fatal("explicit empty key accepted")
	}
	calls := 0
	var identity string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer environment-fixture" {
			t.Error("environment authentication missing")
		}
		identity = r.Header.Get("Idempotency-Key")
		if identity == "" {
			t.Error("automatic mutation identity missing")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(503)
		fmt.Fprint(w, `{"error":{"code":"unavailable","message":"retry later"}}`)
	}))
	defer server.Close()
	client, err = NewClient(WithBaseURL(server.URL))
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Projects.Create(context.Background(), NewProjectCreate("Research"))
	var failure *RequestError
	if !errors.As(err, &failure) || failure.Response.StatusCode != 503 || failure.IdempotencyKey != identity || calls != 1 {
		t.Fatalf("single-attempt error and identity: %v", err)
	}
	t.Setenv("MACROFOLD_API_KEY", "")
	if _, err := NewClient(); err == nil || !strings.Contains(err.Error(), "MACROFOLD_API_KEY") {
		t.Fatal("missing key must be clear")
	}
}

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
	client, err := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	if err != nil {
		t.Fatal(err)
	}
	limit := int32(3)
	result, err := client.Projects.List(context.Background(), &ListProjectsParams{Limit: &limit})
	if err != nil || len(result.Data) != 0 {
		t.Fatalf("unexpected response: %v %v", result, err)
	}
}
func TestStreamingRotationAndDuplicateSuppression(t *testing.T) {
	connections := 0
	historyChecks := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("missing credential")
		}
		if r.Header.Get("X-Organization-Id") != testID {
			t.Error("lost stream organization")
		}
		if strings.HasSuffix(r.URL.Path, "/events") {
			historyChecks++
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"data":[%s],"next_cursor":null}`, event("2", "run.succeeded"))
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/stream") {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"id":%q,"organization_id":%q,"session_id":%q,"workspace_id":%q,"harness":"codex","model":"simulator","status":"succeeded","created_at":"2026-09-07T00:00:00Z"}`, testID, testID, testID, testID)
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
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	var sequences []string
	err := client.Runs.Stream(context.Background(), testID, "0", func(e Event) error {
		sequences = append(sequences, e.Sequence)
		if e.Data["text"] != "hello 🌍" {
			t.Error("UTF-8 lost")
		}
		return nil
	}, WithRequestOrganization(testID))
	if err != nil || strings.Join(sequences, ",") != "1,2" || connections != 2 || historyChecks != 1 {
		t.Fatalf("%v %v %d", err, sequences, connections)
	}
	if client.GetConfig().DefaultHeader["X-Organization-Id"] != "" {
		t.Error("per-request organization leaked into client configuration")
	}
}
func TestStreamDenialAndCancellation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(403) }))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	if err := client.Runs.Stream(context.Background(), testID, "0", func(Event) error { t.Fatal("unexpected event"); return nil }); err == nil || calls != 1 {
		t.Fatalf("expected single denial: %v %d", err, calls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := client.Runs.Stream(ctx, testID, "0", func(Event) error { return nil }); err != context.Canceled || calls != 1 {
		t.Fatalf("cancellation: %v", err)
	}
}
func TestOriginAndRedirectBoundaries(t *testing.T) {
	for _, origin := range []string{"http://example.com", "https://user:secret@example.com", "https://example.com/path", "https://example.com?key=secret"} {
		if _, err := NewClient(WithBaseURL(origin), WithAPIKey("fixture")); err == nil {
			t.Errorf("accepted %s", origin)
		}
	}
	reached := false
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached = true }))
	defer other.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, other.URL, 302) }))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
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
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	project, err := client.Projects.Create(context.Background(), NewProjectCreate("Research"), WithIdempotencyKey("request-1"))
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
	operation, err := client.Workspaces.WriteFile(context.Background(), testID, file, &WriteFileParams{Path: "notes/a + b.bin", IfMatch: "revision-1"}, WithIdempotencyKey("request-1"))
	if err != nil || operation.Status != "succeeded" || calls != 2 {
		t.Fatalf("operation: %v %v", operation, err)
	}
}

func TestApplicationWorkflow(t *testing.T) {
	origin := os.Getenv("MACROFOLD_FIXTURE_ORIGIN")
	if origin == "" {
		t.Skip("Run pnpm test:sdks for isolated application acceptance")
	}
	client, err := NewClient(WithBaseURL(origin), WithAPIKey(os.Getenv("MACROFOLD_FIXTURE_KEY")))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	filesWorkspace := os.Getenv("MACROFOLD_FIXTURE_FILES_WORKSPACE")
	for filePath, expected := range map[string]string{"notes/日本語 + #?.bin": string([]byte{0, 255, 10, 128}), "empty.txt": ""} {
		file, err := client.Workspaces.ReadFile(ctx, filesWorkspace, &ReadFileParams{Path: filePath})
		if err != nil || file == nil {
			t.Fatalf("read %s: %v", filePath, err)
		}
		content, readErr := io.ReadAll(file)
		file.Close()
		os.Remove(file.Name())
		if readErr != nil || string(content) != expected {
			t.Fatalf("read %s: %x %v", filePath, content, readErr)
		}
	}
	_, err = client.Workspaces.ReadFile(ctx, filesWorkspace, &ReadFileParams{Path: "missing.txt"})
	var missing *RequestError
	if !errors.As(err, &missing) || missing.Response == nil || missing.Response.StatusCode != 404 {
		t.Fatalf("missing file: %v", err)
	}
	project, err := client.Projects.Create(ctx, NewProjectCreate("Go application fixture"))
	if err != nil {
		t.Fatal(err)
	}
	runBody := NewRunCreate("Verify Go persisted execution.")
	agent, err := client.Agents.Create(ctx, NewAgentCreate("Go preset", "codex", "fixture-model", "managed"))
	if err != nil {
		t.Fatal(err)
	}
	runBody.SetProjectId(project.Id)
	runBody.SetAgentId(agent.Id)
	run, err := client.Runs.Create(ctx, runBody)
	if err != nil {
		t.Fatal(err)
	}
	var text string
	err = client.Runs.StreamText(ctx, run.RunId, "0", func(part string) error { text += part; return nil })
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Runs.Wait(ctx, run.RunId)
	if err != nil {
		t.Fatal(err)
	}
	if text != result.GetOutputText() || result.PersistenceStatus != "verified" {
		t.Fatal("text/persistence mismatch")
	}
	state, err := client.Runs.Get(ctx, run.RunId)
	if err != nil || state.Status != "succeeded" {
		t.Fatalf("state: %v %v", state, err)
	}
	checkpoints, err := client.Workspaces.ListCheckpoints(ctx, run.WorkspaceId, nil)
	if err != nil || len(checkpoints.Data) == 0 {
		t.Fatalf("checkpoints: %v %v", checkpoints, err)
	}
	note, err := client.Workspaces.ReadFile(ctx, run.WorkspaceId, &ReadFileParams{Path: "notes/run-" + run.RunId + ".md"})
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(note.Name())
	defer note.Close()
	content, err := io.ReadAll(note)
	if err != nil || !strings.Contains(string(content), "Verify Go persisted execution") {
		t.Fatalf("persisted file: %v", err)
	}
	if !result.Final || !strings.Contains(result.GetOutputText(), "Simulation completed") {
		t.Fatal("missing persisted result")
	}
}

func TestReadFileBytesAndErrors(t *testing.T) {
	for _, fixture := range []struct {
		name    string
		content []byte
	}{
		{"empty", []byte{}},
		{"binary", []byte{0, 255, 10}},
		{"JSON text", []byte("{\"text\":\"Hello 🌍\"}\n")},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			content := fixture.content
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" || r.URL.Path != "/v1/workspaces/"+testID+"/file" || r.Header.Get("Authorization") != "Bearer fixture" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				if r.URL.Query().Get("path") == "missing.txt" {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(404)
					fmt.Fprint(w, `{"error":{"code":"not_found","message":"File not found."}}`)
					return
				}
				if r.URL.Query().Get("path") != "notes/日本語 + #?.bin" {
					t.Error("path was not preserved")
				}
				w.Header().Set("Content-Type", "application/octet-stream")
				w.Write(content)
			}))
			defer server.Close()
			client, err := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
			if err != nil {
				t.Fatal(err)
			}
			file, err := client.Workspaces.ReadFile(context.Background(), testID, &ReadFileParams{Path: "notes/日本語 + #?.bin"})
			if err != nil || file == nil {
				t.Fatalf("file: %v, error: %v", file, err)
			}
			defer os.Remove(file.Name())
			defer file.Close()
			got, err := io.ReadAll(file)
			if err != nil || string(got) != string(content) {
				t.Fatalf("bytes: %x, error: %v", got, err)
			}
			_, err = client.Workspaces.ReadFile(context.Background(), testID, &ReadFileParams{Path: "missing.txt"})
			var failure *RequestError
			if !errors.As(err, &failure) || failure.Response == nil || failure.Response.StatusCode != 404 {
				t.Fatalf("missing file: %v", err)
			}
		})
	}
}
