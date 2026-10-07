import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkspaceUsersStore } from './workspace-users.js';

const TEST_DATA = join(process.cwd(), 'data-test-workspace-users');

afterEach(async () => {
  await rm(TEST_DATA, { recursive: true, force: true });
});

describe('WorkspaceUsersStore.setPlanTier', () => {
  it('creates a workspace when none exists and applies the tier', async () => {
    const store = new WorkspaceUsersStore({ dataDir: TEST_DATA });
    expect(await store.getWorkspace()).toBeNull();

    const ws = await store.setPlanTier('pro');

    expect(ws.name).toBe('Workspace');
    expect(ws.planTier).toBe('pro');
    expect(await store.getWorkspace()).toMatchObject({ id: ws.id, planTier: 'pro' });
  });

  it('updates the existing workspace tier while preserving id and name', async () => {
    const store = new WorkspaceUsersStore({ dataDir: TEST_DATA });
    const created = await store.createWorkspace('Acme Agency');
    expect(created.planTier).toBe('free');

    const upgraded = await store.setPlanTier('agency');

    expect(upgraded.id).toBe(created.id);
    expect(upgraded.name).toBe('Acme Agency');
    expect(upgraded.planTier).toBe('agency');
  });

  it('is idempotent — re-applying the same tier is a no-op on the value', async () => {
    const store = new WorkspaceUsersStore({ dataDir: TEST_DATA });
    await store.setPlanTier('pro');
    const first = await store.getWorkspace();

    const second = await store.setPlanTier('pro');

    expect(second.id).toBe(first?.id);
    expect(second.planTier).toBe('pro');
  });

  it('can downgrade back to free (license-revert path)', async () => {
    const store = new WorkspaceUsersStore({ dataDir: TEST_DATA });
    await store.setPlanTier('pro');
    const reverted = await store.setPlanTier('free');
    expect(reverted.planTier).toBe('free');
  });
});
