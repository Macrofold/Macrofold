export type HarnessName = 'codex' | 'claude-code' | 'opencode';
export type NativeEvent = { type: string; data: Record<string, unknown> };
export type NativeConfiguration = {
  runId: string;
  harness: HarnessName;
  model: string;
  provider: string;
  prompt: string;
  instructions?: string;
  workspace: string;
  stateHome: string;
  gatewayURL: string;
  toolURL: string;
  token: string;
  deadline: string;
  resumeId?: string;
  toolGrants: boolean;
};
export type NativeResult = {
  output: string;
  resumeId?: string;
  outcome: 'success' | 'failure' | 'cancelled' | 'timed_out';
  failureCode?: string;
};
export type HarnessContext = {
  configuration: NativeConfiguration;
  signal: AbortSignal;
  emit: (event: NativeEvent) => Promise<void>;
  ask: (id: string, question: string, details: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
export interface HarnessAdapter {
  run(context: HarnessContext): Promise<NativeResult>;
}
