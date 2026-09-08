package dev.macrofold;

/** Preserves the generated error details and identity of an uncertain mutation. */
public final class RequestException extends ApiException {
  private final String idempotencyKey;
  public RequestException(ApiException cause,String idempotencyKey) {
    super(cause.getMessage(),cause,cause.getCode(),cause.getResponseHeaders(),cause.getResponseBody());
    this.idempotencyKey=idempotencyKey;
  }
  public String getIdempotencyKey(){return idempotencyKey;}
}
