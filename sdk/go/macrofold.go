package macrofold

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

var eventCursor = regexp.MustCompile(`^[0-9]+$`)

// NewClient uses MACROFOLD_API_KEY and the hosted origin unless options override them.
func NewClient(options ...ClientOption) (*Client, error) {
	settings := clientOptions{origin: DefaultOrigin}
	for _, option := range options {
		option(&settings)
	}
	token := settings.apiKey
	if !settings.keySet {
		token = os.Getenv("MACROFOLD_API_KEY")
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("missing Macrofold API key: use WithAPIKey or set MACROFOLD_API_KEY")
	}
	origin := settings.origin
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("use a service origin without a path, query, or credentials")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil, errors.New("HTTPS is required except for localhost")
	}
	cfg := NewConfiguration()
	cfg.Servers = ServerConfigurations{{URL: strings.TrimRight(origin, "/")}}
	cfg.DefaultHeader["Authorization"] = "Bearer " + token
	cfg.DefaultHeader["X-Client-Type"] = "sdk"
	cfg.HTTPClient = &http.Client{Timeout: 70 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return resources(NewAPIClient(cfg)), nil
}

// Stream emits persisted events incrementally and reconnects from the last delivered sequence.
// Cancel ctx or return an error from receive to detach; this never cancels the remote run.
func (c *APIClient) Stream(ctx context.Context, runID, after string, receive func(Event) error, options ...RequestOption) error {
	settings, err := requestOptions(options, false)
	if err != nil {
		return err
	}
	if after == "" {
		after = "0"
	}
	cursor, ok := new(big.Int).SetString(after, 10)
	if !ok || !eventCursor.MatchString(after) {
		return errors.New("use a numeric event cursor")
	}
	for failures := 0; ; {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.Servers[0].URL+"/v1/runs/"+url.PathEscape(runID)+"/stream?after="+url.QueryEscape(cursor.String()), nil)
		if err != nil {
			return err
		}
		for key, value := range c.cfg.DefaultHeader {
			req.Header.Set(key, value)
		}
		if settings.organization != "" {
			req.Header.Set("X-Organization-Id", settings.organization)
		}
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("Last-Event-ID", cursor.String())
		response, err := c.cfg.HTTPClient.Do(req)
		terminal := false
		var callbackError error
		if err == nil {
			if response.StatusCode != 200 {
				response.Body.Close()
				if response.StatusCode != 429 && response.StatusCode < 500 {
					return fmt.Errorf("event stream rejected: HTTP %d", response.StatusCode)
				}
				err = fmt.Errorf("event stream unavailable: HTTP %d", response.StatusCode)
			} else {
				err = readEvents(response.Body, func(event Event) error {
					sequence, valid := new(big.Int).SetString(event.Sequence, 10)
					if !valid || !eventCursor.MatchString(event.Sequence) || sequence.Cmp(cursor) <= 0 {
						return nil
					}
					if e := receive(event); e != nil {
						callbackError = e
						return e
					}
					cursor.Set(sequence)
					failures = 0
					terminal = event.Type == "run.succeeded" || event.Type == "run.failed" || event.Type == "run.cancelled" || event.Type == "run.timed_out"
					if terminal {
						return io.EOF
					}
					return nil
				})
				response.Body.Close()
			}
		}
		if callbackError != nil {
			return callbackError
		}
		if terminal {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err == nil {
			status := c.RunsAPI.GetRun(ctx, runID)
			if settings.organization != "" {
				status = status.XOrganizationId(settings.organization)
			}
			run, response, e := status.Execute()
			if e != nil && response != nil && response.StatusCode < 500 && response.StatusCode != 429 {
				return e
			}
			if e != nil {
				err = e
			} else if run.Status == "succeeded" || run.Status == "failed" || run.Status == "cancelled" || run.Status == "timed_out" {
				history := c.RunsAPI.ListRunEvents(ctx, runID).After(cursor.String()).Limit(1)
				if settings.organization != "" {
					history = history.XOrganizationId(settings.organization)
				}
				remaining, _, e := history.Execute()
				if e != nil {
					return e
				}
				if len(remaining.Data) == 0 {
					return nil
				}
			}
		}
		if err != nil {
			failures++
			if failures > 8 {
				return err
			}
		}
		wait := time.NewTimer(min(10*time.Second, 250*time.Millisecond*time.Duration(1<<failures)))
		select {
		case <-ctx.Done():
			wait.Stop()
			return ctx.Err()
		case <-wait.C:
		}
	}
}

func readEvents(reader io.Reader, receive func(Event) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	var data strings.Builder
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if data.Len() > 0 {
				var event Event
				if json.Unmarshal([]byte(data.String()), &event) == nil {
					if err := receive(event); err != nil {
						return err
					}
				}
				data.Reset()
			}
		} else if strings.HasPrefix(line, "data:") {
			data.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
			data.WriteByte('\n')
			if data.Len() > 4*1024*1024 {
				return errors.New("SSE frame exceeds client limit")
			}
		}
	}
	return scanner.Err()
}
