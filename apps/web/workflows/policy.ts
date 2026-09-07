// workflow@4.8.5: 3 events per successful step, 2 per retry, 2 per sleep.
// Count every phase, failure and lease-contention iteration together. Even all
// steps exhausting their retry allowance stays below the 2,000-event advisory.
export const WORKFLOW_ADVANCES = 128;
export const WORKFLOW_STEP_RETRIES = 3;
