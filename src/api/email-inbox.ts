import { Router } from 'express';
import { nanoid } from 'nanoid';
import { requireOwner } from '../auth/middleware.js';
import { requireFeature } from '../auth/entitlements.js';
import { routeParam } from '../util/params.js';
import { getStorage } from '../storage/filesystem.js';
import { getEmailFolderStore, type EmailFolderStore } from '../storage/email-folders.js';
import { getEmailThreadStore, type EmailThreadStore } from '../storage/email-threads.js';
import { getEmailMessageStore, type EmailMessageStore } from '../storage/email-messages.js';
import { getHumanizerConfigStore } from '../storage/humanizer-config.js';
import { matchesFilterRule } from '../content/email-folder-filter.js';
import { textSnippet } from './email-inbound-webhook.js';
import { loadComposeInput } from './email-brand.js';
import { renderBrandedEmail, htmlToPlainText } from '../email/brand-render.js';
import { sendBrandedEmail } from '../email/send.js';
import { draftEmailReply } from '../humanizer/draft-reply.js';
import type { EmailFolder, EmailFolderFilterRule, EmailThread, EmailMessage } from '../content/email-inbox-types.js';

const router = Router();

// Email system is a paid feature: every admin-side email route carries the tier
// gate. (The Resend inbound webhook and public form-submission routes are separate
// and deliberately ungated.)
const requireEmailSystem = requireFeature('emailSystem');

type InboxStores = { folders: EmailFolderStore; threads: EmailThreadStore };
type ComposeStores = { folders: EmailFolderStore; threads: EmailThreadStore; messages: EmailMessageStore };

interface BrandedSendOptions {
  formatId: string;
  templateId: string;
  includeBrand: boolean;
  includeSignature: boolean;
  plainTextOnly?: boolean;
  gutterOverride?: string;
}

/** Builds In-Reply-To/References for a reply from the thread's prior messages, oldest-first. */
export function buildReplyThreadingHeaders(priorMessages: EmailMessage[]): {
  inReplyTo?: string;
  references?: string[];
} {
  const withIds = priorMessages
    .filter((m): m is EmailMessage & { messageIdHeader: string } => Boolean(m.messageIdHeader))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  if (withIds.length === 0) return {};
  return {
    inReplyTo: withIds[withIds.length - 1].messageIdHeader,
    references: withIds.map((m) => m.messageIdHeader),
  };
}

/** Deterministic Message-Id we assign ourselves at creation time, so a recipient's future reply's
 * In-Reply-To/References will match it exactly regardless of whether Resend echoes it back. */
export function makeOutboundMessageIdHeader(id: string, fromEmail: string | undefined): string {
  const domain = fromEmail?.split('@')[1]?.trim() || 'mail.local';
  return `<${id}@${domain}>`;
}

/** Who a reply goes to: the sender of the last inbound message, falling back to the thread's first participant. */
export function resolveReplyRecipient(thread: EmailThread, priorMessages: EmailMessage[]): string {
  const lastInbound = [...priorMessages].reverse().find((m) => m.direction === 'inbound');
  return lastInbound?.from ?? thread.participantEmails[0] ?? '';
}

/** Renders (branded or plain-text) and sends via Resend, using headers for reply threading when given. */
export async function sendComposedMessage(
  siteId: string,
  siteName: string,
  emailConfig: Parameters<typeof sendBrandedEmail>[0],
  opts: BrandedSendOptions & { to: string; subject: string; bodyHtml: string; messageIdHeader: string; inReplyTo?: string; references?: string[] }
): Promise<{ error?: string; id?: string }> {
  const headers: Record<string, string> = { 'Message-Id': opts.messageIdHeader };
  if (opts.inReplyTo) headers['In-Reply-To'] = opts.inReplyTo;
  if (opts.references?.length) headers['References'] = opts.references.join(' ');

  if (opts.plainTextOnly) {
    const text = htmlToPlainText(opts.bodyHtml);
    return sendBrandedEmail(emailConfig, { to: opts.to, subject: opts.subject, text, headers });
  }

  const input = await loadComposeInput(
    siteId,
    {
      formatId: opts.formatId,
      templateId: opts.templateId,
      subject: opts.subject,
      bodyHtml: opts.bodyHtml,
      includeBrand: opts.includeBrand,
      includeSignature: opts.includeSignature,
    },
    siteName
  );
  const format = opts.gutterOverride
    ? { ...input.format, spacing: { ...input.format.spacing, gutter: opts.gutterOverride } }
    : input.format;
  const html = await renderBrandedEmail({ ...input, format });
  return sendBrandedEmail(emailConfig, { to: opts.to, subject: opts.subject, html, headers });
}

