/**
 * Deep Brand Research (opt-in, per-site) — data model for the five-document research
 * wizard adapted from the Multiply e-commerce methodology: Research → Customer Avatar →
 * Offer Brief → Necessary Beliefs → Simulated Interviews, distilled into a voiceSummary
 * that enriches social/page generation. Docs are generated one at a time; each step's
 * prerequisites must be approved first, and editing/regenerating an upstream doc marks
 * everything downstream stale (still usable, flagged for regeneration in the UI).
 */
import { z } from 'zod';

export const BRAND_RESEARCH_STEPS = [
  'research',
  'avatar',
  'offerBrief',
  'beliefs',
  'interviews',
  'voiceSummary',
] as const;

export const BrandResearchStepSchema = z.enum(BRAND_RESEARCH_STEPS);
export type BrandResearchStep = z.infer<typeof BrandResearchStepSchema>;

/** Max chars for the distilled generation-context block — enforced in the schema, so every save path inherits it. */
export const VOICE_SUMMARY_MAX_CHARS = 1500;

/** The simulation prompt asks for exactly this many distinct customers (per the call-simulation template). */
export const INTERVIEW_CUSTOMER_COUNT = 10;

/**
 * Validation tolerance around INTERVIEW_CUSTOMER_COUNT — a 9- or 11-customer generation
 * is still usable research; hard-rejecting it would burn a full regeneration.
 */
export const INTERVIEW_CUSTOMER_MIN = 8;
export const INTERVIEW_CUSTOMER_MAX = 12;

/** Necessary-beliefs doc carries at most six "I believe that…" statements. */
export const MAX_BELIEFS = 6;

const docMeta = {
  generatedAt: z.string(),
  model: z.string().optional(),
  approved: z.boolean().default(false),
  userEdited: z.boolean().default(false),
  stale: z.boolean().default(false),
};

export const ResearchDocSchema = z.object({
  ...docMeta,
  /** The full research document body. */
  markdown: z.string(),
  productSummary: z.string().default(''),
  marketInsights: z.array(z.string()).default([]),
  competitorNotes: z.array(z.string()).default([]),
  /** Verbatim phrases customers use about this problem/product — copy gold. */
  customerLanguage: z.array(z.string()).default([]),
  /** Angles/hooks/claims deconstructed from winning-video transcripts and competitor pages. */
  provenAngles: z.array(z.string()).default([]),
});
export type ResearchDoc = z.infer<typeof ResearchDocSchema>;

export const AvatarDocSchema = z.object({
  ...docMeta,
  /** Short label, e.g. "Walking Warren, 55 — retired, walks 4 miles a day". */
  name: z.string().default(''),
  demographics: z.string().default(''),
  psychographics: z.string().default(''),
  painPoints: z.array(z.string()).default([]),
  desires: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
  /** How this person actually talks about the problem, in their words. */
  quotes: z.array(z.string()).default([]),
});
export type AvatarDoc = z.infer<typeof AvatarDocSchema>;

export const OfferBriefDocSchema = z.object({
  ...docMeta,
  uniqueMechanism: z.string().default(''),
  positioning: z.string().default(''),
  usps: z.array(z.string()).default([]),
  guarantees: z.array(z.string()).default([]),
  pricingFrame: z.string().default(''),
  differentiation: z.array(z.string()).default([]),
});
export type OfferBriefDoc = z.infer<typeof OfferBriefDocSchema>;

export const BeliefSchema = z.object({
  /** Phrased from the customer's mouth: "I believe that…". */
  statement: z.string(),
  /** What the prospect believes today, before any persuasion. */
  currentBelief: z.string().default(''),
  /** How content shifts them from currentBelief to statement. */
  shiftStrategy: z.string().default(''),
});
export type Belief = z.infer<typeof BeliefSchema>;

export const BeliefsDocSchema = z.object({
  ...docMeta,
  beliefs: z.array(BeliefSchema).max(MAX_BELIEFS),
});
export type BeliefsDoc = z.infer<typeof BeliefsDocSchema>;

