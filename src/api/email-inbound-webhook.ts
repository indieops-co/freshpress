import { Router, raw } from 'express';
import { nanoid } from 'nanoid';
import { Resend } from 'resend';
import { routeParam } from '../util/params.js';
import { getStorage } from '../storage/filesystem.js';
import { decryptSiteEmailConfig, decryptInboundConfig } from '../storage/site-email-secrets.js';
import { sanitizeEmailBodyHtml } from '../email/brand-render.js';
import { matchesFilterRule } from '../content/email-folder-filter.js';
import { getEmailFolderStore, type EmailFolderStore } from '../storage/email-folders.js';
import { getEmailThreadStore, type EmailThreadStore } from '../storage/email-threads.js';
import { getEmailMessageStore, type EmailMessageStore } from '../storage/email-messages.js';
import { classifyThreadCategory } from '../humanizer/classify-thread.js';
import type { EmailThread, EmailMessage, EmailThreadCategory } from '../content/email-inbox-types.js';

/**
 * Mounted BEFORE the app-wide express.json() middleware (see server.ts) — signature
 * verification needs the exact raw request bytes, and re-serializing a parsed JSON
 * body is not guaranteed byte-identical to what Resend actually signed.
 */
const router = Router();

const MAX_BODY_CHARS = 500_000;

export function getHeader(headers: Record<string, string> | null | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

export function textSnippet(html: string, maxLen = 140): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export interface ReceivedEmailContent {
  from: string;
  to: string[];
  subject: string;
  html: string | null;
  text: string | null;
  headers: Record<string, string> | null;
  message_id: string;
  created_at: string;
}

/** Resolves/creates the thread and stores the inbound message. Stores are injected for testability. */
export async function ingestReceivedEmail(
  siteId: string,
  full: ReceivedEmailContent,
  stores: { folders: EmailFolderStore; threads: EmailThreadStore; messages: EmailMessageStore },
  opts?: { classify?: (input: { subject: string; bodyText: string }) => Promise<EmailThreadCategory | undefined> }
): Promise<{ thread: EmailThread; message: EmailMessage }> {
  const rawBodyHtml = full.html ?? (full.text ? `<p>${full.text}</p>` : '');
  const bodyHtml = sanitizeEmailBodyHtml(rawBodyHtml).slice(0, MAX_BODY_CHARS);
  const messageIdHeader = getHeader(full.headers, 'message-id') ?? full.message_id;
  const inReplyTo = getHeader(full.headers, 'in-reply-to');
  const referencesHeader = getHeader(full.headers, 'references');
  const references = referencesHeader ? referencesHeader.split(/\s+/).filter(Boolean) : undefined;

  const folders = await stores.folders.ensureSystemFolders(siteId);
  const inboxFolder = folders.find((f) => f.systemType === 'inbox')!;

  let thread: EmailThread | null = null;
  const candidateIds = [inReplyTo, ...(references ?? [])].filter((v): v is string => Boolean(v));
  for (const candidate of candidateIds) {
    const match = await stores.messages.findByMessageIdHeader(siteId, candidate);
    if (match) {
      thread = await stores.threads.get(siteId, match.threadId);
      if (thread) break;
    }
  }

  const now = new Date().toISOString();
  if (!thread) {
    // New conversation only — a matched reply stays wherever the thread already lives, filters don't re-route it.
    const matchedFolder = folders.find(
      (f) => f.filterRule && matchesFilterRule(f.filterRule, { subject: full.subject, senderEmail: full.from })
    );
    const category = await opts?.classify?.({ subject: full.subject, bodyText: textSnippet(bodyHtml, 2000) });
    thread = await stores.threads.save({
      id: `th_${nanoid(10)}`,
      siteId,
      folderId: (matchedFolder ?? inboxFolder).id,
      subject: full.subject,
      participantEmails: [full.from, ...full.to],
      lastMessageAt: full.created_at,
      messageCount: 0,
      isRead: false,
      snippet: '',
      category,
      createdAt: now,
      updatedAt: now,
    });
  }

  const message = await stores.messages.save({
    id: `msg_${nanoid(10)}`,
    siteId,
    threadId: thread.id,
    direction: 'inbound',
    status: 'received',
    from: full.from,
    to: full.to,
    subject: full.subject,
    bodyHtml,
    messageIdHeader,
    inReplyTo,
    references,
    sentAt: full.created_at,
    isRead: false,
    createdAt: now,
    updatedAt: now,
  });

  thread = await stores.threads.save({
    ...thread,
    lastMessageAt: full.created_at,
    messageCount: thread.messageCount + 1,
    isRead: false,
    snippet: textSnippet(bodyHtml),
  });

  return { thread, message };
}

router.post(
  '/webhooks/resend/inbound/:siteId',
  raw({ type: '*/*', limit: '10mb' }),
  async (req, res) => {
    try {
      const siteId = routeParam(req.params.siteId);
      const storage = await getStorage();
      const site = await storage.getSite(siteId);
      const inbound = site?.meta.inboundEmail ? decryptInboundConfig(site.meta.inboundEmail) : undefined;
      const resendApiKey = site?.meta.email ? decryptSiteEmailConfig(site.meta.email).resendApiKey : undefined;

      if (!site || !inbound?.webhookSecret || !resendApiKey) {
        res.status(400).json({ error: 'Inbound email is not configured for this site' });
        return;
      }

      const resend = new Resend(resendApiKey);
      const svixId = req.header('svix-id');
      const svixTimestamp = req.header('svix-timestamp');
      const svixSignature = req.header('svix-signature');
      if (!svixId || !svixTimestamp || !svixSignature) {
        res.status(400).json({ error: 'Missing webhook signature headers' });
        return;
      }

      let event;
      try {
        event = resend.webhooks.verify({
          payload: (req.body as Buffer).toString('utf-8'),
          headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
          webhookSecret: inbound.webhookSecret,
        });
      } catch {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      if (event.type !== 'email.received') {
        res.status(200).json({ ok: true, ignored: event.type });
        return;
      }

      // Basic sanity check: the recipient must actually be on this site's configured inbound domain.
      const toAddresses = event.data.to ?? [];
      const domain = inbound.domain?.toLowerCase();
      const domainMatch = domain && toAddresses.some((addr) => addr.toLowerCase().endsWith(`@${domain}`));
      if (!domainMatch) {
        res.status(200).json({ ok: true, ignored: 'recipient domain mismatch' });
        return;
      }

      const { data: full, error: fetchError } = await resend.emails.receiving.get(event.data.email_id);
      if (fetchError || !full) {
        res.status(502).json({ error: fetchError?.message ?? 'Failed to fetch received email content' });
        return;
      }

      await ingestReceivedEmail(
        siteId,
        full,
        {
          folders: await getEmailFolderStore(),
          threads: await getEmailThreadStore(),
          messages: await getEmailMessageStore(),
        },
        { classify: classifyThreadCategory }
      );

      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Webhook processing failed' });
    }
  }
);

export default router;
