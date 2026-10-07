import type { EmailFolderFilterRule } from './email-inbox-types.js';

function senderDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/** Matches a folder's filterRule against a thread's subject/sender — used both at ingestion and for retroactive "apply to existing" moves. */
export function matchesFilterRule(
  rule: EmailFolderFilterRule,
  input: { subject: string; senderEmail: string }
): boolean {
  if (rule.matchType === 'keyword') {
    return input.subject.toLowerCase().includes(rule.value.toLowerCase());
  }
  return senderDomain(input.senderEmail) === rule.value.toLowerCase();
}
