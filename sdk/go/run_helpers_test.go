package macrofold

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func finalResult(persistence, outcome string) string {
	return fmt.Sprintf(`{"run_id":%q,"final":true,"output_text":"Hello 🌍","execution_outcome":%q,"persistence_status":%q,"checkpoint_id":%q}`, testID, outcome, persistence, testID)
}
func helperState(status string) string {
	return fmt.Sprintf(`{"id":%q,"organization_id":%q,"session_id":%q,"workspace_id":%q,"harness":"codex","model":"fixture","status":%q,"failure_code":"fixture_failure","created_at":"2026-09-07T00:00:00Z"}`, testID, testID, testID, testID, status)
}

func TestTextFiltersReplayAndPreservesOrganization(t *testing.T) {
	streams, gets := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.Header.Get("X-Organization-Id") != testID {
			t.Error("read-only organization scope lost")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/stream"):
			streams++
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, "data: %s\n\ndata: %s\n\n", event("1", "output.delta"), event("2", "tool.completed"))
			if streams > 1 {
				if r.Header.Get("Last-Event-ID") != "2" {
					t.Error("cursor lost")
				}
				fmt.Fprintf(w, "data: %s\n\ndata: %s\n\n", event("3", "reasoning.delta"), event("4", "run.succeeded"))
			}
		case strings.HasSuffix(r.URL.Path, "/result"):
			fmt.Fprint(w, finalResult("verified", "success"))
		default:
			gets++
			status := "running"
			if gets > 1 {
				status = "succeeded"
			}
			fmt.Fprint(w, helperState(status))
		}
	}))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	var text []string
	err := client.Runs.StreamText(context.Background(), testID, "0", func(part string) error { text = append(text, part); return nil }, WithRequestOrganization(testID))
	if err != nil || strings.Join(text, "") != "hello 🌍" || len(text) != 1 || streams != 2 {
		t.Fatalf("text/replay: %v %v", text, err)
	}
}

func TestTextAfterTerminalAndWaitFailure(t *testing.T) {
	for _, status := range []string{"failed", "cancelled", "timed_out", "succeeded"} {
		t.Run(status, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("unexpected mutation")
				}
				w.Header().Set("Content-Type", "application/json")
				switch {
				case strings.HasSuffix(r.URL.Path, "/stream"):
					return
				case strings.HasSuffix(r.URL.Path, "/events"):
					fmt.Fprint(w, `{"data":[],"next_cursor":null}`)
				case strings.HasSuffix(r.URL.Path, "/result"):
					persistence, outcome := "verified", status
					if status == "succeeded" {
						persistence, outcome = "failed", "success"
					}
					fmt.Fprint(w, finalResult(persistence, outcome))
				default:
					fmt.Fprint(w, helperState(status))
				}
			}))
			defer server.Close()
			client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
			err := client.Runs.StreamText(context.Background(), testID, "99", func(string) error { t.Fatal("unexpected text"); return nil })
			var failure *RunFailedError
			if !errors.As(err, &failure) || failure.RunID != testID || failure.Status != status || failure.FailureCode != "fixture_failure" {
				t.Fatalf("typed failure: %v", err)
			}
		})
	}
}

func TestWaitPersistenceAndDetachment(t *testing.T) {
	gets, results := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("unexpected cancellation")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(r.URL.Path, "/stream"):
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(w, "data: %s\n\n", event("1", "output.delta"))
		case strings.HasSuffix(r.URL.Path, "/result"):
			results++
			persistence := "pending"
			if results > 1 {
				persistence = "verified"
			}
			fmt.Fprint(w, finalResult(persistence, "success"))
		default:
			gets++
			status := "persisting"
			if gets > 1 {
				status = "succeeded"
			}
			fmt.Fprint(w, helperState(status))
		}
	}))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	detached := errors.New("detached")
	if err := client.Runs.StreamText(context.Background(), testID, "0", func(string) error { return detached }); err != detached {
		t.Fatalf("detach: %v", err)
	}
	if gets != 0 || results != 0 {
		t.Fatal("detach performed completion reads")
	}
	value, err := client.Runs.Wait(context.Background(), testID)
	if err != nil || value.GetCheckpointId() != testID || gets != 3 || results != 2 {
		t.Fatalf("persistence: %v %v", value, err)
	}
}

func TestWaitTimeoutAbortsInflightWithoutCancelling(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" {
			t.Error("unexpected cancellation")
		}
		<-r.Context().Done()
	}))
	defer server.Close()
	client, _ := NewClient(WithBaseURL(server.URL), WithAPIKey("fixture"))
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_, err := client.Runs.Wait(ctx, testID)
	var failure *WaitTimeoutError
	if !errors.As(err, &failure) || failure.RunID != testID || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout: %v", err)
	}
	if calls != 1 {
		t.Fatalf("unexpected requests: %d", calls)
	}
}
