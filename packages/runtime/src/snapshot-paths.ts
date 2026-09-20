/** New native checkpoints omit hidden entries and all descendants of hidden directories. */
export function isHiddenSnapshotPath(name: string): boolean {
  return name.split('/').some((segment) => segment.startsWith('.'));
}
