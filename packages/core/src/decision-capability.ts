/** Web admission and every worker must advertise this exact executor version. */
export const decisionExecutorVersion = '1';
export const decisionsEnabled = () => process.env.DECISION_EXECUTOR_VERSION === decisionExecutorVersion;
