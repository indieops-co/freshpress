import { formatFrom, type EmailProvider } from './types.js';

export function createPostmarkProvider(apiKey: string): EmailProvider {
  return {
    id: 'postmark',
    capabilities: { inbound: false },
    async send(message) {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'X-Postmark-Server-Token': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          From: formatFrom(message.from),
          To: message.to,
          Subject: message.subject,
          MessageStream: 'outbound',
          ...(message.html ? { HtmlBody: message.html } : {}),
          ...(message.text ? { TextBody: message.text } : {}),
          ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
          ...(message.headers
            ? { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) }
            : {}),
        }),
      });

      const body = (await res.json().catch(() => null)) as { MessageID?: string; Message?: string } | null;
      if (!res.ok) return { error: body?.Message || `Postmark send failed (${res.status})` };
      return { id: body?.MessageID };
    },
  };
}
