package macrofold

import (
	"crypto/rand"
	"fmt"
	"net/http"
)

// ClientOption configures the SDK without changing the generated HTTP transport.
type ClientOption func(*clientOptions)
type clientOptions struct {
	origin, apiKey string
	keySet         bool
}

func WithBaseURL(origin string) ClientOption { return func(o *clientOptions) { o.origin = origin } }
func WithAPIKey(key string) ClientOption {
	return func(o *clientOptions) { o.apiKey = key; o.keySet = true }
}

type requestSettings struct{ idempotencyKey, organization string }
type RequestOption func(*requestSettings)

func WithIdempotencyKey(key string) RequestOption {
	return func(o *requestSettings) { o.idempotencyKey = key }
}
func WithRequestOrganization(id string) RequestOption {
	return func(o *requestSettings) { o.organization = id }
}
func requestOptions(options []RequestOption, mutation bool) (requestSettings, error) {
	settings := requestSettings{}
	for _, option := range options {
		option(&settings)
	}
	if mutation && settings.idempotencyKey == "" {
		var bytes [16]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			return settings, err
		}
		bytes[6] = (bytes[6] & 0x0f) | 0x40
		bytes[8] = (bytes[8] & 0x3f) | 0x80
		settings.idempotencyKey = fmt.Sprintf("%x-%x-%x-%x-%x", bytes[:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:])
	}
	return settings, nil
}
func missingParameter(name string) error { return fmt.Errorf("Macrofold: missing required %s", name) }

// RequestError retains mutation identity and the original generated error for errors.As/Unwrap.
type RequestError struct {
	Err            error
	Response       *http.Response
	IdempotencyKey string
}

func (e *RequestError) Error() string { return e.Err.Error() }
func (e *RequestError) Unwrap() error { return e.Err }
func requestError(err error, response *http.Response, key string) error {
	if err == nil {
		return nil
	}
	return &RequestError{Err: err, Response: response, IdempotencyKey: key}
}
