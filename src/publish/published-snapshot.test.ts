import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SiteVersion } from '../storage/types.js';
import type { PageContent } from '../content/types.js';

vi.mock('../storage/filesystem.js', () => ({ getStorage: vi.fn() }));
vi.mock('./index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./index.js')>()),
  listPublishes: vi.fn(),
}));

const { getStorage } = await import('../storage/filesystem.js');
const { listPublishes } = await import('./index.js');
const { getPublishedSnapshot } = await import('./service.js');

const pageContent: PageContent = { template: '<p>{{slot:a}}</p>', slots: {}, slotOrder: [] };

const record = (over: Partial<import('./index.js').PublishRecord>) => ({
  id: 'pub1',
  siteId: 'site1',
  label: 'Publish',
  createdAt: '2026-02-01T00:00:00Z',
  pageCount: 1,
  bundlePath: '',
  ...over,
});

const version = (over: Partial<SiteVersion>): SiteVersion => ({
  id: 'v1',
  label: '',
  createdAt: '2026-02-01T00:00:00Z',
  pages: { p1: pageContent },
  ...over,
});

function mockVersions(versions: SiteVersion[]) {
  vi.mocked(getStorage).mockResolvedValue({
    listVersions: vi.fn().mockResolvedValue(versions),
  } as unknown as Awaited<ReturnType<typeof getStorage>>);
}

beforeEach(() => {
  vi.mocked(listPublishes).mockReset();
  vi.mocked(getStorage).mockReset();
});

describe('getPublishedSnapshot', () => {
  it('returns null when the site has never been published', async () => {
    vi.mocked(listPublishes).mockResolvedValue([]);
    expect(await getPublishedSnapshot('site1')).toBeNull();
  });

  it('resolves the snapshot via the record prePublishVersionId link', async () => {
    vi.mocked(listPublishes).mockResolvedValue([record({ prePublishVersionId: 'v2' })]);
    mockVersions([version({ id: 'v1' }), version({ id: 'v2', pages: { p9: pageContent } })]);

    const snap = await getPublishedSnapshot('site1');
    expect(snap?.record.id).toBe('pub1');
    expect(Object.keys(snap?.pages ?? {})).toEqual(['p9']);
  });

  it('falls back to matching a version by publishId for legacy records', async () => {
    vi.mocked(listPublishes).mockResolvedValue([record({})]);
    mockVersions([version({ id: 'v3', publishId: 'pub1' })]);

    const snap = await getPublishedSnapshot('site1');
    expect(Object.keys(snap?.pages ?? {})).toEqual(['p1']);
  });

  it('uses only the NEWEST publish record (listPublishes is newest-first)', async () => {
    vi.mocked(listPublishes).mockResolvedValue([
      record({ id: 'pub2', prePublishVersionId: 'v2' }),
      record({ id: 'pub1', prePublishVersionId: 'v1' }),
    ]);
    mockVersions([version({ id: 'v1' }), version({ id: 'v2', pages: { latest: pageContent } })]);

    const snap = await getPublishedSnapshot('site1');
    expect(snap?.record.id).toBe('pub2');
    expect(Object.keys(snap?.pages ?? {})).toEqual(['latest']);
  });

  it('returns null when the linked snapshot cannot be resolved', async () => {
    vi.mocked(listPublishes).mockResolvedValue([record({ prePublishVersionId: 'gone' })]);
    mockVersions([version({ id: 'v1' })]);

    expect(await getPublishedSnapshot('site1')).toBeNull();
  });
});
