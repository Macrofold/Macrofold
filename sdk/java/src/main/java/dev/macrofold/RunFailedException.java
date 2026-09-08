package dev.macrofold;

import dev.macrofold.model.RunResult;
import java.util.UUID;

/** A completed run whose execution or persistence did not succeed. */
public final class RunFailedException extends Exception {
  private final UUID runId;
  private final String status;
  private final String failureCode;
  private final RunResult result;

  public RunFailedException(UUID runId, String status, String failureCode, RunResult result) {
    super("Run " + runId + " ended with status " + status + " (persistence: " + result.getPersistenceStatus() + ").");
    this.runId = runId;
    this.status = status;
    this.failureCode = failureCode;
    this.result = result;
  }
  public UUID getRunId() { return runId; }
  public String getStatus() { return status; }
  public String getFailureCode() { return failureCode; }
  public RunResult getResult() { return result; }
}
