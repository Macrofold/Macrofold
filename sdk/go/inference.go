package macrofold

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"
)

// A retry is safe only when the service confirms that admission rolled back.
func confirmedInferenceRefusal(data []byte) bool {
	var payload struct {
		Error struct {
			Code      string `json:"code"`
			Retryable bool   `json:"retryable"`
			Details   struct {
				RunID string `json:"run_id"`
			} `json:"details"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &payload) != nil || !payload.Error.Retryable || payload.Error.Details.RunID != "" {
		return false
	}
	switch payload.Error.Code {
	case "rate_limited", "inference_capacity_unavailable", "streaming_capacity_unavailable", "inference_service_unavailable", "inference_admission_timeout", "inference_host_budget_exhausted":
		return true
	}
	return false
}

func inferenceRetryWait(hint string, attempt int) time.Duration {
	wait := time.Duration(200*(1<<attempt)) * time.Millisecond
	maximum := time.Duration(1<<63 - 1)
	if seconds, err := strconv.ParseFloat(hint, 64); err == nil && seconds >= 0 {
		if seconds >= float64(maximum)/float64(time.Second) {
			return maximum
		}
		if value := time.Duration(seconds * float64(time.Second)); value > wait {
			wait = value
		}
	} else if date, err := http.ParseTime(hint); err == nil && time.Until(date) > wait {
		wait = time.Until(date)
	}
	if wait > maximum-100*time.Millisecond {
		return maximum
	}
	return wait + time.Duration(rand.IntN(100)+1)*time.Millisecond
}

func (c *APIClient) openInference(ctx context.Context, body []byte, stream bool, settings requestSettings) (*http.Response, error) {
	transport := *c.cfg.HTTPClient
	transport.Timeout = 0 // The one context deadline covers headers, body and every explicit retry.
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.Servers[0].URL+"/v1/inferences", bytes.NewReader(body))
		if err != nil {
			return nil, requestError(err, nil, settings.idempotencyKey)
		}
		for k, v := range c.cfg.DefaultHeader {
			req.Header.Set(k, v)
		}
		req.Header.Set("Idempotency-Key", settings.idempotencyKey)
		req.Header.Set("Content-Type", "application/json")
		if stream {
			req.Header.Set("Accept", "text/event-stream")
		}
		if settings.organization != "" {
			req.Header.Set("X-Organization-Id", settings.organization)
		}
		response, err := transport.Do(req)
		if err != nil {
			return nil, requestError(err, response, settings.idempotencyKey)
		}
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			return response, nil
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, 65536))
		response.Body.Close()
		refusal := requestError(fmt.Errorf("inference HTTP %d: %s", response.StatusCode, data), response, settings.idempotencyKey)
		var metadata struct {
			Error struct {
				RequestID string `json:"request_id"`
				Code      string `json:"code"`
				Retryable bool   `json:"retryable"`
				Details   struct {
					RunID string            `json:"run_id"`
					URLs  map[string]string `json:"urls"`
				} `json:"details"`
			} `json:"error"`
		}
		if json.Unmarshal(data, &metadata) == nil {
			wrapped := refusal.(*RequestError)
			wrapped.Code = metadata.Error.Code
			wrapped.Retryable = metadata.Error.Retryable
			if metadata.Error.Details.RunID != "" {
				wrapped.RunID = metadata.Error.Details.RunID
			}
			wrapped.URLs = metadata.Error.Details.URLs
			if wrapped.RequestID == "" {
				wrapped.RequestID = metadata.Error.RequestID
			}
		}
		if readErr != nil {
			return nil, requestError(readErr, response, settings.idempotencyKey)
		}
		if attempt >= settings.inferenceRetries || refusal.(*RequestError).RunID != "" || (response.StatusCode != 429 && response.StatusCode != 503) || !confirmedInferenceRefusal(data) {
			return nil, refusal
		}
		wait := inferenceRetryWait(response.Header.Get("Retry-After"), attempt)
		if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) <= wait {
			return nil, refusal
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, requestError(ctx.Err(), response, settings.idempotencyKey)
		case <-timer.C:
		}
	}
}

// createImmediateInference never polls or retries an ambiguous request.
func (c *APIClient) createImmediateInference(ctx context.Context, input *InferenceCreate, options ...RequestOption) (*InferenceResponse, error) {
	settings, err := requestOptions(options, true)
	if err != nil {
		return nil, err
	}
	if input == nil {
		return nil, requestError(missingParameter("input"), nil, settings.idempotencyKey)
	}
	if input.GetStream() {
		return nil, requestError(errors.New("use Inferences.Stream for incremental output"), nil, settings.idempotencyKey)
	}
	body, err := json.Marshal(input)
	if err != nil {
		return nil, requestError(err, nil, settings.idempotencyKey)
	}
	ctx, cancel := context.WithTimeout(ctx, settings.inferenceTimeout)
	defer cancel()
	response, err := c.openInference(ctx, body, false, settings)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var result InferenceResponse
	if err = json.NewDecoder(response.Body).Decode(&result); err != nil {
		return nil, requestError(err, response, settings.idempotencyKey)
	}
	return &result, nil
}