/** Moves every thread out of a folder back to Inbox — used before deleting a custom folder. */
export async function reassignFolderThreadsToInbox(
  siteId: string,
  folderId: string,
  stores: InboxStores
): Promise<void> {
  const folders = await stores.folders.ensureSystemFolders(siteId);
  const inbox = folders.find((f) => f.systemType === 'inbox')!;
  const threads = await stores.threads.list(siteId, folderId);
  for (const thread of threads) {
    await stores.threads.save({ ...thread, folderId: inbox.id });
  }
}

/** Retroactively moves matching Inbox threads into a folder with a filterRule set. Returns how many moved. */
export async function applyFolderFilter(
  siteId: string,
  folder: EmailFolder,
  stores: InboxStores
): Promise<number> {
  if (!folder.filterRule) return 0;
  const folders = await stores.folders.ensureSystemFolders(siteId);
  const inbox = folders.find((f) => f.systemType === 'inbox')!;
  const inboxThreads = await stores.threads.list(siteId, inbox.id);

  let movedCount = 0;
  for (const thread of inboxThreads) {
    const senderEmail = thread.participantEmails[0] ?? '';
    if (matchesFilterRule(folder.filterRule, { subject: thread.subject, senderEmail })) {
      await stores.threads.save({ ...thread, folderId: folder.id });
      movedCount += 1;
    }
  }
  return movedCount;
}

export interface InboxDashboard {
  stats: {
    unread: number;
    scheduled: number;
    drafts: number;
    sentToday: number;
    recentReplies: number;
  };
  kanban: {
    draft: EmailMessage[];
    scheduled: { day: string; messages: EmailMessage[] }[];
    sent: EmailMessage[];
  };
  folders: { inboxId: string; draftsId: string; sentId: string };
}

const RECENT_SENT_LIMIT = 30;

/** Builds Screen 1's stats + kanban data. `now` is injectable so tests get a deterministic clock. */
export async function buildInboxDashboard(
  siteId: string,
  stores: ComposeStores,
  now: Date = new Date()
): Promise<InboxDashboard> {
  const folders = await stores.folders.ensureSystemFolders(siteId);
  const inboxFolder = folders.find((f) => f.systemType === 'inbox')!;
  const draftsFolder = folders.find((f) => f.systemType === 'drafts')!;
  const sentFolder = folders.find((f) => f.systemType === 'sent')!;

  const [inboxThreads, messages] = await Promise.all([
    stores.threads.list(siteId, inboxFolder.id),
    stores.messages.listAll(siteId),
  ]);

  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const draftMessages = messages.filter((m) => m.status === 'draft');
  const scheduledMessages = messages.filter((m) => m.status === 'scheduled');
  const sentMessages = messages.filter((m) => m.status === 'sent');

  const scheduledByDay = new Map<string, EmailMessage[]>();
  for (const m of scheduledMessages) {
    const day = (m.scheduledAt ?? m.sentAt).slice(0, 10);
    const bucket = scheduledByDay.get(day) ?? [];
    bucket.push(m);
    scheduledByDay.set(day, bucket);
  }
  const scheduledGroups = [...scheduledByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, msgs]) => ({
      day,
      messages: msgs.sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    }));

  return {
    stats: {
      unread: inboxThreads.filter((t) => !t.isRead).length,
      scheduled: scheduledMessages.length,
      drafts: draftMessages.length,
      sentToday: sentMessages.filter((m) => m.sentAt >= todayStart).length,
      recentReplies: messages.filter((m) => m.direction === 'inbound' && m.status === 'received' && m.sentAt >= dayAgo)
        .length,
    },
    kanban: {
      draft: [...draftMessages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      scheduled: scheduledGroups,
      sent: [...sentMessages].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, RECENT_SENT_LIMIT),
    },
    folders: { inboxId: inboxFolder.id, draftsId: draftsFolder.id, sentId: sentFolder.id },
  };
}

router.get('/sites/:siteId/inbox/folders', requireOwner, requireEmailSystem, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const store = await getEmailFolderStore();
  res.json({ folders: await store.ensureSystemFolders(siteId) });
});

