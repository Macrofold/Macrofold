package macrofold

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
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
	ctx, cancel := context.WithTimeout(ctx, settings.inferenceTimeout)
	defer cancel()
	response, err := c.openInference(ctx, body, true, settings)
	if err != nil {
		return err
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
	var runID string
	var urls map[string]string
	err = readSSE(response.Body, func(data []byte) error {
		var metadata struct {
			RunID string `json:"run_id"`
			Data  struct {
				URLs map[string]string `json:"urls"`
			} `json:"data"`
		}
		if json.Unmarshal(data, &metadata) == nil {
			runID = metadata.RunID
			if metadata.Data.URLs != nil {
				urls = metadata.Data.URLs
			}
		}
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
	wrapped := requestError(err, response, settings.idempotencyKey).(*RequestError)
	if runID != "" {
		wrapped.RunID = runID
	}
	wrapped.URLs = urls
	return wrapped
}
