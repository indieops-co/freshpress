import type { EmailProviderId } from '../../storage/types.js';

/** One outbound email, provider-neutral. Adapters format `from` per their API's shape. */
export interface OutboundEmail {
  from: { email: string; name?: string };
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  /** Raw headers pass-through — webmail threading (Message-Id / In-Reply-To / References) depends on it. */
  headers?: Record<string, string>;
}

/** Matches the historical send.ts result shape: errors are returned, not thrown. */
export interface SendResult {
  id?: string;
  error?: string;
}

export interface ProviderCapabilities {
  /** Built-in inbox/webmail — needs Resend Domains + inbound webhooks, so Resend-only. */
  inbound: boolean;
}

export interface EmailProvider {
  readonly id: EmailProviderId;
  readonly capabilities: ProviderCapabilities;
  send(message: OutboundEmail): Promise<SendResult>;
}

/** "Name <email>" — the format Resend, Postmark, and nodemailer all accept. */
export function formatFrom(from: OutboundEmail['from']): string {
  return from.name ? `${from.name} <${from.email}>` : from.email;
}
