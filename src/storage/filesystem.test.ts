import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemStorage } from '../storage/filesystem.js';

const TEST_DATA = join(process.cwd(), 'data-test');

describe('FileSystemStorage', () => {
  beforeEach(() => {
    process.env.DATA_DIR = TEST_DATA;
  });

  afterEach(async () => {
    await rm(TEST_DATA, { recursive: true, force: true });
  });

  it('creates and lists sites', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    await storage.createSite('Acme Corp', 'acme.com');
    const sites = await storage.listSites();
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBe('Acme Corp');
  });

  it('stores pages and creates version snapshots', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    const { meta } = await storage.createSite('Test');
    const page = await storage.upsertPage(meta.id, {
      id: 'page1',
      path: '/',
      title: 'Home',
      content: { template: '<p>{{slot:a}}</p>', slots: { a: { id: 'a', type: 'text', value: 'Hi', tag: 'p', path: 'p[0]' } }, slotOrder: ['a'] },
    });
    expect(page.title).toBe('Home');

    const version = await storage.createVersion(meta.id, 'v1');
    expect(Object.keys(version.pages)).toContain('page1');

    await storage.upsertPage(meta.id, { ...page, content: { ...page.content, slots: { ...page.content.slots, a: { ...page.content.slots.a, value: 'Changed' } } } });
    await storage.restoreVersion(meta.id, version.id);
    const restored = await storage.getPage(meta.id, 'page1');
    expect(restored?.content.slots.a.value).toBe('Hi');
  });
});
