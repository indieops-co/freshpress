import type { EmailProvider } from './types.js';

/** SendGrid v3 Mail Send — success is a 202 with the id in the x-message-id response header. */
export function createSendGridProvider(apiKey: string): EmailProvider {
  return {
    id: 'sendgrid',
    capabilities: { inbound: false },
    async send(message) {
      // SendGrid requires text/plain before text/html in the content array.
      const content = [
        ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
        ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
      ];
      if (content.length === 0) return { error: 'Email body is required' };

      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: message.from.email, ...(message.from.name ? { name: message.from.name } : {}) },
          subject: message.subject,
          content,
          ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { errors?: Array<{ message?: string }> } | null;
        const detail = body?.errors?.map((e) => e.message).filter(Boolean).join('; ');
        return { error: detail || `SendGrid send failed (${res.status})` };
      }
      return { id: res.headers.get('x-message-id') ?? undefined };
    },
  };
}
