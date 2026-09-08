package dev.macrofold;

/** Branded entrypoint; Client remains available for existing applications. */
public final class Macrofold extends Client {
  public Macrofold() { super(); }
  public Macrofold(String apiKey) { super(apiKey); }
  public Macrofold(String origin, String apiKey) { super(origin, apiKey); }
}
