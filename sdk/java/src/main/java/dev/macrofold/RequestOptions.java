package dev.macrofold;

import java.util.UUID;

/** Optional per-action identity and organization; new mutations get a fresh identity. */
public final class RequestOptions {
  private final String idempotencyKey;
  private final UUID organization;
  private final int inferenceRetries;
  private final java.time.Duration inferenceTimeout;

  public RequestOptions(String idempotencyKey, UUID organization) {
    this(idempotencyKey, organization, 0, java.time.Duration.ofSeconds(300));
  }

  public RequestOptions(
      String idempotencyKey,
      UUID organization,
      int inferenceRetries,
      java.time.Duration inferenceTimeout) {
    if (inferenceRetries < 0
        || inferenceRetries > 2
        || inferenceTimeout == null
        || inferenceTimeout.isNegative()
        || inferenceTimeout.isZero())
      throw new IllegalArgumentException("inference retries must be 0–2 and timeout positive");
    this.idempotencyKey = idempotencyKey;
    this.organization = organization;
    this.inferenceRetries = inferenceRetries;
    this.inferenceTimeout = inferenceTimeout;
  }

  public int inferenceRetries() {
    return inferenceRetries;
  }

  public java.time.Duration inferenceTimeout() {
    return inferenceTimeout;
  }

  public static RequestOptions defaults() {
    return new RequestOptions(null, null);
  }

  public UUID organization() {
    return organization;
  }

  String identity() {
    return idempotencyKey == null ? UUID.randomUUID().toString() : idempotencyKey;
  }
}
