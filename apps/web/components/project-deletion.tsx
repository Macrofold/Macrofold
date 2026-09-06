'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type Schema } from '../lib/client';
import { Button, Field, Modal } from './ui';
export function ProjectDeletion({ project }: { project: Schema['Project'] }) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const client = useQueryClient();
  return (
    <section className="panel danger-panel">
      <h2>{project.deletion_due_at ? 'Deletion scheduled' : 'Delete project permanently'}</h2>
      <p>
        {project.deletion_due_at
          ? `You can undo deletion before ${new Date(project.deletion_due_at).toLocaleString()}. New runs are paused.`
          : 'Schedule removal of files, native sessions, outputs, and tool history. You have seven days to undo. Physical objects are collected after an additional 14-day delay; backup retention also applies.'}
      </p>
      {project.deletion_due_at ? (
        <Button
          variant="secondary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(`/v1/projects/${project.id}/deletion`, 'DELETE');
              await client.invalidateQueries();
              toast.success('Deletion cancelled');
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Undo deletion
        </Button>
      ) : (
        <Button
          variant="danger"
          onClick={() => {
            setOpen(true);
            setError('');
            setName('');
            setPassword('');
          }}
        >
          Schedule deletion
        </Button>
      )}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Delete this project?"
        description="This schedules permanent removal in seven days and requests cancellation of active agents. Organization owners and admins can undo it during that period."
      >
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api(`/v1/projects/${project.id}/deletion`, 'POST', {
                confirmation: name,
                ...(password ? { password } : {}),
              });
              setOpen(false);
              await client.invalidateQueries();
              toast.success('Deletion scheduled');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={`Type ${project.name} to confirm`}>
            <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label="Confirm password"
            hint="Needed if you signed in more than 15 minutes ago. Social sign-in users can sign out and sign back in."
          >
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="danger" busy={busy} disabled={name !== project.name}>
            Schedule permanent deletion
          </Button>
        </form>
      </Modal>
    </section>
  );
}
