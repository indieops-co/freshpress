import { describe, it, expect } from 'vitest';
import {
  buildDemoStyleGuide,
  buildDemoPages,
  buildDemoCustomFolders,
  buildDemoEmailContent,
  buildDemoSubmissions,
  buildDemoCampaign,
  DEMO_THEME_ID,
} from './seed-content.js';
import { validateGeneratedPage } from '../guardian/validate-generated-page.js';
import { prepareGeneratedPages } from '../api/sites.js';
import { StyleGuideSchema } from '../design/style-guide.js';

const NOW = new Date('2026-07-11T12:00:00Z');

describe('buildDemoStyleGuide', () => {
  it('parses the vendored theme heuristically into a valid StyleGuide', async () => {
    const guide = await buildDemoStyleGuide();
    expect(() => StyleGuideSchema.parse(guide)).not.toThrow();
    expect(guide.meta.id).toBe(`sg_${DEMO_THEME_ID}`);
  });
});

describe('buildDemoPages', () => {
  it('every page passes Guardian generated-page validation', () => {
    for (const page of buildDemoPages()) {
      const result = validateGeneratedPage(page.content);
      expect(result.ok, `${page.path}: ${result.ok ? '' : result.errors.join('; ')}`).toBe(true);
    }
  });

  it('the whole batch passes prepareGeneratedPages against an empty site', () => {
    const prepared = prepareGeneratedPages(buildDemoPages(), []);
    expect(prepared.ok, prepared.ok ? '' : `${prepared.error} — ${prepared.errors.join('; ')}`).toBe(true);
    if (prepared.ok) {
      expect(prepared.newPages.map((p) => p.path)).toEqual(['/', '/about', '/contact', '/services']);
      expect(prepared.existingUpdates).toEqual([]);
    }
  });
});

describe('buildDemoEmailContent', () => {
  const siteId = 'site1';
  const folders = buildDemoCustomFolders(siteId, NOW);
  const folderIds = { inbox: 'fld_inbox', leads: folders[0].id, suppliers: folders[1].id };
  const { threads, messages } = buildDemoEmailContent(siteId, folderIds, NOW);

  it('builds custom Leads (with filter rule) and Suppliers folders', () => {
    expect(folders.map((f) => f.name)).toEqual(['Leads', 'Suppliers']);
    expect(folders[0].filterRule).toEqual({ matchType: 'keyword', value: 'quote' });
    expect(folders.every((f) => f.kind === 'custom')).toBe(true);
  });

  it('every thread points at a known folder', () => {
    const known = new Set(Object.values(folderIds));
    for (const thread of threads) expect(known.has(thread.folderId), thread.subject).toBe(true);
  });

  it('messageCount matches the built messages of each thread', () => {
    for (const thread of threads) {
      const count = messages.filter((m) => m.threadId === thread.id).length;
      expect(thread.messageCount, thread.subject).toBe(count);
    }
  });

  it('lastMessageAt matches the newest non-draft message', () => {
    for (const thread of threads) {
      const sentAts = messages
        .filter((m) => m.threadId === thread.id && m.status !== 'draft')
        .map((m) => m.sentAt)
        .sort();
      expect(thread.lastMessageAt, thread.subject).toBe(sentAts[sentAts.length - 1]);
    }
  });

  it('includes exactly one AI-generated draft (the badge showcase)', () => {
    const aiDrafts = messages.filter((m) => m.isAiGenerated);
    expect(aiDrafts).toHaveLength(1);
    expect(aiDrafts[0].status).toBe('draft');
    expect(aiDrafts[0].direction).toBe('outbound');
  });

  it('spreads read/unread and categories for a believable inbox', () => {
    expect(threads.some((t) => !t.isRead)).toBe(true);
    expect(threads.some((t) => t.isRead)).toBe(true);
    const categories = new Set(threads.map((t) => t.category));
    expect(categories.has('personal')).toBe(true);
    expect(categories.has('promo')).toBe(true);
    expect(categories.has('newsletter')).toBe(true);
  });
});

describe('buildDemoSubmissions', () => {
  it('builds 5 contact-page submissions with the required fields', () => {
    const submissions = buildDemoSubmissions();
    expect(submissions).toHaveLength(5);
    for (const s of submissions) {
      expect(s.name).toBeTruthy();
      expect(s.email).toContain('@');
      expect(s.message).toBeTruthy();
      expect(s.pagePath).toBe('/contact');
    }
  });
});

describe('buildDemoCampaign', () => {
  const { campaign, steps } = buildDemoCampaign('site1', 'pillar1', NOW);

  it('stays a draft linked to the seeded pillar (never sends in demo)', () => {
    expect(campaign.status).toBe('draft');
    expect(campaign.pillarId).toBe('pillar1');
    expect(campaign.resendAutomationId).toBeUndefined();
  });

  it('steps reference the campaign and stagger delays in order', () => {
    expect(steps).toHaveLength(3);
    steps.forEach((step, i) => {
      expect(step.campaignId).toBe(campaign.id);
      expect(step.siteId).toBe('site1');
      expect(step.order).toBe(i);
    });
    expect(steps.map((s) => s.delayDays)).toEqual([0, 3, 7]);
  });
});
