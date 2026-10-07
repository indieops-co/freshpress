import { resolveAiKeys } from '../integrations/resolve.js';
import { callAiText } from '../ai/call-json.js';
import { parseDesignMdHeuristic } from './parse-design-md.js';
import { designMdAuthoringExcellence } from './design-excellence.js';
import { generateCssVariables, StyleGuideSchema, type StyleGuide } from './style-guide.js';
import { mergeExtractedBrand, sourceFromExtraction, type ExtractedBrand } from './brand-extract.js';
import { nanoid } from 'nanoid';

export interface DesignIntakeInput {
  brandName: string;
  industry?: string;
  personality: string[];
  targetAudience?: string;
  colorPreferences?: string;
  referenceUrls?: string[];
  existingBrandNotes?: string;
  moodKeywords?: string[];
}

/**
 * System prompt for the DESIGN.md authoring call — the one place the AI
 * invents a visual identity from scratch, so the design-excellence
 * fundamentals are injected here. Exported as a pure builder so prompt
 * content is unit-testable without touching the network.
 */
export function buildDesignMdSystemPrompt(): string {
  return `You are an expert brand designer and design systems architect.

Your task is to create a complete, professional DESIGN.md document that defines a cohesive visual identity.

${designMdAuthoringExcellence()}

The brand's own stated inputs (color preferences, personality, mood, references, existing notes) always win over these fundamentals — never override what the brief states.

The DESIGN.md must follow this exact 9-section structure:

# [Brand Name] Design System

## 1. Visual Theme & Atmosphere
Describe the overall mood, design philosophy, density, and visual character in 2–4 sentences, including the signature visual element this brand will be remembered by.

## 2. Color Palette & Roles
List colors as: **Name** — \`#hex\` — Role description
Include: primary, secondary, accent, background, surface, text, text-muted, border, success, warning, error.

## 3. Typography Rules
- Heading font: [Font Name]
- Body font: [Font Name]
- Include a hierarchy table with sizes and weights for display-lg, display-md, h1, h2, h3, h4, body-lg, body, body-sm, caption, label.

## 4. Component Styling
Define: Buttons (primary, secondary, CTA), Cards, Navigation (style, background), Hero (layout, headline treatment), Footer. Show how the signature element carries through components.

## 5. Layout Principles
Spacing scale, max container width, grid columns, whitespace philosophy.

## 6. Depth & Elevation
Shadow system (sm, md, lg, glow), surface hierarchy.

## 7. Do's and Don'ts
5–8 guardrails specific to THIS brand, as Do and Don't bullet lists. Make each one concrete enough to settle a real design argument (name the exact colors, treatments, or scales it protects) — never generic advice.

## 8. Responsive Behavior
Key breakpoints, touch targets, collapsing strategy.

## 9. Agent Prompt Guide
A 2–3 sentence brand-voice summary an AI agent can prepend to any image or UI generation prompt for this brand.

Output ONLY the DESIGN.md markdown. No preamble, no JSON, no commentary.`;
}

function buildIntakePrompt(intake: DesignIntakeInput): string {
  const lines: string[] = [
    `Brand name: ${intake.brandName}`,
  ];
  if (intake.industry) lines.push(`Industry: ${intake.industry}`);
  if (intake.personality.length > 0) lines.push(`Brand personality: ${intake.personality.join(', ')}`);
  if (intake.targetAudience) lines.push(`Target audience: ${intake.targetAudience}`);
  if (intake.colorPreferences) lines.push(`Color preferences: ${intake.colorPreferences}`);
  if (intake.moodKeywords && intake.moodKeywords.length > 0) lines.push(`Mood keywords: ${intake.moodKeywords.join(', ')}`);
  if (intake.referenceUrls && intake.referenceUrls.length > 0) lines.push(`Visual references: ${intake.referenceUrls.join(', ')}`);
  if (intake.existingBrandNotes) lines.push(`\nExisting brand notes:\n${intake.existingBrandNotes}`);

  return `Generate a complete DESIGN.md for this brand:\n\n${lines.join('\n')}`;
}

export async function generateDesignMd(intake: DesignIntakeInput): Promise<string> {
  const ai = await resolveAiKeys();
  if (!ai) {
    throw new Error('No AI provider configured. Add an Anthropic or OpenRouter key in Admin → Integrations.');
  }

  // A truncated DESIGN.md silently loses its trailing sections — including
  // Do's and Don'ts (section 7), which designRules extraction depends on —
  // so the generous budget and callAiText's truncation guard both matter here.
  const rawText = await callAiText(buildDesignMdSystemPrompt(), buildIntakePrompt(intake), ai, { maxTokens: 8192 });

  if (!rawText.trim()) {
    throw new Error('AI returned an empty response. Try again or add more brand details.');
  }

  return rawText;
}

/**
 * Full pipeline: intake → DESIGN.md text → StyleGuide.
 * Falls back to the heuristic parser if the AI parse fails.
 */
export async function generateStyleGuideFromIntake(
  intake: DesignIntakeInput,
  siteId: string,
  opts?: { extracted?: ExtractedBrand }
): Promise<{ rawDesignMd: string; styleGuide: StyleGuide }> {
  // Amendment F: when a brand was extracted from a URL, fold it in as high-priority
  // evidence (colors/fonts/logo) before generation, and record the extraction as the
  // guide's provenance. The generator still fills whatever extraction couldn't.
  const effectiveIntake = opts?.extracted ? mergeExtractedBrand(intake, opts.extracted) : intake;
  const source = sourceFromExtraction(opts?.extracted) ?? ('manual' as const);

  const rawDesignMd = await generateDesignMd(effectiveIntake);

  const themeId = `custom_${nanoid(8)}`;
  const aesthetic = [
    ...intake.personality,
    ...(intake.moodKeywords ?? []),
    intake.industry ?? '',
  ]
    .filter(Boolean)
    .join(', ');

  let styleGuide: StyleGuide;
  try {
    const { parseDesignMd } = await import('./parse-design-md.js');
    styleGuide = await parseDesignMd(rawDesignMd, themeId, intake.brandName, aesthetic);
  } catch {
    styleGuide = parseDesignMdHeuristic(rawDesignMd, themeId, intake.brandName, aesthetic);
  }

  // Override meta to mark this as a custom-generated guide
  styleGuide = StyleGuideSchema.parse({
    ...styleGuide,
    meta: {
      ...styleGuide.meta,
      source,
      sourceRef: siteId,
      name: intake.brandName,
      aesthetic,
      designPhilosophy: intake.personality.join(', ') || styleGuide.meta.designPhilosophy,
      createdAt: new Date().toISOString(),
    },
  });

  if (!styleGuide.cssVariables) {
    styleGuide = { ...styleGuide, cssVariables: generateCssVariables(styleGuide) };
  }

  return { rawDesignMd, styleGuide };
}
