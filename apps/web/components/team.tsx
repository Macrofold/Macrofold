'use client';
import { copyText } from '../lib/clipboard';
import { dashboardIdentityChanged } from './dashboard-freshness';
import { Select } from './select';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Copy, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, useApi, type Page, type Schema, relative } from '../lib/client';
import { Button, PageHeading, SectionHeading, Field, Modal, Loading, ErrorState } from './ui';
import { AuthActionFrame } from './auth-actions';

export function TeamView() {
  const identity = useApi<Schema['Identity']>('/v1/me');
  const current = identity.data?.organizations.find((o) => o.id === identity.data.organization_id);
  const manager = current && ['owner', 'admin'].includes(current.role);
  const members = useApi<Page<Schema['Member']>>('/v1/organization/members');
  const invitations = useApi<Page<Schema['Invitation']>>(
    manager ? '/v1/organization/invitations' : undefined,
  );
  const audit = useApi<Page<Schema['OrganizationAudit']>>(manager ? '/v1/organization/audit' : undefined);
  const client = useQueryClient();
  const [modal, setModal] = useState<'invite' | 'organization' | null>(null),
    [invite, setInvite] = useState(''),
    [name, setName] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [pending, setPending] = useState<{
    member: Schema['Member'];
    role?: Schema['Member']['role'];
  } | null>(null);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await client.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (identity.isPending || members.isPending) return <Loading />;
  if (identity.error || members.error) return <ErrorState error={(identity.error || members.error)!} />;
  return (
    <div className="page narrow-page">
      <PageHeading
        eyebrow="BUILD TOGETHER"
        title="Team & organization"
        description="Share persistent projects, manage access, and keep an accountable history."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setModal('organization');
              setError('');
            }}
          >
            <Plus size={16} />
            New organization
          </Button>
        }
      />
      <section className="panel">
        <SectionHeading
          title="Organization"
          description="Members share projects and billing. Personal connector credentials stay bound to their owners."
        />
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api('/v1/organization', 'PATCH', { name: name ?? current?.name });
              toast.success('Organization updated');
            });
          }}
        >
          <Field label="Organization name">
            <input
              required
              maxLength={100}
              value={name ?? current?.name ?? ''}
              disabled={!manager}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {manager && <Button busy={busy}>Save organization</Button>}
        </form>
      </section>
      <section className="panel">
        <SectionHeading
          title={`Members · ${members.data?.data.length || 0}`}
          description="Owners manage ownership and billing. Admins manage the team. Members can run agents. Viewers have read access."
          action={
            manager ? (
              <Button
                onClick={() => {
                  setModal('invite');
                  setInvite('');
                  setError('');
                }}
              >
                <Users size={16} />
                Invite member
              </Button>
            ) : undefined
          }
        />
        <div className="team-members">
          {members.data?.data.map((member) => (
            <div className="team-row" key={member.user_id}>
              <div className="avatar">{member.name.slice(0, 2).toUpperCase()}</div>
              <div className="team-person">
                <strong>
                  {member.name}
                  {member.user_id === identity.data?.user_id ? ' (you)' : ''}
                </strong>
                <span>{member.email}</span>
              </div>
              <Select
                aria-label={`Role for ${member.name}`}
                value={member.role}
                disabled={
                  !manager || (current?.role !== 'owner' && ['owner', 'admin'].includes(member.role)) || busy
                }
                onValueChange={(next) => setPending({ member, role: next as Schema['Member']['role'] })}
                options={[
                  ...(['owner', 'admin', 'member', 'viewer'].map((role) => ({
                    value: String(role),
                    label: role,
                    disabled: current?.role !== 'owner' && ['owner', 'admin'].includes(role),
                  })) ?? []),
                ]}
              />
              {manager && (current?.role === 'owner' || ['member', 'viewer'].includes(member.role)) && (
                <Button
                  variant="ghost"
                  aria-label={`Remove ${member.name}`}
                  onClick={() => setPending({ member })}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
      {manager && (
        <section className="panel">
          <SectionHeading
            title="Pending invitations"
            description="Links expire after seven days and can only be used by the invited, verified email address. Share each link yourself."
          />
          {invitations.error ? (
            <ErrorState error={invitations.error} />
          ) : invitations.data?.data.length ? (
            invitations.data.data.map((i) => (
              <div className="team-row" key={i.id}>
                <div className="team-person">
                  <strong>{i.email}</strong>
                  <span>
                    {i.role} · expires {new Date(i.expires_at).toLocaleDateString()}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  busy={busy}
                  onClick={() =>
                    act(async () => {
                      await api(`/v1/organization/invitations/${i.id}`, 'DELETE');
                    })
                  }
                >
                  Revoke invitation
                </Button>
              </div>
            ))
          ) : (
            <p className="empty-inline">No pending invitations.</p>
          )}
        </section>
      )}
      {manager && (
        <section className="panel">
          <SectionHeading
            title="Access history"
            description="The latest 100 membership and invitation changes."
          />
          {audit.error ? (
            <ErrorState error={audit.error} />
          ) : audit.data?.data.length ? (
            audit.data.data.map((a) => (
              <div className="team-row" key={a.id}>
                <ShieldCheck size={17} />
                <div className="team-person">
                  <strong>{a.action.replaceAll('.', ' ').replaceAll('_', ' ')}</strong>
                  <span>
                    By {members.data?.data.find((m) => m.user_id === a.actor_id)?.name || a.actor_id}
                  </span>
                </div>
                <small>{relative(a.created_at)}</small>
              </div>
            ))
          ) : (
            <p className="empty-inline">Access changes will appear here.</p>
          )}
        </section>
      )}
      {error && !modal && !pending && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Modal
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) {
            setModal(null);
            setInvite('');
            setError('');
          }
        }}
        title={modal === 'invite' ? 'Invite a teammate' : 'Create an organization'}
        description={
          modal === 'invite'
            ? 'Choose the access this person needs. You can change it later.'
            : 'A separate home for projects, members, credentials, and billing.'
        }
      >
        {invite ? (
          <div className="form-stack">
            <p>Copy this link now. It is shown only once.</p>
            <Field label="Invitation link">
              <input readOnly value={invite} />
            </Field>
            <Button onClick={() => copyText(invite, 'Invitation link copied')}>
              <Copy size={16} />
              Copy invitation
            </Button>
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void act(async () => {
                if (modal === 'invite') {
                  const result = await api<Schema['Invitation']>('/v1/organization/invitations', 'POST', {
                    email: data.get('email'),
                    role: data.get('role'),
                  });
                  setInvite(result.invite_url!);
                } else {
                  const org = await api<Schema['Organization']>('/v1/organizations', 'POST', {
                    name: data.get('name'),
                  });
                  await api('/account/organization', 'POST', { organization_id: org.id });
                  dashboardIdentityChanged();
                  location.assign('/team');
                }
              });
            }}
          >
            {modal === 'invite' ? (
              <>
                <Field label="Email address">
                  <input type="email" name="email" autoComplete="email" required />
                </Field>
                <Field label="Access role">
                  <Select
                    name="role"
                    defaultValue="member"
                    options={[
                      ...(current?.role === 'owner' ? [{ value: 'admin', label: 'Admin' }] : []),
                      { value: 'member', label: 'Member' },
                      { value: 'viewer', label: 'Viewer' },
                    ]}
                  />
                </Field>
              </>
            ) : (
              <Field label="Organization name">
                <input name="name" required minLength={1} maxLength={100} placeholder="Your team" />
              </Field>
            )}
            <Button busy={busy}>{modal === 'invite' ? 'Create invitation' : 'Create organization'}</Button>
          </form>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </Modal>
      <Modal
        open={!!pending}
        onOpenChange={(v) => {
          if (!v) {
            setPending(null);
            setError('');
          }
        }}
        title={pending?.role ? 'Change access' : 'Remove member'}
        description={
          pending?.role
            ? `Change ${pending.member.name} to ${pending.role}? Viewer access cancels their active work and revokes their API keys.`
            : `Remove ${pending?.member.name} from this organization? Their API keys will be revoked and active work cancelled.`
        }
      >
        <div className="row-actions">
          <Button variant="secondary" onClick={() => setPending(null)}>
            Keep current access
          </Button>
          <Button
            busy={busy}
            onClick={() =>
              act(async () => {
                await api(
                  `/v1/organization/members/${pending!.member.user_id}`,
                  pending?.role ? 'PATCH' : 'DELETE',
                  pending?.role ? { role: pending.role } : undefined,
                );
                setPending(null);
                toast.success('Access updated');
              })
            }
          >
            Confirm access change
          </Button>
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}
export function JoinOrganization({ token, signedIn }: { token: string; signedIn: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <AuthActionFrame
      title="Join your team"
      description="This invitation adds your account to a shared organization. Sign in with the invited email address."
    >
      {signedIn ? (
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('/account/invitation', 'POST', { token });
              location.assign('/team');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Accept invitation
        </Button>
      ) : (
        <a
          className="button primary"
          href={'/login?returnTo=' + encodeURIComponent('/join?token=' + encodeURIComponent(token))}
        >
          Sign in to accept
        </a>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </AuthActionFrame>
  );
}