router.post('/sites/:siteId/inbox/folders', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const { name, color, parentFolderId } = req.body as {
      name?: string;
      color?: string;
      parentFolderId?: string;
    };
    if (!name?.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const store = await getEmailFolderStore();
    const existing = await store.list(siteId);
    if (parentFolderId && !existing.some((f) => f.id === parentFolderId)) {
      res.status(400).json({ error: 'parentFolderId does not exist' });
      return;
    }
    const now = new Date().toISOString();
    const folder: EmailFolder = {
      id: `fld_${nanoid(10)}`,
      siteId,
      name: name.trim(),
      kind: 'custom',
      order: existing.length,
      color,
      parentFolderId,
      createdAt: now,
      updatedAt: now,
    };
    res.status(201).json({ folder: await store.save(folder) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create folder' });
  }
});

router.patch('/sites/:siteId/inbox/folders/:id', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const store = await getEmailFolderStore();
    const folder = await store.get(siteId, id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    const patch = req.body as {
      name?: string;
      color?: string;
      parentFolderId?: string | null;
      filterRule?: EmailFolderFilterRule | null;
    };
    if (folder.kind === 'system' && patch.name !== undefined) {
      res.status(400).json({ error: 'System folders cannot be renamed' });
      return;
    }
    const updated: EmailFolder = {
      ...folder,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.parentFolderId !== undefined ? { parentFolderId: patch.parentFolderId ?? undefined } : {}),
      ...(patch.filterRule !== undefined ? { filterRule: patch.filterRule ?? undefined } : {}),
    };
    res.json({ folder: await store.save(updated) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update folder' });
  }
});

router.delete('/sites/:siteId/inbox/folders/:id', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const folderStore = await getEmailFolderStore();
    const folder = await folderStore.get(siteId, id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    if (folder.kind === 'system') {
      res.status(400).json({ error: 'System folders cannot be deleted' });
      return;
    }

    // Reassign any threads in the deleted folder back to Inbox rather than leaving a dangling folderId.
    const threadStore = await getEmailThreadStore();
    await reassignFolderThreadsToInbox(siteId, id, { folders: folderStore, threads: threadStore });

    await folderStore.delete(siteId, id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete folder' });
  }
});

router.post('/sites/:siteId/inbox/folders/:id/apply-filter', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const folderStore = await getEmailFolderStore();
    const folder = await folderStore.get(siteId, id);
    if (!folder?.filterRule) {
      res.status(400).json({ error: 'This folder has no filter rule set' });
      return;
    }

    const threadStore = await getEmailThreadStore();
    const movedCount = await applyFolderFilter(siteId, folder, { folders: folderStore, threads: threadStore });

    res.json({ movedCount });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to apply filter' });
  }
});

// ── Threads ──────────────────────────────────────────────────────────────────

router.get('/sites/:siteId/inbox/threads', requireOwner, requireEmailSystem, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : undefined;
  const store = await getEmailThreadStore();
  res.json({ threads: await store.list(siteId, folderId) });
});

router.get('/sites/:siteId/inbox/threads/:id', requireOwner, requireEmailSystem, async (req, res) => {
  const siteId = routeParam(req.params.siteId);
  const id = routeParam(req.params.id);
  const threadStore = await getEmailThreadStore();
  const thread = await threadStore.get(siteId, id);
  if (!thread) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }
  const messageStore = await getEmailMessageStore();
  const messages = await messageStore.listByThread(siteId, id);
  res.json({ thread, messages });
});

