import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConnectorSyncReportStore, ConnectorSyncReportSchema } from './connector-sync-reports.js';

const TEST_DATA = join(process.cwd(), 'data-test-connector-sync-reports');

afterEach(async () => {
  await rm(TEST_DATA, { recursive: true, force: true });
});

const report = (over: Record<string, unknown> = {}) =>
  ConnectorSyncReportSchema.parse({
    ran_at: '2026-02-01T00:00:00Z',
    ok: true,
    site: 'Acme',
    created: 2,
    updated: 1,
    skipped: 5,
    drafted: 0,
    errors: 0,
    ...over,
  });

describe('ConnectorSyncReportStore (filesystem)', () => {
  it('round-trips the latest report for a site with a server receivedAt', async () => {
    const store = new ConnectorSyncReportStore({ dataDir: TEST_DATA });
    const saved = await store.save('site1', report(), '2026-02-01T00:00:05Z');
    expect(saved.siteId).toBe('site1');
    expect(saved.receivedAt).toBe('2026-02-01T00:00:05Z');

    const got = await store.get('site1');
    expect(got?.created).toBe(2);
    expect(got?.skipped).toBe(5);
    expect(got?.receivedAt).toBe('2026-02-01T00:00:05Z');
  });

  it('keeps only the latest report (overwrites) and is per-site', async () => {
    const store = new ConnectorSyncReportStore({ dataDir: TEST_DATA });
    await store.save('site1', report({ created: 1 }), 't1');
    await store.save('site1', report({ created: 9 }), 't2');
    await store.save('site2', report({ created: 4 }), 't3');

    expect((await store.get('site1'))?.created).toBe(9);
    expect((await store.get('site2'))?.created).toBe(4);
  });

  it('returns null for an unknown site and after delete', async () => {
    const store = new ConnectorSyncReportStore({ dataDir: TEST_DATA });
    expect(await store.get('nope')).toBeNull();
    await store.save('site1', report(), 't1');
    await store.delete('site1');
    expect(await store.get('site1')).toBeNull();
  });
});