/** One simulated customer's answers to the 9-question call script, keyed by sheet column. */
export const InterviewAnswersSchema = z.object({
  discoveryChannel: z.string(),
  painPoint: z.string(),
  trigger: z.string(),
  alternatives: z.string(),
  objections: z.string(),
  conversionTrigger: z.string(),
  desiredOutcome: z.string(),
  usagePlan: z.string(),
  /** The "golden question" — what they'd tell a friend. The single best source of copy. */
  customerQuote: z.string(),
});
export type InterviewAnswers = z.infer<typeof InterviewAnswersSchema>;

export const INTERVIEW_ANSWER_KEYS = Object.keys(
  InterviewAnswersSchema.shape
) as Array<keyof InterviewAnswers>;

export const InterviewCustomerSchema = z.object({
  name: z.string(),
  /** One line: age, situation. */
  context: z.string().default(''),
  answers: InterviewAnswersSchema,
});
export type InterviewCustomer = z.infer<typeof InterviewCustomerSchema>;

export const InterviewClusterSchema = z.object({
  label: z.string(),
  avatarType: z.string().default(''),
  /** Customer names belonging to this cluster. */
  members: z.array(z.string()),
  themes: z.array(z.string()).default([]),
});
export type InterviewCluster = z.infer<typeof InterviewClusterSchema>;

export const InterviewsDocSchema = z.object({
  ...docMeta,
  customers: z.array(InterviewCustomerSchema),
  clusters: z.array(InterviewClusterSchema),
});
export type InterviewsDoc = z.infer<typeof InterviewsDocSchema>;

export const VoiceSummaryDocSchema = z.object({
  ...docMeta,
  /** Compact block written for prompt injection — the cap protects the generation-prompt budget. */
  summary: z.string().max(VOICE_SUMMARY_MAX_CHARS),
});
export type VoiceSummaryDoc = z.infer<typeof VoiceSummaryDocSchema>;

export const TranscriptInputSchema = z.object({
  id: z.string(),
  label: z.string().default(''),
  text: z.string(),
  addedAt: z.string(),
});
export type TranscriptInput = z.infer<typeof TranscriptInputSchema>;

/** Absolute http(s) URLs only — these are fetched server-side, so reject other schemes at the schema. */
const HttpUrlSchema = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be an absolute http(s) URL' }
);

export const BrandResearchInputsSchema = z.object({
  productDescription: z.string().default(''),
  /** Competitor sales/product pages to deconstruct (fetched via the brand-extract path). */
  competitorUrls: z.array(HttpUrlSchema).default([]),
  /** Pasted winning-video transcripts (found via Kalodata etc., transcribed externally). */
  transcripts: z.array(TranscriptInputSchema).default([]),
});
export type BrandResearchInputs = z.infer<typeof BrandResearchInputsSchema>;

/** Per-step schema registry — how the API parses an incoming doc for a given step. */
export const BRAND_RESEARCH_DOC_SCHEMAS = {
  research: ResearchDocSchema,
  avatar: AvatarDocSchema,
  offerBrief: OfferBriefDocSchema,
  beliefs: BeliefsDocSchema,
  interviews: InterviewsDocSchema,
  voiceSummary: VoiceSummaryDocSchema,
} as const;

export const BrandResearchDocsSchema = z.object({
  research: ResearchDocSchema.optional(),
  avatar: AvatarDocSchema.optional(),
  offerBrief: OfferBriefDocSchema.optional(),
  beliefs: BeliefsDocSchema.optional(),
  interviews: InterviewsDocSchema.optional(),
  voiceSummary: VoiceSummaryDocSchema.optional(),
});
export type BrandResearchDocs = z.infer<typeof BrandResearchDocsSchema>;

export const BrandResearchSchema = z.object({
  siteId: z.string(),
  /** The opt-in switch — hidden research tabs appear in the editor only when true. */
  enabled: z.boolean().default(false),
  inputs: BrandResearchInputsSchema.default({}),
  docs: BrandResearchDocsSchema.default({}),
  updatedAt: z.string(),
});
export type BrandResearch = z.infer<typeof BrandResearchSchema>;

export function buildDefaultBrandResearch(siteId: string, now: string): BrandResearch {
  return BrandResearchSchema.parse({ siteId, updatedAt: now });
}

