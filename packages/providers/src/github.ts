import { App } from '@octokit/app';
import { assert } from '../../core/src/errors';
import { gitTransport } from './git-http';
import type { HttpClient } from 'isomorphic-git';
export type GitRemote = {
  url: string;
  token: string;
  http: HttpClient;
  fullName: string;
  defaultBranch: string;
  repositoryId: string;
};
export interface RepositoryHost {
  remote(installation: string, repository: string): Promise<GitRemote>;
  pullRequest(installation: string, repository: string, head: string, base: string): Promise<string>;
}
export function githubApp() {
  assert(
    process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY,
    503,
    'github_not_configured',
    'The operator must configure the GitHub App.',
  );
  return new App({
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
}
export class GitHubHost implements RepositoryHost {
  async remote(installation: string, repository: string): Promise<GitRemote> {
    assert(
      /^\d+$/.test(installation) && /^\d+$/.test(repository),
      400,
      'invalid_repository',
      'Use numeric GitHub installation and repository IDs.',
    );
    const app = githubApp();
    // Tokens are bound to one repository and live only for this maintenance attempt, never in .git/config.
    const { data } = await app.octokit.request('POST /app/installations/{installation_id}/access_tokens', {
      installation_id: Number(installation),
      repository_ids: [Number(repository)],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
    const octokit = await app.getInstallationOctokit(Number(installation));
    const repo = await octokit.request('GET /repositories/{repository_id}', {
      repository_id: Number(repository),
    });
    const value = repo.data;
    assert(
      String(value.id) === repository && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value.full_name),
      502,
      'github_repository_mismatch',
      'GitHub returned an invalid repository identity.',
    );
    const url = `https://github.com/${value.full_name}.git`;
    return {
      url,
      token: data.token,
      http: gitTransport(url),
      fullName: value.full_name,
      defaultBranch: value.default_branch,
      repositoryId: repository,
    };
  }
  async pullRequest(installation: string, repository: string, head: string, base: string) {
    const app = githubApp(),
      octokit = await app.getInstallationOctokit(Number(installation));
    const { data: repo } = await octokit.request('GET /repositories/{repository_id}', {
      repository_id: Number(repository),
    });
    const owner = repo.owner.login;
    const existing = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo: repo.name,
      head: `${owner}:${head}`,
      base,
      state: 'open',
    });
    if (existing.data[0]) return existing.data[0].html_url;
    const created = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner,
      repo: repo.name,
      head,
      base,
      title: `Workspace changes: ${head}`,
      body: 'Review the changes from the hosted workspace. The platform has not merged this pull request.',
      draft: true,
    });
    return created.data.html_url;
  }
}
