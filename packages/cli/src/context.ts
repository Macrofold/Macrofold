import { Client, type Schema } from '../../../sdk/typescript/src/client';
import { selectedProfile, tokenFor } from './profiles';
import { findLink, writeLink, type WorkspaceLink } from './local-workspace';
import { CliError } from './output';
export type Options = Record<string, string | boolean | string[] | number | undefined>;
export const stringOption = (options: Options, name: string) =>
  typeof options[name] === 'string' ? (options[name] as string) : undefined;
export const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);

/** Local workspace metadata can select IDs, but never an origin or a credential. */
export class Context {
  private constructor(
    readonly client: Client,
    readonly profileName: string,
    readonly flags: Options,
    readonly linked: Awaited<ReturnType<typeof findLink>>,
  ) {}
  private identityValue?: Schema['Identity'];
  private workspaceValue?: Schema['Workspace'];
  private worktreeValue?: Schema['Worktree'];
  static async open(flags: Options) {
    const linked = await findLink();
    const name = stringOption(flags, 'profile') || process.env.AGENT_PROFILE || linked?.link.profile;
    let profileName = name || 'environment';
    let origin: string, token: string | (() => Promise<string>), organization: string | undefined;
    if (process.env.AGENT_API_KEY) {
      origin = process.env.AGENT_HOST || '';
      if (!origin) throw new CliError('AGENT_API_KEY requires an explicitly trusted AGENT_HOST.');
      token = process.env.AGENT_API_KEY;
      organization = process.env.AGENT_ORGANIZATION;
    } else {
      const selected = await selectedProfile(name);
      profileName = selected.name;
      origin = selected.profile.origin;
      token = () => tokenFor(profileName);
      organization = selected.profile.organization;
    }
    return new Context(
      new Client({
        baseURL: origin,
        token,
        organization:
          stringOption(flags, 'organization') ||
          process.env.AGENT_ORGANIZATION ||
          linked?.link.organizationId ||
          organization,
        clientType: 'cli',
      }),
      profileName,
      flags,
      linked,
    );
  }
  identity() {
    return this.identityValue
      ? Promise.resolve(this.identityValue)
      : this.client.request('getIdentity').then((v) => (this.identityValue = v));
  }
  async workspace(selector = stringOption(this.flags, 'workspace') || this.linked?.link.workspaceId) {
    if (this.workspaceValue && (!selector || [this.workspaceValue.id, this.workspaceValue.name].includes(selector)))
      return this.workspaceValue;
    if (!selector) throw new CliError('Select a workspace with --workspace ID or run macrofold link WORKSPACE.');
    let workspace: Schema['Workspace'] | undefined;
    if (uuid(selector))
      workspace = await this.client.request('getWorkspace', { params: { path: { workspace_id: selector } } });
    else {
      let cursor: string | undefined;
      const matches: Schema['Workspace'][] = [];
      do {
        const page = await this.client.request('listWorkspaces', { params: { query: { limit: 100, cursor } } });
        matches.push(...page.data.filter((p) => p.name === selector));
        cursor = page.next_cursor || undefined;
      } while (cursor);
      if (matches.length !== 1)
        throw new CliError(
          matches.length ? 'Workspace name is ambiguous; use its ID.' : 'Workspace not found.',
          5,
        );
      workspace = matches[0];
    }
    return (this.workspaceValue = workspace);
  }
  async worktree(selector = stringOption(this.flags, 'worktree') || this.linked?.link.worktreeId) {
    if (
      this.worktreeValue &&
      (!selector ||
        [this.worktreeValue.id, this.worktreeValue.name, this.worktreeValue.branch].includes(selector))
    )
      return this.worktreeValue;
    const explicitWorkspace = stringOption(this.flags, 'workspace');
    // A new workspace selector must not accidentally reuse the old linked worktree.
    if (
      explicitWorkspace &&
      !stringOption(this.flags, 'worktree') &&
      selector === this.linked?.link.worktreeId
    ) {
      const p = await this.workspace();
      if (p.id !== this.linked?.link.workspaceId) selector = p.default_worktree_id;
    }
    let worktree: Schema['Worktree'] | undefined;
    if (selector && uuid(selector))
      worktree = await this.client.request('getWorktree', { params: { path: { worktree_id: selector } } });
    else {
      const workspace = await this.workspace();
      if (!selector) {
        if (!workspace.default_worktree_id) throw new CliError('This workspace has no default worktree.', 5);
        worktree = await this.client.request('getWorktree', {
          params: { path: { worktree_id: workspace.default_worktree_id } },
        });
      } else {
        let cursor: string | undefined;
        const matches: Schema['Worktree'][] = [];
        do {
          const page = await this.client.request('listWorktrees', {
            params: { path: { workspace_id: workspace.id }, query: { limit: 100, cursor } },
          });
          matches.push(...page.data.filter((w) => w.name === selector || w.branch === selector));
          cursor = page.next_cursor || undefined;
        } while (cursor);
        if (matches.length !== 1)
          throw new CliError(
            matches.length ? 'Worktree name is ambiguous; use its ID.' : 'Worktree not found.',
            5,
          );
        worktree = matches[0];
      }
    }
    if (explicitWorkspace) {
      const workspace = await this.workspace();
      if (worktree.workspace_id !== workspace.id)
        throw new CliError('The selected worktree belongs to a different workspace.', 5);
    }
    return (this.worktreeValue = worktree);
  }
  async session(selector = stringOption(this.flags, 'session') || this.linked?.link.sessionId) {
    if (!selector) return;
    const session = await this.client.request('getSession', { params: { path: { session_id: selector } } });
    if (stringOption(this.flags, 'worktree') && (await this.worktree()).id !== session.worktree_id)
      throw new CliError('The session belongs to a different worktree.', 5);
    const worktree = await this.client.request('getWorktree', {
      params: { path: { worktree_id: session.worktree_id } },
    });
    if (stringOption(this.flags, 'workspace') && (await this.workspace()).id !== worktree.workspace_id)
      throw new CliError('The session belongs to a different workspace.', 5);
    if (stringOption(this.flags, 'harness') && session.harness !== this.flags.harness)
      throw new CliError('A session keeps its original harness. Use /new for a different harness.', 5);
    this.worktreeValue = worktree;
    return session;
  }
  async link(worktree: Schema['Worktree'], root = this.linked?.root || process.cwd(), sessionId?: string) {
    const identity = await this.identity();
    const org = identity.organizations.find((o) => o.id === worktree.organization_id);
    if (!org) throw new CliError('This worktree is outside your authorized organizations.', 3);
    const value: WorkspaceLink = {
      version: 1,
      profile: this.profileName,
      organizationId: org.id,
      workspaceId: worktree.workspace_id,
      worktreeId: worktree.id,
      ...(sessionId ? { sessionId } : {}),
    };
    await writeLink(root, value);
    return { directory: root, ...value };
  }
}

