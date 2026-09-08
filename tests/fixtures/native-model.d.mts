import type { RequestListener } from 'node:http';
export function nativeModelFixture(options?: { journey?: boolean; questionMode?: boolean }): {
  handler: RequestListener;
  observed: { path: string; tools?: string[]; model?: string; hasPriorPrompt: boolean; hasAnswer: boolean }[];
  readonly calls: number;
};
