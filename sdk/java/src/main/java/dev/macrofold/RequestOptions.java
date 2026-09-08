package dev.macrofold;

import java.util.UUID;

/** Optional per-action identity and organization; new mutations get a fresh identity. */
public final class RequestOptions {
  private final String idempotencyKey;
  private final UUID organization;
  public RequestOptions(String idempotencyKey, UUID organization) {
    this.idempotencyKey = idempotencyKey;
    this.organization = organization;
  }
  public static RequestOptions defaults() { return new RequestOptions(null, null); }
  public UUID organization() { return organization; }
  String identity() { return idempotencyKey == null ? UUID.randomUUID().toString() : idempotencyKey; }
}
