import { describe, it, expect } from 'vitest';
import {
  BRAND_RESEARCH_STEPS,
  BrandResearchSchema,
  INTERVIEW_ANSWER_KEYS,
  InterviewAnswersSchema,
  VOICE_SUMMARY_MAX_CHARS,
  applyBrandResearchPatch,
  approvalChainViolations,
  buildDefaultBrandResearch,
  markDownstreamStale,
  missingPrerequisites,
  stepPrerequisites,
  type BrandResearch,
} from './brand-research-types.js';

const NOW = '2026-07-07T00:00:00.000Z';

function approvedDoc(extra: Record<string, unknown> = {}) {
  return { generatedAt: NOW, approved: true, userEdited: false, stale: false, ...extra };
}

function withDocs(overrides: Partial<BrandResearch['docs']>): BrandResearch {
  const base = buildDefaultBrandResearch('site-1', NOW);
  return { ...base, docs: { ...base.docs, ...overrides } };
}

describe('brand-research-types', () => {
  it('buildDefaultBrandResearch fills defaults (disabled, empty inputs/docs)', () => {
    const research = buildDefaultBrandResearch('site-1', NOW);
    expect(research.siteId).toBe('site-1');
    expect(research.enabled).toBe(false);
    expect(research.inputs).toEqual({ productDescription: '', competitorUrls: [], transcripts: [] });
    expect(research.docs).toEqual({});
    expect(research.updatedAt).toBe(NOW);
  });

  it('schema rejects a beliefs doc with more than six beliefs', () => {
    const belief = { statement: 'I believe that it works', currentBelief: '', shiftStrategy: 's' };
    const result = BrandResearchSchema.safeParse({
      siteId: 'site-1',
      updatedAt: NOW,
      docs: { beliefs: approvedDoc({ beliefs: Array(7).fill(belief) }) },
    });
    expect(result.success).toBe(false);
  });

  it('stepPrerequisites forms a strict chain over the step order', () => {
    expect(stepPrerequisites('research')).toEqual([]);
    expect(stepPrerequisites('avatar')).toEqual(['research']);
    expect(stepPrerequisites('beliefs')).toEqual(['research', 'avatar', 'offerBrief']);
    expect(stepPrerequisites('voiceSummary')).toEqual(BRAND_RESEARCH_STEPS.slice(0, 5));
  });

  it('schema rejects a voiceSummary over the injection cap', () => {
    const result = BrandResearchSchema.safeParse({
      siteId: 'site-1',
      updatedAt: NOW,
      docs: { voiceSummary: approvedDoc({ summary: 'x'.repeat(VOICE_SUMMARY_MAX_CHARS + 1) }) },
    });
    expect(result.success).toBe(false);
  });

  it('INTERVIEW_ANSWER_KEYS tracks the schema exactly (pins the 9-question call script)', () => {
    expect([...INTERVIEW_ANSWER_KEYS]).toEqual(Object.keys(InterviewAnswersSchema.shape));
    expect(INTERVIEW_ANSWER_KEYS).toHaveLength(9);
  });

  it('missingPrerequisites reports unapproved and missing docs, in order', () => {
    const research = withDocs({
      research: approvedDoc({ markdown: 'm' }) as never,
      avatar: { ...approvedDoc(), approved: false } as never,
    });
    expect(missingPrerequisites(research, 'research')).toEqual([]);
    expect(missingPrerequisites(research, 'avatar')).toEqual([]);
    expect(missingPrerequisites(research, 'offerBrief')).toEqual(['avatar']);
    expect(missingPrerequisites(research, 'beliefs')).toEqual(['avatar', 'offerBrief']);
  });

  it('missingPrerequisites treats stale-but-approved docs as satisfied', () => {
    const research = withDocs({
      research: { ...approvedDoc({ markdown: 'm' }), stale: true } as never,
    });
    expect(missingPrerequisites(research, 'avatar')).toEqual([]);
  });

  it('markDownstreamStale flags only docs after the edited step', () => {
    const research = withDocs({
      research: approvedDoc({ markdown: 'm' }) as never,
      avatar: approvedDoc({ name: 'A' }) as never,
      beliefs: approvedDoc({ beliefs: [] }) as never,
    });
    const result = markDownstreamStale(research, 'avatar');
    expect(result.docs.research?.stale).toBe(false);
    expect(result.docs.avatar?.stale).toBe(false);
    expect(result.docs.beliefs?.stale).toBe(true);
    expect(result.docs.beliefs?.approved).toBe(true);
    // pure: the input is untouched
    expect(research.docs.beliefs?.stale).toBe(false);
  });

  it('markDownstreamStale ignores steps with no doc yet', () => {
    const research = withDocs({ research: approvedDoc({ markdown: 'm' }) as never });
    const result = markDownstreamStale(research, 'research');
    expect(result.docs.avatar).toBeUndefined();
    expect(result.docs.interviews).toBeUndefined();
  });

  it('schema rejects non-http(s) or relative competitor URLs (fetched server-side)', () => {
    for (const bad of ['ftp://x.example', 'file:///etc/passwd', 'not-a-url', 'javascript:alert(1)']) {
      const result = BrandResearchSchema.safeParse({
        siteId: 's',
        updatedAt: NOW,
        inputs: { competitorUrls: [bad] },
      });
      expect(result.success, `should reject ${bad}`).toBe(false);
    }
    const ok = BrandResearchSchema.safeParse({
      siteId: 's',
      updatedAt: NOW,
      inputs: { competitorUrls: ['https://rival.example/vest', 'http://rival2.example'] },
    });
    expect(ok.success).toBe(true);
  });
});

