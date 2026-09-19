import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { components } from '../../packages/contracts/api';
import { publishFileMutation } from '../../apps/web/lib/workspace-files';

type Schema = components['schemas'];
const worktreeId = '01994000-0000-7000-8000-000000000001';
const prefix = `/v1/worktrees/${worktreeId}`;
const timestamp = '2026-09-10T00:00:00.000Z';
const worktree: Schema['Worktree'] = {
  id: worktreeId,
  workspace_id: '01994000-0000-7000-8000-000000000002',
  organization_id: '01994000-0000-7000-8000-000000000003',
  name: 'Cache fixture',
  revision: '4',
  status: 'idle',
  created_at: timestamp,
};
const file = (path: string, revision = '4'): Schema['FileEntry'] => ({
  path,
  type: 'file',
  revision,
  size_bytes: '12',
});
const listing = (entries: Schema['FileEntry'][], cursor: string | null = null): Schema['FileListing'] => ({
  entries,
  revision: '4',
  source: 'active_worktree',
  observed_at: timestamp,
  next_cursor: cursor,
});
const directoryKey = (directory = '', cursor = '') => [
  `${prefix}/files?path=${encodeURIComponent(directory)}&recursive=false&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
];
const operation = (overrides: Partial<Schema['Operation']> = {}): Schema['Operation'] => ({
  id: '01994000-0000-7000-8000-000000000004',
  kind: 'file_write',
  status: 'succeeded',
  created_at: timestamp,
  result: {
    worktree_id: worktreeId,
    revision: '5',
    checkpoint_id: '01994000-0000-7000-8000-000000000005',
    path: 'note.md',
    entry: file('note.md', '5'),
  },
  ...overrides,
});

describe('confirmed worktree file cache mutations', () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData([prefix], worktree);
    client.setQueryData(directoryKey(), listing([file('kept.txt')]));
  });
  afterEach(() => client.clear());

  it('seeds the committed worktree revision and entry while retaining existing data', async () => {
    const confirmed = operation();
    expect(await publishFileMutation(client, worktreeId, confirmed)).toEqual(confirmed.result);
    expect(client.getQueryData([prefix])).toEqual({
      ...worktree,
      revision: '5',
      latest_checkpoint_id: confirmed.result?.checkpoint_id,
    });
    expect(client.getQueryData(directoryKey())).toEqual({
      ...listing([file('kept.txt'), file('note.md', '5')]),
      revision: '5',
    });
    expect(client.getQueryState(directoryKey())?.isInvalidated).toBe(true);
  });

  it('moves a renamed file between direct folder caches without duplicating it across pages or replay', async () => {
    const source = directoryKey('source');
    const sourceMore = directoryKey('source', 'source/early.txt');
    const destination = directoryKey('destination');
    const destinationMore = directoryKey('destination', 'destination/early.txt');
    client.setQueryData(source, listing([file('source/early.txt')], 'source/early.txt'));
    client.setQueryData(sourceMore, listing([file('source/original.md'), file('source/retained.txt')]));
    client.setQueryData(destination, listing([file('destination/early.txt')], 'destination/early.txt'));
    client.setQueryData(destinationMore, listing([file('destination/retained.txt')]));
    const confirmed = operation({
      kind: 'file_rename',
      result: {
        revision: '5',
        path: 'destination/renamed.md',
        previous_path: 'source/original.md',
        entry: file('destination/renamed.md', '5'),
      },
    });
    await publishFileMutation(client, worktreeId, confirmed);
    await publishFileMutation(client, worktreeId, confirmed);
    const paths = (key: string[]) =>
      client.getQueryData<Schema['FileListing']>(key)?.entries.map((entry) => entry.path);
    expect(paths(source)).toEqual(['source/early.txt']);
    expect(paths(sourceMore)).toEqual(['source/retained.txt']);
    expect(paths(destination)).toEqual(['destination/early.txt', 'destination/renamed.md']);
    expect(paths(destinationMore)).toEqual(['destination/retained.txt']);
    expect(client.getQueryData<Schema['FileListing']>(destination)?.next_cursor).toBe(
      'destination/early.txt',
    );
    expect(client.getQueryData<Schema['FileListing']>(destination)?.entries[1]).toEqual(
      file('destination/renamed.md', '5'),
    );
    expect(client.getQueryData<Schema['FileListing']>(directoryKey())?.entries).toContainEqual({
      path: 'destination',
      type: 'directory',
      revision: '5',
    });
  });

  it('does not mutate or invalidate unrelated worktree and account queries', async () => {
    const otherWorktree = '/v1/worktrees/01994000-0000-7000-8000-000000000099';
    const keys = [
      [otherWorktree],
      [`${otherWorktree}/files?path=&recursive=false&limit=100`],
      ['/v1/identity'],
      ['/v1/billing'],
      ['/v1/runs?limit=100'],
    ];
    keys.forEach((key) => client.setQueryData(key, { retained: key[0] }));
    const states = keys.map((key) => client.getQueryState(key));
    await publishFileMutation(client, worktreeId, operation());
    keys.forEach((key, index) => expect(client.getQueryState(key)).toBe(states[index]));
  });

  it.each([
    operation({ status: 'queued' }),
    operation({ status: 'running' }),
    operation({ status: 'failed' }),
    operation({ result: undefined }),
    operation({ result: { path: 'note.md' } }),
    operation({ result: { revision: '', path: 'note.md' } }),
    operation({ result: { revision: '5' } }),
    operation({ result: { revision: '5', path: '' } }),
  ])('leaves cache data intact when the result is not confirmed: %j', async (unconfirmed) => {
    const worktreeState = client.getQueryState([prefix]);
    const listingState = client.getQueryState(directoryKey());
    await expect(publishFileMutation(client, worktreeId, unconfirmed)).rejects.toThrow(
      'Unable to confirm the saved revision',
    );
    expect(client.getQueryState([prefix])).toBe(worktreeState);
    expect(client.getQueryState(directoryKey())).toBe(listingState);
    expect(client.getQueryCache().getAll()).toHaveLength(2);
  });
});