router.patch('/sites/:siteId/inbox/threads/:id', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const threadStore = await getEmailThreadStore();
    const thread = await threadStore.get(siteId, id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const patch = req.body as { isRead?: boolean; folderId?: string };
    if (patch.folderId !== undefined) {
      const folderStore = await getEmailFolderStore();
      const targetFolder = await folderStore.get(siteId, patch.folderId);
      if (!targetFolder) {
        res.status(400).json({ error: 'folderId does not exist' });
        return;
      }
    }
    const updated: EmailThread = {
      ...thread,
      ...(patch.isRead !== undefined ? { isRead: patch.isRead } : {}),
      ...(patch.folderId !== undefined ? { folderId: patch.folderId } : {}),
    };
    res.json({ thread: await threadStore.save(updated) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update thread' });
  }
});

router.post('/sites/:siteId/inbox/threads/:id/reply', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const body = req.body as {
      bodyHtml?: string;
      formatId?: string;
      templateId?: string;
      includeBrand?: boolean;
      includeSignature?: boolean;
      plainTextOnly?: boolean;
      gutterOverride?: string;
      send?: boolean;
      scheduledAt?: string;
    };
    if (!body.bodyHtml?.trim()) {
      res.status(400).json({ error: 'bodyHtml is required' });
      return;
    }
    const isScheduled = Boolean(body.scheduledAt);
    const send = !isScheduled && body.send !== false;
    if ((send || isScheduled) && !body.plainTextOnly && (!body.formatId || !body.templateId)) {
      res.status(400).json({ error: 'formatId and templateId are required unless plainTextOnly is set' });
      return;
    }

    const threadStore = await getEmailThreadStore();
    const thread = await threadStore.get(siteId, id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    if ((send || isScheduled) && !site.meta.email) {
      res.status(400).json({ error: 'Configure email settings first' });
      return;
    }

    const messageStore = await getEmailMessageStore();
    const priorMessages = await messageStore.listByThread(siteId, id);
    const { inReplyTo, references } = buildReplyThreadingHeaders(priorMessages);
    const to = resolveReplyRecipient(thread, priorMessages);

    const now = new Date().toISOString();
    const messageId = `msg_${nanoid(10)}`;
    const messageIdHeader = makeOutboundMessageIdHeader(messageId, site.meta.email?.fromEmail);

    let status: EmailMessage['status'] = 'draft';
    if (send) {
      const result = await sendComposedMessage(siteId, site.meta.name, site.meta.email!, {
        to,
        subject: thread.subject,
        bodyHtml: body.bodyHtml,
        messageIdHeader,
        inReplyTo,
        references,
        formatId: body.formatId ?? '',
        templateId: body.templateId ?? '',
        includeBrand: body.includeBrand ?? true,
        includeSignature: body.includeSignature ?? true,
        plainTextOnly: body.plainTextOnly,
        gutterOverride: body.gutterOverride,
      });
      if (result.error) {
        res.status(502).json({ error: result.error });
        return;
      }
      status = 'sent';
    } else if (isScheduled) {
      status = 'scheduled';
    }

    const message = await messageStore.save({
      id: messageId,
      siteId,
      threadId: id,
      direction: 'outbound',
      status,
      from: site.meta.email?.fromEmail ?? '',
      to: [to],
      subject: thread.subject,
      bodyHtml: body.bodyHtml,
      messageIdHeader,
      inReplyTo,
      references,
      ...(isScheduled
        ? {
            scheduledAt: body.scheduledAt,
            formatId: body.formatId,
            templateId: body.templateId,
            includeBrand: body.includeBrand ?? true,
            includeSignature: body.includeSignature ?? true,
            plainTextOnly: body.plainTextOnly,
            gutterOverride: body.gutterOverride,
          }
        : {}),
      sentAt: now,
      isRead: true,
      createdAt: now,
      updatedAt: now,
    });

    let updatedThread = thread;
    if (send) {
      updatedThread = await threadStore.save({
        ...thread,
        lastMessageAt: now,
        messageCount: thread.messageCount + 1,
        snippet: textSnippet(body.bodyHtml),
      });
    }

    res.json({ message, thread: updatedThread });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Reply failed' });
  }
});

// ── Compose ──────────────────────────────────────────────────────────────────

