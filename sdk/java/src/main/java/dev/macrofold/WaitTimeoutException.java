package dev.macrofold;

import java.util.UUID;
import java.util.concurrent.TimeoutException;

public final class WaitTimeoutException extends TimeoutException {
  private final UUID runId;
  public WaitTimeoutException(UUID runId) {
    super("Timed out waiting for run " + runId + ". The agent has not been cancelled.");
    this.runId = runId;
  }
  public UUID getRunId() { return runId; }
}
