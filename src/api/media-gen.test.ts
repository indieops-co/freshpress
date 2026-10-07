import { describe, expect, it } from 'vitest';
import { buildGroundedImagePrompt } from './media-gen.js';
import { buildDefaultStyleGuide } from '../design/style-guide.js';

describe('buildGroundedImagePrompt', () => {
  it('carries the brand design rules into the image prompt via composeStyleContext', () => {
    const guide = buildDefaultStyleGuide('vercel', 'Vercel', 'monochrome precision');
    guide.designRules = "### Don't\n- Never add a sixth accent color";

    const prompt = buildGroundedImagePrompt('A hero image of a mountain trail', guide);

    expect(prompt).toContain('A hero image of a mountain trail');
    expect(prompt).toContain(guide.aiSystemPromptAddition);
    expect(prompt).toContain("Design rules for this brand (follow the Do's, avoid the Don'ts):");
    expect(prompt).toContain('Never add a sixth accent color');
  });

  it('omits the rules block when the guide has no designRules', () => {
    const guide = buildDefaultStyleGuide('vercel', 'Vercel', 'monochrome precision');

    const prompt = buildGroundedImagePrompt('A hero image', guide);

    expect(prompt).toContain(guide.aiSystemPromptAddition);
    expect(prompt).not.toContain('Design rules for this brand');
  });

  it('still grounds palette and typography from the guide', () => {
    const guide = buildDefaultStyleGuide('vercel', 'Vercel', 'monochrome precision');

    const prompt = buildGroundedImagePrompt('A product shot', guide);

    expect(prompt).toContain(`primary ${guide.colors.primary}`);
    expect(prompt).toContain(`${guide.typography.headingFont} headings`);
  });
});