router.post('/sites/:siteId/inbox/compose', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const body = req.body as {
      to?: string[];
      subject?: string;
      bodyHtml?: string;
      formatId?: string;
      templateId?: string;
      includeBrand?: boolean;
      includeSignature?: boolean;
      plainTextOnly?: boolean;
      gutterOverride?: string;
      send?: boolean;
      scheduledAt?: string;
    };
    const to = (body.to ?? []).map((t) => t.trim()).filter(Boolean);
    if (to.length === 0) {
      res.status(400).json({ error: 'At least one recipient is required' });
      return;
    }
    if (!body.subject?.trim()) {
      res.status(400).json({ error: 'subject is required' });
      return;
    }
    if (!body.bodyHtml?.trim()) {
      res.status(400).json({ error: 'bodyHtml is required' });
      return;
    }
    const isScheduled = Boolean(body.scheduledAt);
    const send = !isScheduled && body.send !== false;
    if ((send || isScheduled) && !body.plainTextOnly && (!body.formatId || !body.templateId)) {
      res.status(400).json({ error: 'formatId and templateId are required unless plainTextOnly is set' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    if ((send || isScheduled) && !site.meta.email) {
      res.status(400).json({ error: 'Configure email settings first' });
      return;
    }

    const stores: ComposeStores = {
      folders: await getEmailFolderStore(),
      threads: await getEmailThreadStore(),
      messages: await getEmailMessageStore(),
    };
    const folders = await stores.folders.ensureSystemFolders(siteId);
    const targetFolder = folders.find((f) => f.systemType === (send ? 'sent' : 'drafts'))!;

    const now = new Date().toISOString();
    const messageId = `msg_${nanoid(10)}`;
    const messageIdHeader = makeOutboundMessageIdHeader(messageId, site.meta.email?.fromEmail);

    let status: EmailMessage['status'] = 'draft';
    if (send) {
      const result = await sendComposedMessage(siteId, site.meta.name, site.meta.email!, {
        to: to[0],
        subject: body.subject,
        bodyHtml: body.bodyHtml,
        messageIdHeader,
        formatId: body.formatId ?? '',
        templateId: body.templateId ?? '',
        includeBrand: body.includeBrand ?? true,
        includeSignature: body.includeSignature ?? true,
        plainTextOnly: body.plainTextOnly,
        gutterOverride: body.gutterOverride,
      });
      if (result.error) {
        res.status(502).json({ error: result.error });
        return;
      }
      status = 'sent';
    } else if (isScheduled) {
      status = 'scheduled';
    }

    const thread = await stores.threads.save({
      id: `th_${nanoid(10)}`,
      siteId,
      folderId: targetFolder.id,
      subject: body.subject,
      participantEmails: to,
      lastMessageAt: now,
      messageCount: send ? 1 : 0,
      isRead: true,
      snippet: send ? textSnippet(body.bodyHtml) : '',
      createdAt: now,
      updatedAt: now,
    });

    const message = await stores.messages.save({
      id: messageId,
      siteId,
      threadId: thread.id,
      direction: 'outbound',
      status,
      from: site.meta.email?.fromEmail ?? '',
      to,
      subject: body.subject,
      bodyHtml: body.bodyHtml,
      messageIdHeader,
      ...(isScheduled
        ? {
            scheduledAt: body.scheduledAt,
            formatId: body.formatId,
            templateId: body.templateId,
            includeBrand: body.includeBrand ?? true,
            includeSignature: body.includeSignature ?? true,
            plainTextOnly: body.plainTextOnly,
            gutterOverride: body.gutterOverride,
          }
        : {}),
      sentAt: now,
      isRead: true,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ thread, message });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Compose failed' });
  }
});

router.patch('/sites/:siteId/inbox/messages/:id', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const messageStore = await getEmailMessageStore();
    const message = await messageStore.get(siteId, id);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.status !== 'draft' && message.status !== 'scheduled') {
      res.status(400).json({ error: 'Only draft or scheduled messages can be edited' });
      return;
    }

    const patch = req.body as {
      bodyHtml?: string;
      subject?: string;
      formatId?: string;
      templateId?: string;
      includeBrand?: boolean;
      includeSignature?: boolean;
      plainTextOnly?: boolean;
      gutterOverride?: string;
      send?: boolean;
      /** string to (re)schedule, null to unschedule back to a plain draft, undefined to leave status/scheduledAt as-is. */
      scheduledAt?: string | null;
    };

    const bodyHtml = patch.bodyHtml ?? message.bodyHtml;
    const subject = patch.subject ?? message.subject;

    if (!patch.send && patch.scheduledAt === undefined) {
      const saved = await messageStore.save({ ...message, bodyHtml, subject });
      res.json({ message: saved });
      return;
    }

    if (!patch.send && patch.scheduledAt === null) {
      const saved = await messageStore.save({
        ...message,
        bodyHtml,
        subject,
        status: 'draft',
        scheduledAt: undefined,
      });
      res.json({ message: saved });
      return;
    }

    if (!patch.plainTextOnly && (!patch.formatId || !patch.templateId)) {
      res.status(400).json({ error: 'formatId and templateId are required unless plainTextOnly is set' });
      return;
    }

    if (!patch.send && typeof patch.scheduledAt === 'string') {
      const saved = await messageStore.save({
        ...message,
        bodyHtml,
        subject,
        status: 'scheduled',
        scheduledAt: patch.scheduledAt,
        formatId: patch.formatId,
        templateId: patch.templateId,
        includeBrand: patch.includeBrand ?? true,
        includeSignature: patch.includeSignature ?? true,
        plainTextOnly: patch.plainTextOnly,
        gutterOverride: patch.gutterOverride,
      });
      res.json({ message: saved });
      return;
    }

    const threadStore = await getEmailThreadStore();
    const thread = await threadStore.get(siteId, message.threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    if (!site?.meta.email) {
      res.status(400).json({ error: 'Configure email settings first' });
      return;
    }

    const result = await sendComposedMessage(siteId, site.meta.name, site.meta.email, {
      to: message.to[0],
      subject,
      bodyHtml,
      messageIdHeader: message.messageIdHeader ?? makeOutboundMessageIdHeader(message.id, site.meta.email.fromEmail),
      inReplyTo: message.inReplyTo,
      references: message.references,
      formatId: patch.formatId ?? '',
      templateId: patch.templateId ?? '',
      includeBrand: patch.includeBrand ?? true,
      includeSignature: patch.includeSignature ?? true,
      plainTextOnly: patch.plainTextOnly,
      gutterOverride: patch.gutterOverride,
    });
    if (result.error) {
      res.status(502).json({ error: result.error });
      return;
    }

    const now = new Date().toISOString();
    const savedMessage = await messageStore.save({
      ...message,
      bodyHtml,
      subject,
      status: 'sent',
      sentAt: now,
    });

    const folderStore = await getEmailFolderStore();
    const folders = await folderStore.ensureSystemFolders(siteId);
    const sentFolder = folders.find((f) => f.systemType === 'sent')!;
    const savedThread = await threadStore.save({
      ...thread,
      folderId: sentFolder.id,
      lastMessageAt: now,
      messageCount: thread.messageCount + 1,
      snippet: textSnippet(bodyHtml),
    });

    res.json({ message: savedMessage, thread: savedThread });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update message' });
  }
});

