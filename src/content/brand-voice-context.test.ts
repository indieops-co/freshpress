import { describe, it, expect } from 'vitest';
import { BRAND_CONTEXT_MAX_CHARS, buildBrandVoiceContext } from './brand-voice-context.js';
import { buildDefaultBrandResearch, type BrandResearch } from './brand-research-types.js';
import type { WritingSkill } from '../humanizer/types.js';

const NOW = '2026-07-07T00:00:00.000Z';

function researchWith(docs: Partial<BrandResearch['docs']>, enabled = true): BrandResearch {
  const research = buildDefaultBrandResearch('site-1', NOW);
  research.enabled = enabled;
  research.docs = { ...research.docs, ...docs };
  return research;
}

function meta(approved: boolean) {
  return { generatedAt: NOW, approved, userEdited: false, stale: false };
}

const approvedDocs: Partial<BrandResearch['docs']> = {
  voiceSummary: { ...meta(true), summary: 'Plain-spoken, slightly surprised-it-works tone.' },
  beliefs: {
    ...meta(true),
    beliefs: [{ statement: 'I believe that walking alone has plateaued', currentBelief: '', shiftStrategy: 's' }],
  },
  interviews: {
    ...meta(true),
    customers: [
      {
        name: 'Warren',
        context: '55',
        answers: {
          discoveryChannel: 'fb', painPoint: 'p', trigger: 't', alternatives: 'a', objections: 'o',
          conversionTrigger: 'c', desiredOutcome: 'd', usagePlan: 'u',
          customerQuote: 'Honestly it just makes my normal walk count for more',
        },
      },
    ],
    clusters: [{ label: 'Walkers', avatarType: 'walker', members: ['Warren'], themes: [] }],
  },
};

describe('buildBrandVoiceContext', () => {
  it('returns undefined when there is nothing approved to say', () => {
    expect(buildBrandVoiceContext({})).toBeUndefined();
    expect(buildBrandVoiceContext({ brandResearch: researchWith({}) })).toBeUndefined();
  });

  it('composes voice summary, beliefs, and golden quotes from approved docs', () => {
    const block = buildBrandVoiceContext({ brandResearch: researchWith(approvedDocs) });
    expect(block).toContain('Plain-spoken');
    expect(block).toContain('I believe that walking alone has plateaued');
    expect(block).toContain('makes my normal walk count for more');
  });

  it('unapproved docs contribute NOTHING (unreviewed research must not steer content)', () => {
    const block = buildBrandVoiceContext({
      brandResearch: researchWith({
        voiceSummary: { ...meta(false), summary: 'UNREVIEWED SUMMARY' },
        beliefs: approvedDocs.beliefs,
      }),
    });
    expect(block).not.toContain('UNREVIEWED SUMMARY');
    expect(block).toContain('I believe that');
  });

  it('a disabled research feature contributes nothing even with approved docs', () => {
    expect(
      buildBrandVoiceContext({ brandResearch: researchWith(approvedDocs, false) })
    ).toBeUndefined();
  });

  it('brand voice skill (never-say + sample) works standalone', () => {
    const skill: WritingSkill = {
      samples: [{ id: 's1', text: 'We keep it plain and honest.', addedAt: NOW }],
      neverPhrases: ['game-changer', 'unlock'],
    };
    const block = buildBrandVoiceContext({ brandVoiceSkill: skill });
    expect(block).toContain('Never say: game-changer; unlock');
    expect(block).toContain('We keep it plain and honest.');
  });

  it('never-say survives a long voice summary (hard constraints outrank prose under the cap)', () => {
    const skill: WritingSkill = {
      samples: [{ id: 's1', text: 'y'.repeat(3000), addedAt: NOW }],
      neverPhrases: ['game-changer'],
    };
    const block = buildBrandVoiceContext({
      brandResearch: researchWith({
        voiceSummary: { ...meta(true), summary: 'x'.repeat(1400) },
      }),
      brandVoiceSkill: skill,
    });
    expect(block).toContain('Never say: game-changer');
    expect(block!.length).toBeLessThanOrEqual(BRAND_CONTEXT_MAX_CHARS);
  });

  it('an approved-but-empty voice summary contributes no dangling header', () => {
    const block = buildBrandVoiceContext({
      brandResearch: researchWith({
        voiceSummary: { ...meta(true), summary: '   ' },
        beliefs: approvedDocs.beliefs,
      }),
    });
    expect(block).not.toContain('Brand voice & strategy');
    expect(block).toContain('I believe that');
  });

  it('clips a single oversized first section instead of returning nothing', () => {
    const skill: WritingSkill = {
      samples: [],
      neverPhrases: [`${'z'.repeat(3000)}`],
    };
    const block = buildBrandVoiceContext({ brandVoiceSkill: skill });
    expect(block).toBeDefined();
    expect(block!.length).toBeLessThanOrEqual(BRAND_CONTEXT_MAX_CHARS);
    expect(block).toContain('Never say');
  });

  it('stays within the cap by dropping whole trailing sections', () => {
    const skill: WritingSkill = {
      samples: [{ id: 's1', text: 'y'.repeat(3000), addedAt: NOW }],
      neverPhrases: [],
    };
    const block = buildBrandVoiceContext({
      brandResearch: researchWith({
        voiceSummary: { ...meta(true), summary: 'x'.repeat(1400) },
      }),
      brandVoiceSkill: skill,
    });
    expect(block).toBeDefined();
    expect(block!.length).toBeLessThanOrEqual(BRAND_CONTEXT_MAX_CHARS);
    expect(block).toContain('x'.repeat(100));
  });
});
