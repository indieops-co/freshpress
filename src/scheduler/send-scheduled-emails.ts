import { getStorage } from '../storage/filesystem.js';
import { hasFeature } from '../auth/entitlements.js';
import { getWorkspaceUsersStore } from '../storage/workspace-users.js';
import { getEmailThreadStore, type EmailThreadStore } from '../storage/email-threads.js';
import { getEmailMessageStore, type EmailMessageStore } from '../storage/email-messages.js';
import { buildReplyThreadingHeaders, makeOutboundMessageIdHeader, sendComposedMessage } from '../api/email-inbox.js';
import { textSnippet } from '../api/email-inbound-webhook.js';
import type { StorageAdapter } from '../storage/types.js';
import type { PlanTier } from '../auth/types.js';

export interface ScheduledSendDeps {
  messages: EmailMessageStore;
  threads: EmailThreadStore;
  storage: StorageAdapter;
  /** Defaults to the real `sendComposedMessage` (hits Resend) — override in tests to avoid that. */
  send: typeof sendComposedMessage;
  /** Defaults to the stored workspace's tier — override in tests. */
  getPlanTier: () => Promise<PlanTier>;
}

/**
 * Finds every scheduled message due to send and sends it through the same rendering pipeline as an
 * immediate send. Stores (and the send step itself) are injectable for testing against real
 * filesystem-backed stores without hitting Resend. A per-message failure is logged and left
 * `status: 'scheduled'` so it retries on the next tick — it never throws, so one bad message can't
 * block the rest of the batch.
 */
export async function sendScheduledEmails(deps?: Partial<ScheduledSendDeps>): Promise<void> {
  const messages = deps?.messages ?? (await getEmailMessageStore());
  const threads = deps?.threads ?? (await getEmailThreadStore());
  const storage = deps?.storage ?? (await getStorage());
  const send = deps?.send ?? sendComposedMessage;

  const getPlanTier =
    deps?.getPlanTier ??
    (async () => (await (await getWorkspaceUsersStore()).getWorkspace())?.planTier ?? 'free');

  // Tier gate: scheduled sends are part of the email system. Messages queued before a
  // downgrade stay 'scheduled' (not failed) and resume sending if the workspace upgrades
  // again. Single-workspace instance, so one lookup covers the whole batch.
  if (!hasFeature(await getPlanTier(), 'emailSystem')) return;

  const due = await messages.listScheduledDue(new Date().toISOString());

  for (const message of due) {
    try {
      const site = await storage.getSite(message.siteId);
      if (!site?.meta.email) {
        console.error(`Scheduled send skipped: site ${message.siteId} has no email configured (message ${message.id})`);
        continue;
      }
      const thread = await threads.get(message.siteId, message.threadId);
      if (!thread) {
        console.error(`Scheduled send skipped: thread ${message.threadId} not found (message ${message.id})`);
        continue;
      }

      const priorMessages = (await messages.listByThread(message.siteId, message.threadId)).filter(
        (m) => m.id !== message.id
      );
      const { inReplyTo, references } = buildReplyThreadingHeaders(priorMessages);
      const messageIdHeader =
        message.messageIdHeader ?? makeOutboundMessageIdHeader(message.id, site.meta.email.fromEmail);

      const result = await send(message.siteId, site.meta.name, site.meta.email, {
        to: message.to[0],
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        messageIdHeader,
        inReplyTo,
        references,
        formatId: message.formatId ?? '',
        templateId: message.templateId ?? '',
        includeBrand: message.includeBrand ?? true,
        includeSignature: message.includeSignature ?? true,
        plainTextOnly: message.plainTextOnly,
        gutterOverride: message.gutterOverride,
      });

      if (result.error) {
        console.error(`Scheduled send failed for message ${message.id}: ${result.error}`);
        continue;
      }

      const now = new Date().toISOString();
      await messages.save({ ...message, status: 'sent', sentAt: now, messageIdHeader, inReplyTo, references });
      await threads.save({
        ...thread,
        lastMessageAt: now,
        messageCount: thread.messageCount + 1,
        snippet: textSnippet(message.bodyHtml),
      });
    } catch (err) {
      console.error(`Scheduled send failed for message ${message.id}:`, err);
    }
  }
}
