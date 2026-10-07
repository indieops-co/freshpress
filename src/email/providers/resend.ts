import { Resend } from 'resend';
import { formatFrom, type EmailProvider } from './types.js';

export function createResendProvider(apiKey: string): EmailProvider {
  return {
    id: 'resend',
    capabilities: { inbound: true },
    async send(message) {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from: formatFrom(message.from),
        to: message.to,
        subject: message.subject,
        ...(message.html ? { html: message.html } : {}),
        ...(message.text ? { text: message.text } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      } as Parameters<Resend['emails']['send']>[0]);
      if (error) return { error: error.message };
      return { id: data?.id };
    },
  };
}