/**
 * Every step requires all earlier steps approved — the docs form a strict chain, so the
 * prerequisites are simply the steps before `step` in BRAND_RESEARCH_STEPS order.
 */
export function stepPrerequisites(step: BrandResearchStep): readonly BrandResearchStep[] {
  return BRAND_RESEARCH_STEPS.slice(0, BRAND_RESEARCH_STEPS.indexOf(step));
}

/** Prerequisite steps whose doc is missing or unapproved (stale docs still count as approved). */
export function missingPrerequisites(
  research: BrandResearch,
  step: BrandResearchStep
): BrandResearchStep[] {
  return stepPrerequisites(step).filter((prereq) => !research.docs[prereq]?.approved);
}

/**
 * Steps whose doc is approved while an earlier step isn't — the chain invariant the
 * generate path enforces via missingPrerequisites; save paths must reject these too,
 * or a PUT could approve out of order and downstream enrichment would trust it.
 */
export function approvalChainViolations(research: BrandResearch): BrandResearchStep[] {
  return BRAND_RESEARCH_STEPS.filter(
    (step) => research.docs[step]?.approved && missingPrerequisites(research, step).length > 0
  );
}

/** Generic so TS correlates the read and write on the same key — no union-write cast needed. */
function setDocStale<S extends BrandResearchStep>(docs: BrandResearchDocs, step: S): void {
  const doc = docs[step];
  if (doc) docs[step] = { ...doc, stale: true } as typeof doc;
}

/** Set one step's doc without the union-write cast trap (see setDocStale). */
export function setResearchDoc<S extends BrandResearchStep>(
  research: BrandResearch,
  step: S,
  doc: NonNullable<BrandResearchDocs[S]>
): BrandResearch {
  return { ...research, docs: { ...research.docs, [step]: doc } };
}

/** Same, for a bare docs map (e.g. accumulating a PUT patch) — avoids `as never` at call sites. */
export function setDocEntry<S extends BrandResearchStep>(
  docs: Partial<BrandResearchDocs>,
  step: S,
  doc: NonNullable<BrandResearchDocs[S]>
): void {
  docs[step] = doc;
}

/** A doc's content identity — everything except the review/lifecycle meta. */
function docContent(doc: NonNullable<BrandResearchDocs[BrandResearchStep]>): string {
  const { generatedAt, model, approved, userEdited, stale, ...content } = doc;
  return JSON.stringify(content);
}

export interface BrandResearchPatch {
  enabled?: boolean;
  inputs?: Partial<BrandResearchInputs>;
  docs?: Partial<BrandResearchDocs>;
}

/**
 * Pure: apply a client PUT patch. Docs are replaced whole; a doc whose CONTENT changed
 * (not just approved/stale flips) marks everything downstream stale, mirroring
 * regeneration. The caller Zod-parses the result on save.
 */
export function applyBrandResearchPatch(
  research: BrandResearch,
  patch: BrandResearchPatch
): BrandResearch {
  let next: BrandResearch = {
    ...research,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : research.enabled,
    inputs: patch.inputs ? { ...research.inputs, ...patch.inputs } : research.inputs,
  };
  for (const step of BRAND_RESEARCH_STEPS) {
    const incoming = patch.docs?.[step];
    if (!incoming) continue;
    const existing = research.docs[step];
    const contentChanged = !existing || docContent(existing) !== docContent(incoming);
    next = setResearchDoc(next, step, incoming);
    if (contentChanged) next = markDownstreamStale(next, step);
  }
  return next;
}

/**
 * Pure: returns a copy with every doc downstream of `step` flagged stale (the doc itself
 * is untouched). Call after an upstream doc is edited or regenerated.
 */
export function markDownstreamStale(
  research: BrandResearch,
  step: BrandResearchStep
): BrandResearch {
  const stepIndex = BRAND_RESEARCH_STEPS.indexOf(step);
  const docs: BrandResearchDocs = { ...research.docs };
  for (const downstream of BRAND_RESEARCH_STEPS.slice(stepIndex + 1)) {
    setDocStale(docs, downstream);
  }
  return { ...research, docs };
}