router.delete('/sites/:siteId/inbox/messages/:id', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const messageStore = await getEmailMessageStore();
    const message = await messageStore.get(siteId, id);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.status !== 'draft') {
      res.status(400).json({ error: 'Only draft messages can be discarded' });
      return;
    }
    await messageStore.delete(siteId, id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to discard draft' });
  }
});

// ── AI auto-draft ────────────────────────────────────────────────────────────

router.post('/sites/:siteId/inbox/threads/:id/auto-draft', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const id = routeParam(req.params.id);
    const threadStore = await getEmailThreadStore();
    const thread = await threadStore.get(siteId, id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    if (thread.category === 'promo' || thread.category === 'newsletter') {
      res.status(400).json({ error: 'Auto-draft is only available for personal/important threads' });
      return;
    }

    const messageStore = await getEmailMessageStore();
    const existingMessages = await messageStore.listByThread(siteId, id);
    const existingDraft = existingMessages.find((m) => m.status === 'draft');
    if (existingDraft) {
      res.json({ message: existingDraft, generated: false });
      return;
    }

    const lastInbound = [...existingMessages].reverse().find((m) => m.direction === 'inbound');
    if (!lastInbound) {
      res.status(400).json({ error: 'No inbound message to reply to yet' });
      return;
    }

    const storage = await getStorage();
    const site = await storage.getSite(siteId);
    const humanizerStore = await getHumanizerConfigStore();
    const config = await humanizerStore.getOrCreateSiteConfig(siteId);

    const { draftHtml } = await draftEmailReply({
      inboundSubject: thread.subject,
      inboundBodyText: htmlToPlainText(lastInbound.bodyHtml),
      config,
    });

    const now = new Date().toISOString();
    const message = await messageStore.save({
      id: `msg_${nanoid(10)}`,
      siteId,
      threadId: id,
      direction: 'outbound',
      status: 'draft',
      from: site?.meta.email?.fromEmail ?? '',
      to: [resolveReplyRecipient(thread, existingMessages)],
      subject: thread.subject,
      bodyHtml: draftHtml,
      isAiGenerated: true,
      sentAt: now,
      isRead: true,
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ message, generated: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Auto-draft failed' });
  }
});

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/sites/:siteId/inbox/dashboard', requireOwner, requireEmailSystem, async (req, res) => {
  try {
    const siteId = routeParam(req.params.siteId);
    const stores: ComposeStores = {
      folders: await getEmailFolderStore(),
      threads: await getEmailThreadStore(),
      messages: await getEmailMessageStore(),
    };
    res.json(await buildInboxDashboard(siteId, stores));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load dashboard' });
  }
});

export default router;
