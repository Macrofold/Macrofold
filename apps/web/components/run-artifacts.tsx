'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { request, useDataPages } from '../lib/dashboard-data';
import { Button, ErrorState, Loading, More } from './ui';
import { FileIcon } from './files/file-icon';

export function RunArtifacts({ runId }: { runId: string }) {
  const query = useDataPages({ operation: 'listArtifacts', params: { path: { run_id: runId } } });
  const [error, setError] = useState<Error>(),
    [pending, setPending] = useState('');
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (!query.data?.data.length) return null;
  return (
    <section aria-label="Downloadable outputs" className="panel compact-panel">
      <h3>Files from this run</h3>
      <p className="form-hint">
        Verified deliverables. Downloads preserve the original file, even if the worktree changes later.
      </p>
      {query.data.data.map((artifact) => (
        <div key={artifact.id} className="attachment-list">
          <Button
            variant="secondary"
            busy={pending === artifact.id}
            disabled={!!pending}
            onClick={async () => {
              setPending(artifact.id);
              setError(undefined);
              try {
                const download = await request('downloadArtifact', {
                  params: { path: { artifact_id: artifact.id } },
                });
                const anchor = document.createElement('a');
                anchor.href = download.url;
                anchor.download = artifact.name;
                anchor.click();
              } catch (cause) {
                setError(cause as Error);
              } finally {
                setPending('');
              }
            }}
          >
            <FileIcon path={artifact.name} />
            <span>{artifact.name}</span>
            <Download size={14} />
          </Button>
        </div>
      ))}
      {error && <ErrorState error={error} />}
      <More query={query} label="More outputs" />
    </section>
  );
}
