import { callAi } from './ai-call.js';
import type { EmailThreadCategory } from '../content/email-inbox-types.js';

const VALID_CATEGORIES: readonly EmailThreadCategory[] = ['personal', 'promo', 'newsletter'];

const CLASSIFY_SYSTEM_PROMPT = `Classify this inbound email into exactly one category:
- personal: a genuine message from an individual (question, request, reply-worthy conversation) that deserves a personal reply.
- promo: marketing, sales pitches, advertising, cold outreach.
- newsletter: bulk newsletters, digests, automated updates, no-reply broadcasts.
Respond with ONLY the single category word — personal, promo, or newsletter — nothing else.`;

/** Parses the model's raw response, tolerating punctuation/whitespace/case. Undefined if it didn't answer cleanly. */
export function parseCategoryResponse(raw: string): EmailThreadCategory | undefined {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  return (VALID_CATEGORIES as readonly string[]).includes(cleaned) ? (cleaned as EmailThreadCategory) : undefined;
}

export interface ClassifyThreadInput {
  subject: string;
  bodyText: string;
}

/** Lightweight ingestion-time classifier — fails open (undefined) rather than blocking mail delivery. */
export async function classifyThreadCategory(input: ClassifyThreadInput): Promise<EmailThreadCategory | undefined> {
  try {
    const user = `Subject: ${input.subject}\n\n${input.bodyText.slice(0, 2000)}`;
    const raw = await callAi(CLASSIFY_SYSTEM_PROMPT, user, 8);
    return parseCategoryResponse(raw);
  } catch {
    return undefined;
  }
}
