package dev.macrofold;

import dev.macrofold.model.RunResult;
import java.util.UUID;

/** Failed execution/persistence, or automatic recovery stopped with an unsettled receipt. */
public final class RunFailedException extends Exception {
  private final UUID runId;
  private final String status;
  private final String failureCode;
  private final RunResult result;

  public RunFailedException(UUID runId, String status, String failureCode, RunResult result) {
    super("Run " + runId + " cannot complete successfully with status " + status + " (persistence: " + result.getPersistenceStatus() + ").");
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
