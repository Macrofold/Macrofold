import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { CustomerConnectionCard } from '../../../sdk/typescript/src/react';
import type { Schema } from '../../../sdk/typescript/src/client';

const initial: Schema['CustomerAgentConnection'] = {
  connection: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'My account',
    kind: 'composio',
    provider: 'fixture',
    auth_method: 'oauth',
    status: 'healthy',
    created_at: new Date().toISOString(),
  },
  capabilities: [{ id: 'read', label: 'Read records', tools: ['FIXTURE_READ'] }],
  access_version: '1',
  selected_capabilities: [],
  approved_tools: [],
};
function App() {
  const [value, setValue] = useState(initial),
    [action, setAction] = useState('');
  return (
    <main>
      <h1>Embedded connection controls</h1>
      <button onClick={() => setValue({ ...value, access_version: '2', selected_capabilities: [] })}>
        Simulate permission change
      </button>
      <CustomerConnectionCard
        value={value}
        onAuthorize={async () => {
          throw new Error('A new link is needed');
        }}
        onSave={async (ids, version) => {
          setAction(`Saved ${ids.join(',')} at ${version}`);
        }}
        onDisconnect={async () => {
          setAction('Disconnected');
        }}
      />
      <output>{action}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