describe('applyBrandResearchPatch', () => {
  const research = () =>
    withDocs({
      research: approvedDoc({ markdown: 'original', productSummary: 'p', marketInsights: ['i'] }) as never,
      avatar: approvedDoc({ name: 'A', demographics: 'd', painPoints: ['p'], desires: ['d'] }) as never,
    });

  it('merges enabled and inputs without touching docs', () => {
    const next = applyBrandResearchPatch(research(), {
      enabled: true,
      inputs: { productDescription: 'vest' },
    });
    expect(next.enabled).toBe(true);
    expect(next.inputs.productDescription).toBe('vest');
    expect(next.docs.research).toEqual(research().docs.research);
  });

  it('a content edit to an upstream doc marks downstream docs stale', () => {
    const base = research();
    const edited = { ...base.docs.research!, markdown: 'edited by user', userEdited: true };
    const next = applyBrandResearchPatch(base, { docs: { research: edited } });
    expect(next.docs.research?.markdown).toBe('edited by user');
    expect(next.docs.avatar?.stale).toBe(true);
    expect(next.docs.avatar?.approved).toBe(true);
  });

  it('an approved-only flip does NOT stale downstream docs', () => {
    const base = research();
    const flipped = { ...base.docs.research!, approved: false };
    const next = applyBrandResearchPatch(base, { docs: { research: flipped } });
    expect(next.docs.research?.approved).toBe(false);
    expect(next.docs.avatar?.stale).toBe(false);
  });

  it('approvalChainViolations flags approved docs whose prerequisites are not approved', () => {
    const base = research();
    const outOfOrder = applyBrandResearchPatch(base, {
      docs: {
        beliefs: {
          generatedAt: NOW, approved: true, userEdited: false, stale: false,
          beliefs: [{ statement: 'I believe that x', currentBelief: '', shiftStrategy: 's' }],
        } as never,
      },
    });
    expect(approvalChainViolations(outOfOrder)).toEqual(['beliefs']);
    expect(approvalChainViolations(base)).toEqual([]);
  });

  it('docs provided in the same patch are considered current, not staled by their upstream', () => {
    const base = research();
    const editedResearch = { ...base.docs.research!, markdown: 'new research' };
    const editedAvatar = { ...base.docs.avatar!, name: 'B (revised)' };
    const next = applyBrandResearchPatch(base, {
      docs: { research: editedResearch, avatar: editedAvatar },
    });
    expect(next.docs.avatar?.stale).toBe(false);
    expect(next.docs.avatar?.name).toBe('B (revised)');
  });
});
