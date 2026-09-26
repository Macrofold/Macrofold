import type { RequestListener } from 'node:http';
export function nativeModelFixture(options?: {
  journey?: boolean;
  /** Native working directory the scripted commands target; defaults to /workspace. */
  workspace?: string;
  questionMode?: boolean;
  toolMode?: boolean;
  failureMode?: boolean;
  permissionMode?: boolean;
  onBlocked?: () => Promise<void>;
}): {
  handler: RequestListener;
  observed: {
    path: string;
    tools?: string[];
    model?: string;
    hasPriorPrompt: boolean;
    hasAnswer: boolean;
    hasWorkspaceContext: boolean;
    hasPersistenceGuidance: boolean;
    hasRunInstructions: boolean;
    permissionDenied: boolean;
    leakedSecret: boolean;
    fileSaved: boolean;
    fileRead: boolean;
    nativeToolRejected: boolean;
  }[];
  readonly calls: number;
};
