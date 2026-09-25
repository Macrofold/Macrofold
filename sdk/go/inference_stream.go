package macrofold

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// StreamInference posts once and yields transient events including the saved terminal
// result. Return an error or cancel ctx to detach without cancelling remote execution.
func (c *APIClient) StreamInference(ctx context.Context, input *InferenceCreate, receive func(InferenceStreamEvent) error, options ...RequestOption) error {
	if input == nil {
		return missingParameter("input")
	}
	settings, err := requestOptions(options, true)
	if err != nil {
		return err
	}
	value := *input
	value.SetStream(true)
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.Servers[0].URL+"/v1/inferences", bytes.NewReader(body))
	if err != nil {
		return err
	}
	for k, v := range c.cfg.DefaultHeader {
		req.Header.Set(k, v)
	}
	req.Header.Set("Idempotency-Key", settings.idempotencyKey)
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Content-Type", "application/json")
	if settings.organization != "" {
		req.Header.Set("X-Organization-Id", settings.organization)
	}
	// A direct request may run for 240 seconds; durable stream reconnect timeouts
	// must not truncate a single POST. The caller's context can narrow this.
	transport := *c.cfg.HTTPClient
	transport.Timeout = 300 * time.Second
	response, err := transport.Do(req)
	if err != nil {
		return requestError(err, response, settings.idempotencyKey)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 65536))
		return requestError(fmt.Errorf("inference stream HTTP %d: %s", response.StatusCode, data), response, settings.idempotencyKey)
	}
	if !strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
		return requestError(errors.New("expected an event stream"), response, settings.idempotencyKey)
	}
	terminal := false
	err = readSSE(response.Body, func(data []byte) error {
		var event InferenceStreamEvent
		if err := json.Unmarshal(data, &event); err != nil {
			return err
		}
		if err := receive(event); err != nil {
			return err
		}
		if event.Type == "transport.error" {
			return errors.New("stream interrupted; retrieve the saved run result")
		}
		terminal = event.Type == "run.succeeded" || event.Type == "run.failed" || event.Type == "run.cancelled" || event.Type == "run.timed_out"
		if terminal {
			return io.EOF
		}
		return nil
	})
	if terminal && err == io.EOF {
		return nil
	}
	if err == nil {
		err = errors.New("stream ended before terminal result; retrieve the saved run result")
	}
	return requestError(err, response, settings.idempotencyKey)
}
