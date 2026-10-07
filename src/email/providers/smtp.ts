import nodemailer from 'nodemailer';
import type { SiteSmtpConfig } from '../../storage/types.js';
import { formatFrom, type EmailProvider } from './types.js';

/** Generic SMTP (nodemailer) — works with any mailbox provider (Google Workspace, Zoho, …). */
export function createSmtpProvider(smtp: SiteSmtpConfig): EmailProvider {
  return {
    id: 'smtp',
    capabilities: { inbound: false },
    async send(message) {
      const host = smtp.host?.trim();
      if (!host) return { error: 'SMTP host is required' };
      const port = smtp.port ?? 587;
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: smtp.secure ?? port === 465,
        // Auth is optional: internal/allowlisted relays accept unauthenticated submission.
        ...(smtp.username?.trim()
          ? { auth: { user: smtp.username.trim(), pass: smtp.password ?? '' } }
          : {}),
      });
      try {
        const info = await transporter.sendMail({
          from: formatFrom(message.from),
          to: message.to,
          subject: message.subject,
          ...(message.html ? { html: message.html } : {}),
          ...(message.text ? { text: message.text } : {}),
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        });
        return { id: info.messageId };
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'SMTP send failed' };
      }
    },
  };
}
