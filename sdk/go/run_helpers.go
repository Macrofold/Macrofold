package macrofold

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// RunFailedError distinguishes an unsuccessful run from an HTTP/transport failure.
type RunFailedError struct {
	RunID       string
	Status      string
	FailureCode string
	Result      *RunResult
}

func (e *RunFailedError) Error() string {
	return fmt.Sprintf("run %s ended with status %s (persistence: %s)", e.RunID, e.Status, e.Result.PersistenceStatus)
}

type WaitTimeoutError struct{ RunID string }

func (e *WaitTimeoutError) Error() string {
	return fmt.Sprintf("timed out waiting for run %s; the agent has not been cancelled", e.RunID)
}
func (e *WaitTimeoutError) Unwrap() error { return context.DeadlineExceeded }

// Events exposes structured events; cancelling the context detaches without cancelling execution.
func (r *RunsResource) Events(ctx context.Context, runID, after string, receive func(Event) error, options ...RequestOption) error {
	return r.Stream(ctx, runID, after, receive, options...)
}

// StreamText delivers assistant text only, then verifies the final execution/persistence outcome.
func (r *RunsResource) StreamText(ctx context.Context, runID, after string, receive func(string) error, options ...RequestOption) error {
	err := r.Events(ctx, runID, after, func(event Event) error {
		if text, ok := event.Data["text"].(string); event.Type == "output.delta" && ok && text != "" {
			return receive(text)
		}
		return nil
	}, options...)
	if err != nil {
		return err
	}
	_, err = r.Wait(ctx, runID, options...)
	return err
}

// Wait returns the durable result. Use a context deadline to stop waiting, not the remote agent.
func (r *RunsResource) Wait(ctx context.Context, runID string, options ...RequestOption) (result *RunResult, err error) {
	defer func() {
		if errors.Is(err, context.DeadlineExceeded) && ctx.Err() == context.DeadlineExceeded {
			err = &WaitTimeoutError{RunID: runID}
		}
	}()
	for {
		if err = ctx.Err(); err != nil {
			return nil, err
		}
		run, err := r.Get(ctx, runID, options...)
		if err != nil {
			return nil, err
		}
		switch run.Status {
		case "succeeded", "failed", "cancelled", "timed_out":
			result, err := r.GetResult(ctx, runID, options...)
			if err != nil {
				return nil, err
			}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			if result.Final && result.PersistenceStatus != "pending" {
				if run.Status != "succeeded" || result.ExecutionOutcome != "success" || (result.PersistenceStatus != "verified" && result.PersistenceStatus != "not_required") {
					return nil, &RunFailedError{RunID: runID, Status: run.Status, FailureCode: run.GetFailureCode(), Result: result}
				}
				return result, nil
			}
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
