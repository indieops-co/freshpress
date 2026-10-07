import { describe, it, expect } from 'vitest';
import { HumanizerSiteConfigSchema, EmailReplySkillSchema } from './types.js';

describe('EmailReplySkillSchema', () => {
  it('parses samples and neverPhrases', () => {
    const skill = EmailReplySkillSchema.parse({
      samples: [{ id: 's1', text: 'Thanks for reaching out!', addedAt: '2026-01-01T00:00:00Z' }],
      neverPhrases: ['circle back', 'per my last email'],
    });
    expect(skill.samples).toHaveLength(1);
    expect(skill.neverPhrases).toContain('circle back');
  });

  it('defaults to empty arrays when omitted', () => {
    const skill = EmailReplySkillSchema.parse({});
    expect(skill.samples).toEqual([]);
    expect(skill.neverPhrases).toEqual([]);
  });
});

describe('HumanizerSiteConfigSchema with emailReplySkill', () => {
  it('is backward compatible — parses configs saved before this field existed', () => {
    const config = HumanizerSiteConfigSchema.parse({
      siteId: 'site1',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(config.emailReplySkill).toBeUndefined();
  });

  it('round-trips an emailReplySkill', () => {
    const config = HumanizerSiteConfigSchema.parse({
      siteId: 'site1',
      updatedAt: '2026-01-01T00:00:00Z',
      emailReplySkill: { samples: [], neverPhrases: ['reaching out'] },
    });
    expect(config.emailReplySkill?.neverPhrases).toEqual(['reaching out']);
  });
});
