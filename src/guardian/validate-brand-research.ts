/**
 * Focused validator for AI-generated brand-research docs, mirroring
 * validate-generated-page.ts: a malformed generation must never be persisted, so the
 * generate endpoint and any save path write through this. It checks the semantic
 * contract each step's prompt promises — Zod already guarantees shape and size caps
 * (belief count, voiceSummary length); this guards content (belief phrasing, interview
 * completeness, cluster integrity).
 */
import {
  INTERVIEW_ANSWER_KEYS,
  INTERVIEW_CUSTOMER_COUNT,
  INTERVIEW_CUSTOMER_MAX,
  INTERVIEW_CUSTOMER_MIN,
  type AvatarDoc,
  type BeliefsDoc,
  type BrandResearchDocs,
  type BrandResearchStep,
  type InterviewsDoc,
  type OfferBriefDoc,
  type ResearchDoc,
  type VoiceSummaryDoc,
} from '../content/brand-research-types.js';

export interface BrandResearchValidation {
  ok: boolean;
  errors: string[];
}

type PushError = (msg: string) => void;

/** A research document should be substantive, not a stub paragraph. */
const MIN_RESEARCH_CHARS = 500;

function validateResearch(doc: ResearchDoc, push: PushError): void {
  if (doc.markdown.trim().length < MIN_RESEARCH_CHARS) {
    push(`research markdown must be at least ${MIN_RESEARCH_CHARS} characters of real content`);
  }
  if (doc.productSummary.trim() === '') push('research productSummary must not be empty');
  if (doc.marketInsights.length === 0) push('research must include at least one market insight');
}

function validateAvatar(doc: AvatarDoc, push: PushError): void {
  if (doc.name.trim() === '') push('avatar name must not be empty');
  if (doc.demographics.trim() === '') push('avatar demographics must not be empty');
  if (doc.painPoints.length === 0) push('avatar must include at least one pain point');
  if (doc.desires.length === 0) push('avatar must include at least one desire');
}

function validateOfferBrief(doc: OfferBriefDoc, push: PushError): void {
  if (doc.positioning.trim() === '') push('offerBrief positioning must not be empty');
  if (doc.uniqueMechanism.trim() === '' && doc.usps.length === 0) {
    push('offerBrief must include a uniqueMechanism or at least one USP');
  }
}

function validateBeliefs(doc: BeliefsDoc, push: PushError): void {
  if (doc.beliefs.length === 0) push('beliefs doc must include at least one belief');
  doc.beliefs.forEach((belief, i) => {
    if (!/^i believe\b/i.test(belief.statement.trim())) {
      push(`belief ${i + 1} statement must be phrased "I believe…" (got "${belief.statement.slice(0, 40)}")`);
    }
    if (belief.shiftStrategy.trim() === '') push(`belief ${i + 1} is missing its shiftStrategy`);
  });
}

function validateInterviews(doc: InterviewsDoc, push: PushError): void {
  if (
    doc.customers.length < INTERVIEW_CUSTOMER_MIN ||
    doc.customers.length > INTERVIEW_CUSTOMER_MAX
  ) {
    push(
      `interviews must simulate between ${INTERVIEW_CUSTOMER_MIN} and ${INTERVIEW_CUSTOMER_MAX} customers ` +
        `(target ${INTERVIEW_CUSTOMER_COUNT}, got ${doc.customers.length})`
    );
  }

  // Names are compared trimmed throughout — LLMs routinely emit stray whitespace, and an
  // untrimmed mismatch would produce false "unknown customer" integrity errors.
  const names = new Set<string>();
  doc.customers.forEach((customer, i) => {
    const name = customer.name.trim();
    if (name === '') push(`customer ${i + 1} has an empty name`);
    else if (names.has(name)) push(`duplicate customer name "${name}" (cluster members would be ambiguous)`);
    else names.add(name);
    for (const key of INTERVIEW_ANSWER_KEYS) {
      if (customer.answers[key].trim() === '') {
        push(`customer "${name || i + 1}" has an empty answer for "${key}"`);
      }
    }
  });

  if (doc.clusters.length === 0) push('interviews must include at least one cluster');
  const clustered = new Set<string>();
  doc.clusters.forEach((cluster, i) => {
    if (cluster.label.trim() === '') push(`cluster ${i + 1} has an empty label`);
    if (cluster.members.length === 0) push(`cluster "${cluster.label || i + 1}" has no members`);
    for (const rawMember of cluster.members) {
      const member = rawMember.trim();
      if (!names.has(member)) push(`cluster "${cluster.label}" references unknown customer "${member}"`);
      if (clustered.has(member)) push(`customer "${member}" appears in more than one cluster`);
      clustered.add(member);
    }
  });
  for (const name of names) {
    if (!clustered.has(name)) push(`customer "${name}" is not assigned to any cluster`);
  }
}

function validateVoiceSummary(doc: VoiceSummaryDoc, push: PushError): void {
  if (doc.summary.trim() === '') push('voiceSummary must not be empty');
}

/**
 * Exhaustive by construction: a new step in BRAND_RESEARCH_STEPS fails to compile here
 * until it gets a validator, and a call site can't pair a step with the wrong doc type.
 */
const VALIDATORS: {
  [S in BrandResearchStep]: (doc: NonNullable<BrandResearchDocs[S]>, push: PushError) => void;
} = {
  research: validateResearch,
  avatar: validateAvatar,
  offerBrief: validateOfferBrief,
  beliefs: validateBeliefs,
  interviews: validateInterviews,
  voiceSummary: validateVoiceSummary,
};

/** Validate one step's doc. The doc must already be Zod-parsed; this checks content, not shape. */
export function validateBrandResearchDoc<S extends BrandResearchStep>(
  step: S,
  doc: NonNullable<BrandResearchDocs[S]>
): BrandResearchValidation {
  const errors: string[] = [];
  VALIDATORS[step](doc, (msg) => errors.push(msg));
  return { ok: errors.length === 0, errors };
}