export function limits(flags: Options): Schema['Limits'] {
  const cost = stringOption(flags, 'max-cost');
  if (cost && !/^\d+(?:\.\d{1,6})?$/.test(cost))
    throw new CliError('--max-cost is a USD amount with at most six decimal places.');
  return {
    timeout_seconds: flags.timeout ? Number(flags.timeout) : undefined,
    max_cost_micro_usd: cost
      ? (BigInt(cost.split('.')[0]) * 1000000n + BigInt((cost.split('.')[1] || '').padEnd(6, '0'))).toString()
      : '2000000',
  };
}
export function connectionSelection(flags: Options): Schema['Grant'][] | undefined {
  if (flags['no-connections']) return [];
  if (!Array.isArray(flags.connection) || !flags.connection.length) return undefined;
  return flags.connection.map((value) => {
    const colon = value.indexOf(':');
    if (colon < 0)
      throw new CliError(
        '--connection requires CONNECTION_ID:TOOL1,TOOL2. Choose explicit tools; wildcard grants are not implicit.',
      );
    const connection_id = value.slice(0, colon),
      tools = value
        .slice(colon + 1)
        .split(',')
        .filter(Boolean);
    if (!uuid(connection_id) || !tools.length)
      throw new CliError('Supply a valid connection ID and at least one tool.');
    return { connection_id, tools };
  });
}

export function execution(flags: Options) {
  return {
    harness: stringOption(flags, 'harness') as Schema['SessionCreate']['harness'] | undefined,
    model: stringOption(flags, 'model'),
    billing_mode: (stringOption(flags, 'billing-mode') ||
      'managed') as Schema['SessionCreate']['billing_mode'],
    provider_connection_id: stringOption(flags, 'provider-connection'),
    connection_grants: connectionSelection(flags),
    limits: limits(flags),
  };
}

export function scheduling(flags: Options) {
  return {
    queue_timeout_seconds: flags['queue-timeout'] ? Number(flags['queue-timeout']) : 86400,
    scheduling_class: (stringOption(flags, 'scheduling') || (flags.detach ? 'background' : 'interactive')) as
      'interactive' | 'background',
  };
}
