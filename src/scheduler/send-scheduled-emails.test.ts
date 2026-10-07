import { describe, it, expect, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sendScheduledEmails } from './send-scheduled-emails.js';
import { FileSystemStorage } from '../storage/filesystem.js';
import { EmailThreadStore } from '../storage/email-threads.js';
import { EmailMessageStore } from '../storage/email-messages.js';
import type { EmailThread, EmailMessage } from '../content/email-inbox-types.js';

const TEST_DATA = join(process.cwd(), 'data-test-scheduler');

/** Tests run against an entitled workspace; the free-tier skip has its own test. */
const getPlanTier = async () => 'pro' as const;

afterEach(async () => {
  await rm(TEST_DATA, { recursive: true, force: true });
});

async function makeSite(storage: FileSystemStorage) {
  const site = await storage.createSite('Test Site');
  await storage.updateSiteMeta(site.meta.id, {
    email: { enabled: true, resendApiKey: 'fake-key', fromEmail: 'hello@test.com', fromName: 'Test Site' },
  });
  return site.meta.id;
}

function makeThread(siteId: string, overrides: Partial<EmailThread> = {}): EmailThread {
  const now = new Date().toISOString();
  return {
    id: 'th_1',
    siteId,
    folderId: 'fld_drafts',
    subject: 'Hello',
    participantEmails: ['lead@customer.com'],
    lastMessageAt: now,
    messageCount: 0,
    isRead: true,
    snippet: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeScheduledMessage(siteId: string, threadId: string, overrides: Partial<EmailMessage> = {}): EmailMessage {
  const now = new Date().toISOString();
  return {
    id: 'msg_scheduled',
    siteId,
    threadId,
    direction: 'outbound',
    status: 'scheduled',
    scheduledAt: '2026-07-01T00:00:00Z',
    from: 'hello@test.com',
    to: ['lead@customer.com'],
    subject: 'Hello',
    bodyHtml: '<p>Reply body</p>',
    plainTextOnly: true,
    sentAt: now,
    isRead: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('sendScheduledEmails', () => {
  it('sends a due message, flips it to sent, and updates the thread', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    const threads = new EmailThreadStore({ dataDir: TEST_DATA });
    const messages = new EmailMessageStore({ dataDir: TEST_DATA });
    const siteId = await makeSite(storage);

    await threads.save(makeThread(siteId, { messageCount: 0 }));
    await messages.save(makeScheduledMessage(siteId, 'th_1'));

    const send = vi.fn().mockResolvedValue({ id: 'resend_1' });
    await sendScheduledEmails({ messages, threads, storage, send, getPlanTier });

    expect(send).toHaveBeenCalledTimes(1);
    const updated = await messages.get(siteId, 'msg_scheduled');
    expect(updated!.status).toBe('sent');

    const updatedThread = await threads.get(siteId, 'th_1');
    expect(updatedThread!.messageCount).toBe(1);
    expect(updatedThread!.snippet).toBe('Reply body');
  });

  it('leaves not-yet-due scheduled messages untouched', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    const threads = new EmailThreadStore({ dataDir: TEST_DATA });
    const messages = new EmailMessageStore({ dataDir: TEST_DATA });
    const siteId = await makeSite(storage);

    await threads.save(makeThread(siteId));
    await messages.save(makeScheduledMessage(siteId, 'th_1', { scheduledAt: '2099-01-01T00:00:00Z' }));

    const send = vi.fn().mockResolvedValue({ id: 'resend_1' });
    await sendScheduledEmails({ messages, threads, storage, send, getPlanTier });

    expect(send).not.toHaveBeenCalled();
    const updated = await messages.get(siteId, 'msg_scheduled');
    expect(updated!.status).toBe('scheduled');
  });

  it('leaves the message scheduled and does not update the thread when the send fails', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    const threads = new EmailThreadStore({ dataDir: TEST_DATA });
    const messages = new EmailMessageStore({ dataDir: TEST_DATA });
    const siteId = await makeSite(storage);

    await threads.save(makeThread(siteId, { messageCount: 0 }));
    await messages.save(makeScheduledMessage(siteId, 'th_1'));

    const send = vi.fn().mockResolvedValue({ error: 'Resend rejected the request' });
    await sendScheduledEmails({ messages, threads, storage, send, getPlanTier });

    const updated = await messages.get(siteId, 'msg_scheduled');
    expect(updated!.status).toBe('scheduled');
    const updatedThread = await threads.get(siteId, 'th_1');
    expect(updatedThread!.messageCount).toBe(0);
  });

  it('does not crash the batch when one message errors, and still processes the rest', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    const threads = new EmailThreadStore({ dataDir: TEST_DATA });
    const messages = new EmailMessageStore({ dataDir: TEST_DATA });
    const siteId = await makeSite(storage);

    await threads.save(makeThread(siteId, { id: 'th_1', messageCount: 0 }));
    await threads.save(makeThread(siteId, { id: 'th_2', messageCount: 0 }));
    // No matching thread for this one — should be skipped, not thrown.
    await messages.save(makeScheduledMessage(siteId, 'th_missing', { id: 'msg_orphan' }));
    await messages.save(makeScheduledMessage(siteId, 'th_2', { id: 'msg_ok' }));

    const send = vi.fn().mockResolvedValue({ id: 'resend_1' });
    await sendScheduledEmails({ messages, threads, storage, send, getPlanTier });

    expect(send).toHaveBeenCalledTimes(1);
    expect((await messages.get(siteId, 'msg_orphan'))!.status).toBe('scheduled');
    expect((await messages.get(siteId, 'msg_ok'))!.status).toBe('sent');
  });

  it('builds In-Reply-To/References from prior messages in the thread when sending a scheduled reply', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    const threads = new EmailThreadStore({ dataDir: TEST_DATA });
    const messages = new EmailMessageStore({ dataDir: TEST_DATA });
    const siteId = await makeSite(storage);

    await threads.save(makeThread(siteId, { messageCount: 1 }));
    await messages.save({
      id: 'msg_inbound',
      siteId,
      threadId: 'th_1',
      direction: 'inbound',
      status: 'received',
      from: 'lead@customer.com',
      to: ['hello@test.com'],
      subject: 'Hello',
      bodyHtml: '<p>Question</p>',
      messageIdHeader: '<inbound@customer.com>',
      sentAt: '2026-06-30T00:00:00Z',
      isRead: true,
      createdAt: '2026-06-30T00:00:00Z',
      updatedAt: '2026-06-30T00:00:00Z',
    });
    await messages.save(
      makeScheduledMessage(siteId, 'th_1', { messageIdHeader: '<reply@test.com>', inReplyTo: undefined, references: undefined })
    );

    const send = vi.fn().mockResolvedValue({ id: 'resend_1' });
    await sendScheduledEmails({ messages, threads, storage, send, getPlanTier });

    expect(send).toHaveBeenCalledWith(
      siteId,
      'Test Site',
      expect.objectContaining({ enabled: true }),
      expect.objectContaining({
        inReplyTo: '<inbound@customer.com>',
        references: ['<inbound@customer.com>'],
      })
    );
  });

  it('skips the whole batch on a free-tier workspace, leaving messages scheduled for a later upgrade', async () => {
    const storage = new FileSystemStorage(TEST_DATA);
    const threads = new EmailThreadStore({ dataDir: TEST_DATA });
    const messages = new EmailMessageStore({ dataDir: TEST_DATA });
    const siteId = await makeSite(storage);

    await threads.save(makeThread(siteId));
    await messages.save(makeScheduledMessage(siteId, 'th_1'));

    const send = vi.fn().mockResolvedValue({ id: 'resend_1' });
    await sendScheduledEmails({ messages, threads, storage, send, getPlanTier: async () => 'free' });

    expect(send).not.toHaveBeenCalled();
    const updated = await messages.get(siteId, 'msg_scheduled');
    expect(updated!.status).toBe('scheduled');
  });
});
