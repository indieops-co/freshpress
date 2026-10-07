import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrandResearchStore } from './brand-research.js';
import { buildDefaultBrandResearch } from '../content/brand-research-types.js';

const TEST_DATA = join(process.cwd(), 'data-test-brand-research');
const NOW = '2026-07-07T00:00:00.000Z';

describe('BrandResearchStore (filesystem)', () => {
  afterEach(async () => {
    await rm(TEST_DATA, { recursive: true, force: true });
  });

  it('returns null for a site with no research', async () => {
    const store = new BrandResearchStore({ dataDir: TEST_DATA });
    expect(await store.get('missing')).toBeNull();
  });

  it('getOrCreate returns a fresh default without persisting it', async () => {
    const store = new BrandResearchStore({ dataDir: TEST_DATA });
    const created = await store.getOrCreate('site-1');
    expect(created.siteId).toBe('site-1');
    expect(created.enabled).toBe(false);
    expect(await store.get('site-1')).toBeNull();
  });

  it('round-trips a saved document', async () => {
    const store = new BrandResearchStore({ dataDir: TEST_DATA });
    const research = buildDefaultBrandResearch('site-1', NOW);
    research.enabled = true;
    research.inputs.productDescription = 'A weighted vest for daily walkers';
    research.inputs.competitorUrls = ['https://example.com/vest'];
    await store.save('site-1', research);

    const loaded = await store.get('site-1');
    expect(loaded?.enabled).toBe(true);
    expect(loaded?.inputs.productDescription).toBe('A weighted vest for daily walkers');
    expect(loaded?.inputs.competitorUrls).toEqual(['https://example.com/vest']);
  });

  it('save stamps a fresh updatedAt on every write', async () => {
    const store = new BrandResearchStore({ dataDir: TEST_DATA });
    const research = buildDefaultBrandResearch('site-1', '2020-01-01T00:00:00.000Z');
    const saved = await store.save('site-1', research);
    expect(saved.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse('2025-01-01'));
  });

  it('get throws on a corrupt file instead of returning null (protects against overwrite)', async () => {
    const store = new BrandResearchStore({ dataDir: TEST_DATA });
    await mkdir(join(TEST_DATA, 'brand-research'), { recursive: true });
    await writeFile(join(TEST_DATA, 'brand-research', 'site-1.json'), 'not json', 'utf-8');
    await expect(store.get('site-1')).rejects.toThrow();
    await expect(store.getOrCreate('site-1')).rejects.toThrow();
  });

  it('save enforces the siteId key and validates the shape', async () => {
    const store = new BrandResearchStore({ dataDir: TEST_DATA });
    const research = buildDefaultBrandResearch('other-site', NOW);
    const saved = await store.save('site-1', research);
    expect(saved.siteId).toBe('site-1');

    await expect(
      store.save('site-1', { enabled: 'yes' } as never)
    ).rejects.toThrow();
  });

  it('delete removes the document and tolerates a missing one', async () => {
    const store = new BrandResearchStore({ dataDir: TEST_DATA });
    await store.save('site-1', buildDefaultBrandResearch('site-1', NOW));
    await store.delete('site-1');
    expect(await store.get('site-1')).toBeNull();
    await expect(store.delete('site-1')).resolves.toBeUndefined();
  });
});
