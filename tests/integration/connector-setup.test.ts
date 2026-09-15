import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { authPool, pool } from '../../packages/db';
import { enableConnector } from '../../packages/core/src/connector-setup';
import { enabledConnector } from '../../packages/core/src/connector-enablement';
import { fixtureOperator } from '../fixtures/operator';

const toolkit = 'setup_fixture';
const metadata = { version: '20260910_00', managed: true, authConfigs: [] as { id: string; name: string }[] };
const provider = () => ({
  inspect: vi.fn(async () => metadata),
  createManaged: vi.fn(async () => 'fixture-auth'),
});
afterEach(() =>
  fixtureOperator((db) => db.query('DELETE FROM connector_enablement WHERE toolkit=$1', [toolkit])),
);
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

it('serializes managed setup, persists the pin, and requires deliberate replacement', async () => {
  const source = provider();
  const setup = () => fixtureOperator((db) => enableConnector(db, source, { toolkit, managed: true }));
  const results = await Promise.all([setup(), setup()]);
  expect(results[0]).toMatchObject({
    enabled: true,
    toolkit_version: metadata.version,
    auth_config_id: 'fixture-auth',
  });
  expect(source.createManaged).toHaveBeenCalledOnce();
  expect(source.inspect).toHaveBeenCalledOnce();
  expect(await enabledConnector(toolkit)).toMatchObject({ enabled: true });
  await expect(
    fixtureOperator((db) => enableConnector(db, source, { toolkit, version: 'different' })),
  ).rejects.toMatchObject({ code: 'setup_review_required' });
  await expect(pool.query('UPDATE connector_enablement SET enabled=false')).rejects.toMatchObject({
    code: '42501',
  });
});

it('never repeats an uncertain creation and recovers by discovering the existing configuration', async () => {
  const source = provider();
  source.createManaged.mockRejectedValueOnce(new Error('lost response'));
  const setup = () => fixtureOperator((db) => enableConnector(db, source, { toolkit, managed: true }));
  await expect(setup()).rejects.toThrow('lost response');
  await expect(setup()).rejects.toMatchObject({ code: 'auth_creation_uncertain' });
  await expect(enabledConnector(toolkit)).rejects.toMatchObject({ code: 'integration_not_configured' });
  source.inspect.mockResolvedValue({
    ...metadata,
    authConfigs: [{ id: 'recovered', name: `platform-managed:${toolkit}` }],
  });
  expect(await setup()).toMatchObject({
    enabled: true,
    auth_config_id: 'recovered',
    creation_pending: false,
  });
  expect(source.createManaged).toHaveBeenCalledOnce();
});

it('reuses a selected custom config and rejects ambiguous choices or unsupported managed auth', async () => {
  const source = provider();
  source.inspect.mockResolvedValue({
    ...metadata,
    managed: false,
    authConfigs: [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ],
  });
  const setup = (authConfig?: string) =>
    fixtureOperator((db) => enableConnector(db, source, { toolkit, authConfig }));
  await expect(setup()).rejects.toMatchObject({ code: 'auth_config_choice_required' });
  await expect(setup('wrong')).rejects.toMatchObject({ code: 'invalid_auth_config' });
  expect(await setup('two')).toMatchObject({ auth_config_id: 'two', enabled: true });
  expect(source.createManaged).not.toHaveBeenCalled();
});

it('requires an explicit choice when multiple managed configs have the recovery name', async () => {
  const source = provider();
  source.inspect.mockResolvedValue({
    ...metadata,
    authConfigs: [
      { id: 'one', name: `platform-managed:${toolkit}` },
      { id: 'two', name: `platform-managed:${toolkit}` },
    ],
  });
  await expect(
    fixtureOperator((db) => enableConnector(db, source, { toolkit, managed: true })),
  ).rejects.toMatchObject({ code: 'auth_config_choice_required' });
  expect(source.createManaged).not.toHaveBeenCalled();
  expect(
    await fixtureOperator((db) => enableConnector(db, source, { toolkit, authConfig: 'two' })),
  ).toMatchObject({ auth_config_id: 'two' });
});
