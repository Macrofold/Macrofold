package macrofold

import (
	"context"
	"io"
	"os"
	"strings"
	"testing"
)

func TestCustomerAgentPath(t *testing.T) {
	binding, run := os.Getenv("MACROFOLD_FIXTURE_CUSTOMER_AGENT"), os.Getenv("MACROFOLD_FIXTURE_CUSTOMER_RUN")
	if binding == "" {
		t.Skip("Run pnpm test:sdks for isolated application acceptance")
	}
	client, err := NewClient(WithBaseURL(os.Getenv("MACROFOLD_FIXTURE_ORIGIN")), WithAPIKey(os.Getenv("MACROFOLD_FIXTURE_KEY")))
	if err != nil {
		t.Fatal(err)
	}
	ctx, customer := context.Background(), "customer / 日本語"
	value, err := client.CustomerAgents.Get(ctx, customer, binding)
	if err != nil || value.IntegrationPath != "customer-agents" {
		t.Fatalf("binding: %v %v", value, err)
	}
	last := ""
	if err := client.CustomerAgents.StreamRun(ctx, customer, binding, run, "0", func(event Event) error { last = event.Type; return nil }); err != nil {
		t.Fatal(err)
	}
	if last != "run.succeeded" {
		t.Fatal(last)
	}
	file, err := client.CustomerAgents.ReadFile(ctx, customer, binding, &ReadCustomerAgentFileParams{Path: "notes/run-" + run + ".md"})
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(file.Name())
	defer file.Close()
	bytes, err := io.ReadAll(file)
	if err != nil || !strings.Contains(string(bytes), "optional customer-agent path") {
		t.Fatalf("file: %s %v", bytes, err)
	}
	if _, err := client.CustomerAgents.GetRun(ctx, "wrong customer", binding, run); err == nil {
		t.Fatal("cross-customer access succeeded")
	}
}
