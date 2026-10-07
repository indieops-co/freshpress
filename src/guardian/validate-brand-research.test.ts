import { describe, it, expect } from 'vitest';
import { validateBrandResearchDoc } from './validate-brand-research.js';
import {
  INTERVIEW_CUSTOMER_COUNT,
  INTERVIEW_CUSTOMER_MIN,
  type AvatarDoc,
  type BeliefsDoc,
  type InterviewsDoc,
  type OfferBriefDoc,
  type ResearchDoc,
  type VoiceSummaryDoc,
} from '../content/brand-research-types.js';

const NOW = '2026-07-07T00:00:00.000Z';
const meta = { generatedAt: NOW, approved: false, userEdited: false, stale: false };

const validResearch: ResearchDoc = {
  ...meta,
  markdown: 'x'.repeat(600),
  productSummary: 'A weighted vest for daily walkers who want more from their walks.',
  marketInsights: ['Walking is the dominant exercise for 45+ buyers'],
  competitorNotes: ['Amazon vests are bulky and slip'],
  customerLanguage: ['"you don\'t even notice it\'s there"'],
  provenAngles: [],
};

const validAvatar: AvatarDoc = {
  ...meta,
  name: 'Walking Warren, 55',
  demographics: '50–65, suburban, retired or close to it',
  psychographics: 'Health-conscious but gym-averse; walks daily',
  painPoints: ['Walks feel like they stopped working'],
  desires: ['Burn more calories without changing routine'],
  objections: ['Will it be bulky under a shirt?'],
  triggers: ['Scale after the holidays'],
  quotes: ['"is this even doing anything?"'],
};

const validOffer: OfferBriefDoc = {
  ...meta,
  uniqueMechanism: 'Slim-profile weight distribution — invisible under a size-up shirt',
  positioning: 'The weighted vest for people who walk, not lift',
  usps: ['Wearable all day', 'Not gym equipment'],
  guarantees: ['30-day results guarantee'],
  pricingFrame: 'Cheaper than a month of gym membership',
  differentiation: ['Slimmer than Amazon vests'],
};

const validBeliefs: BeliefsDoc = {
  ...meta,
  beliefs: [
    {
      statement: 'I believe that walking alone has stopped giving me results',
      currentBelief: 'Walking is enough',
      shiftStrategy: 'Show the plateau effect and the added-resistance fix',
    },
    {
      statement: 'I believe that a weighted vest fits my existing routine',
      currentBelief: 'Extra equipment means extra effort',
      shiftStrategy: 'Demonstrate wearing it invisibly on normal walks',
    },
  ],
};

function buildInterviews(): InterviewsDoc {
  const customers = Array.from({ length: INTERVIEW_CUSTOMER_COUNT }, (_, i) => ({
    name: `Customer ${i + 1}`,
    context: `${40 + i}, walks daily`,
    answers: {
      discoveryChannel: 'Facebook ad',
      painPoint: 'Walks stopped moving the scale',
      trigger: 'Got on the scale after the holidays',
      alternatives: 'Looked at Amazon vests',
      objections: 'Worried it would be bulky',
      conversionTrigger: 'The guarantee',
      desiredOutcome: 'Lose the weight I put on',
      usagePlan: 'Morning walk with the dog',
      customerQuote: 'Honestly it just makes my normal walk count for more',
    },
  }));
  const names = customers.map((c) => c.name);
  return {
    ...meta,
    customers,
    clusters: [
      { label: 'Daily walkers', avatarType: 'Routine walker', members: names.slice(0, 4), themes: ['routine'] },
      { label: 'Post-holiday resets', avatarType: 'Trigger buyer', members: names.slice(4, 7), themes: ['scale moment'] },
      { label: 'Runners adding load', avatarType: 'Performance', members: names.slice(7), themes: ['endurance'] },
    ],
  };
}

const validVoiceSummary: VoiceSummaryDoc = {
  ...meta,
  summary: 'Plain-spoken, slightly surprised-it-works tone. Core beliefs: walking plateaus without resistance…',
};

