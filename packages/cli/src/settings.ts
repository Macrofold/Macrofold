import path from 'node:path';
import os from 'node:os';
export const release = {
  version: '0.1.0',
  executable: 'agent',
  name: 'Hosted agents',
  clientId: 'hosted-agent-cli',
  configDirectory: process.env.AGENT_CONFIG_DIR || path.join(os.homedir(), '.config', 'hosted-agents'),
};
export const defaultScopes = [
  'identity:read',
  'offline_access',
  'projects:read',
  'projects:write',
  'files:read',
  'files:write',
  'runs:read',
  'runs:write',
  'connections:read',
  'usage:read',
];
