package dev.macrofold;

/** Preserves the generated error details and identity of an uncertain mutation. */
public final class RequestException extends ApiException {
  private final String idempotencyKey;
  private final String runId;
  private final com.fasterxml.jackson.databind.JsonNode urls;
  private final String requestId;
  private final String errorCode;
  private final boolean retryable;

  public RequestException(ApiException cause, String idempotencyKey) {
    this(cause, idempotencyKey, null);
  }

  public RequestException(
      ApiException cause, String idempotencyKey, com.fasterxml.jackson.databind.JsonNode accepted) {
    super(
        cause.getMessage(),
        cause,
        cause.getCode(),
        cause.getResponseHeaders(),
        cause.getResponseBody());
    this.idempotencyKey = idempotencyKey;
    com.fasterxml.jackson.databind.JsonNode detail = null;
    try {
      if (cause.getResponseBody() != null) {
        var node =
            new com.fasterxml.jackson.databind.ObjectMapper().readTree(cause.getResponseBody());
        if (node != null) detail = node.path("error");
      }
    } catch (java.io.IOException ignored) {
    }
    this.errorCode = detail != null ? detail.path("code").asText(null) : null;
    this.retryable = detail != null && detail.path("retryable").asBoolean(false);
    this.runId =
        detail != null && detail.path("details").hasNonNull("run_id")
            ? detail.path("details").path("run_id").asText()
            : accepted != null && accepted.hasNonNull("run_id")
                ? accepted.path("run_id").asText()
                : cause.getResponseHeaders() != null
                    ? cause.getResponseHeaders().firstValue("x-run-id").orElse(null)
                    : null;
    this.urls =
        detail != null && detail.path("details").has("urls")
            ? detail.path("details").path("urls")
            : accepted != null ? accepted.path("data").get("urls") : null;
    this.requestId =
        cause.getResponseHeaders() != null
            ? cause
                .getResponseHeaders()
                .firstValue("x-request-id")
                .orElse(detail != null ? detail.path("request_id").asText(null) : null)
            : detail != null ? detail.path("request_id").asText(null) : null;
  }

  public String getErrorCode() {
    return errorCode;
  }

  public boolean isRetryable() {
    return retryable;
  }

  public String getRunId() {
    return runId;
  }

  public com.fasterxml.jackson.databind.JsonNode getUrls() {
    return urls;
  }

  public String getRequestId() {
    return requestId;
  }

  public String getIdempotencyKey() {
    return idempotencyKey;
  }
}