describe('validateBrandResearchDoc — accepts valid docs', () => {
  it('research', () => expect(validateBrandResearchDoc('research', validResearch).ok).toBe(true));
  it('avatar', () => expect(validateBrandResearchDoc('avatar', validAvatar).ok).toBe(true));
  it('offerBrief', () => expect(validateBrandResearchDoc('offerBrief', validOffer).ok).toBe(true));
  it('beliefs', () => expect(validateBrandResearchDoc('beliefs', validBeliefs).ok).toBe(true));
  it('interviews', () => expect(validateBrandResearchDoc('interviews', buildInterviews()).ok).toBe(true));
  it('voiceSummary', () => expect(validateBrandResearchDoc('voiceSummary', validVoiceSummary).ok).toBe(true));
});

describe('validateBrandResearchDoc — rejects malformed docs', () => {
  it('research: stub markdown and no insights', () => {
    const result = validateBrandResearchDoc('research', {
      ...validResearch,
      markdown: 'too short',
      marketInsights: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/at least 500 characters/);
    expect(result.errors.join(' ')).toMatch(/market insight/);
  });

  it('avatar: missing pains/desires', () => {
    const result = validateBrandResearchDoc('avatar', { ...validAvatar, painPoints: [], desires: [] });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('offerBrief: no mechanism and no USPs', () => {
    const result = validateBrandResearchDoc('offerBrief', { ...validOffer, uniqueMechanism: ' ', usps: [] });
    expect(result.ok).toBe(false);
  });

  it('beliefs: wrong phrasing and missing shift strategy', () => {
    const result = validateBrandResearchDoc('beliefs', {
      ...validBeliefs,
      beliefs: [{ statement: 'Walking is great', currentBelief: '', shiftStrategy: '' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/"I believe…"/);
    expect(result.errors.join(' ')).toMatch(/shiftStrategy/);
  });

  it('beliefs: empty list', () => {
    expect(validateBrandResearchDoc('beliefs', { ...validBeliefs, beliefs: [] }).ok).toBe(false);
  });

  it('interviews: customer count below the tolerance band', () => {
    const doc = buildInterviews();
    doc.customers = doc.customers.slice(0, INTERVIEW_CUSTOMER_MIN - 1);
    doc.clusters = [{ label: 'All', avatarType: '', members: doc.customers.map((c) => c.name), themes: [] }];
    const result = validateBrandResearchDoc('interviews', doc);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/between 8 and 12 customers/);
  });

  it('interviews: 9 customers is within the tolerance band (no full-regeneration burn)', () => {
    const doc = buildInterviews();
    const dropped = doc.customers[doc.customers.length - 1].name;
    doc.customers = doc.customers.slice(0, INTERVIEW_CUSTOMER_COUNT - 1);
    doc.clusters = doc.clusters.map((c) => ({ ...c, members: c.members.filter((m) => m !== dropped) }));
    expect(validateBrandResearchDoc('interviews', doc).ok).toBe(true);
  });

  it('interviews: tolerates stray whitespace in names and cluster members (LLM output)', () => {
    const doc = buildInterviews();
    doc.customers[0].name = ' Customer 1 ';
    doc.clusters[0].members[1] = `${doc.clusters[0].members[1]} `;
    expect(validateBrandResearchDoc('interviews', doc).ok).toBe(true);
  });

  it('interviews: whitespace-differing duplicate names are still duplicates', () => {
    const doc = buildInterviews();
    doc.customers[1].name = ' Customer 1';
    const result = validateBrandResearchDoc('interviews', doc);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/duplicate customer name "Customer 1"/);
  });

  it('interviews: empty answer, unknown cluster member, unclustered customer', () => {
    const doc = buildInterviews();
    doc.customers[0].answers.customerQuote = ' ';
    doc.clusters[0].members = doc.clusters[0].members.slice(1).concat('Nobody');
    const result = validateBrandResearchDoc('interviews', doc);
    expect(result.ok).toBe(false);
    const joined = result.errors.join(' ');
    expect(joined).toMatch(/empty answer for "customerQuote"/);
    expect(joined).toMatch(/unknown customer "Nobody"/);
    expect(joined).toMatch(/"Customer 1" is not assigned to any cluster/);
  });

  it('interviews: duplicate cluster membership', () => {
    const doc = buildInterviews();
    doc.clusters[1].members.push(doc.clusters[0].members[0]);
    const result = validateBrandResearchDoc('interviews', doc);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/more than one cluster/);
  });

  it('voiceSummary: whitespace-only summary is empty', () => {
    const result = validateBrandResearchDoc('voiceSummary', { ...validVoiceSummary, summary: '  \n ' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/must not be empty/);
  });
});
