import { describe, it, expect, afterEach, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  reassignFolderThreadsToInbox,
  applyFolderFilter,
  buildReplyThreadingHeaders,
  makeOutboundMessageIdHeader,
  resolveReplyRecipient,
  buildInboxDashboard,
} from './email-inbox.js';
import { EmailFolderStore } from '../storage/email-folders.js';
import { EmailThreadStore } from '../storage/email-threads.js';
import { EmailMessageStore } from '../storage/email-messages.js';
import type { EmailFolder, EmailThread, EmailMessage } from '../content/email-inbox-types.js';

const TEST_DATA = join(process.cwd(), 'data-test-email-inbox-api');

afterEach(async () => {
  await rm(TEST_DATA, { recursive: true, force: true });
});

function makeStores() {
  return {
    folders: new EmailFolderStore({ dataDir: TEST_DATA }),
    threads: new EmailThreadStore({ dataDir: TEST_DATA }),
  };
}

function makeThread(overrides: Partial<EmailThread> = {}): EmailThread {
  const now = new Date().toISOString();
  return {
    id: 'th_1',
    siteId: 'site1',
    folderId: 'fld_custom',
    subject: 'Hello',
    participantEmails: ['lead@customer.com'],
    lastMessageAt: now,
    messageCount: 1,
    isRead: false,
    snippet: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFolder(overrides: Partial<EmailFolder> = {}): EmailFolder {
  const now = new Date().toISOString();
  return {
    id: 'fld_custom',
    siteId: 'site1',
    name: 'Leads',
    kind: 'custom',
    order: 10,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('reassignFolderThreadsToInbox', () => {
  it('moves every thread in the folder back to Inbox', async () => {
    const stores = makeStores();
    const folders = await stores.folders.ensureSystemFolders('site1');
    const inbox = folders.find((f) => f.systemType === 'inbox')!;
    await stores.threads.save(makeThread({ id: 'th_a' }));
    await stores.threads.save(makeThread({ id: 'th_b' }));

    await reassignFolderThreadsToInbox('site1', 'fld_custom', stores);

    const remaining = await stores.threads.list('site1', 'fld_custom');
    expect(remaining).toHaveLength(0);
    const inInbox = await stores.threads.list('site1', inbox.id);
    expect(inInbox.map((t) => t.id).sort()).toEqual(['th_a', 'th_b']);
  });
});

describe('applyFolderFilter', () => {
  it('moves matching Inbox threads into the folder and returns the count', async () => {
    const stores = makeStores();
    const folders = await stores.folders.ensureSystemFolders('site1');
    const inbox = folders.find((f) => f.systemType === 'inbox')!;
    await stores.threads.save(makeThread({ id: 'th_match', folderId: inbox.id, subject: 'Pricing question' }));
    await stores.threads.save(makeThread({ id: 'th_nomatch', folderId: inbox.id, subject: 'Just saying hi' }));

    const folder = makeFolder({ filterRule: { matchType: 'keyword', value: 'pricing' } });
    const movedCount = await applyFolderFilter('site1', folder, stores);

    expect(movedCount).toBe(1);
    expect((await stores.threads.get('site1', 'th_match'))!.folderId).toBe('fld_custom');
    expect((await stores.threads.get('site1', 'th_nomatch'))!.folderId).toBe(inbox.id);
  });

  it('returns 0 and does nothing when the folder has no filterRule', async () => {
    const stores = makeStores();
    await stores.folders.ensureSystemFolders('site1');
    const movedCount = await applyFolderFilter('site1', makeFolder(), stores);
    expect(movedCount).toBe(0);
  });
});

function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  const now = new Date().toISOString();
  return {
    id: 'msg_1',
    siteId: 'site1',
    threadId: 'th_1',
    direction: 'inbound',
    status: 'received',
    from: 'lead@customer.com',
    to: ['hello@site.com'],
    subject: 'Hello',
    bodyHtml: '<p>Hi</p>',
    sentAt: now,
    isRead: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('buildReplyThreadingHeaders', () => {
  it('returns nothing for a thread with no messageIdHeaders', () => {
    expect(buildReplyThreadingHeaders([makeMessage({ messageIdHeader: undefined })])).toEqual({});
  });

  it('uses the most recent message as In-Reply-To and includes all as References, oldest-first', () => {
    const first = makeMessage({ id: 'msg_1', messageIdHeader: '<a@x.com>', sentAt: '2026-07-01T00:00:00Z' });
    const second = makeMessage({ id: 'msg_2', messageIdHeader: '<b@x.com>', sentAt: '2026-07-02T00:00:00Z' });
    // Pass out of order to confirm the function itself sorts by sentAt.
    const headers = buildReplyThreadingHeaders([second, first]);
    expect(headers.inReplyTo).toBe('<b@x.com>');
    expect(headers.references).toEqual(['<a@x.com>', '<b@x.com>']);
  });

  it('skips messages with no messageIdHeader when building References', () => {
    const withId = makeMessage({ id: 'msg_1', messageIdHeader: '<a@x.com>', sentAt: '2026-07-01T00:00:00Z' });
    const withoutId = makeMessage({ id: 'msg_2', messageIdHeader: undefined, sentAt: '2026-07-02T00:00:00Z' });
    const headers = buildReplyThreadingHeaders([withId, withoutId]);
    expect(headers.inReplyTo).toBe('<a@x.com>');
    expect(headers.references).toEqual(['<a@x.com>']);
  });
});

describe('makeOutboundMessageIdHeader', () => {
  it('builds a Message-Id from the id and the from address domain', () => {
    expect(makeOutboundMessageIdHeader('msg_abc123', 'hello@example.com')).toBe('<msg_abc123@example.com>');
  });

  it('falls back to a placeholder domain when fromEmail is missing', () => {
    expect(makeOutboundMessageIdHeader('msg_abc123', undefined)).toBe('<msg_abc123@mail.local>');
  });
});

describe('resolveReplyRecipient', () => {
  const thread = makeThread({ participantEmails: ['lead@customer.com'] });

  it('replies to the sender of the last inbound message', () => {
    const messages = [
      makeMessage({ direction: 'inbound', from: 'lead@customer.com', sentAt: '2026-07-01T00:00:00Z' }),
      makeMessage({ direction: 'outbound', from: 'us@site.com', sentAt: '2026-07-02T00:00:00Z' }),
      makeMessage({ direction: 'inbound', from: 'lead-alt@customer.com', sentAt: '2026-07-03T00:00:00Z' }),
    ];
    expect(resolveReplyRecipient(thread, messages)).toBe('lead-alt@customer.com');
  });

  it('falls back to the thread\'s first participant when there is no inbound message yet', () => {
    expect(resolveReplyRecipient(thread, [])).toBe('lead@customer.com');
  });
});

describe('buildInboxDashboard', () => {
  const NOW = new Date('2026-07-05T12:00:00Z');

  function makeComposeStores() {
    return {
      folders: new EmailFolderStore({ dataDir: TEST_DATA }),
      threads: new EmailThreadStore({ dataDir: TEST_DATA }),
      messages: new EmailMessageStore({ dataDir: TEST_DATA }),
    };
  }

  it('computes stats and kanban groupings from a mixed set of threads/messages', async () => {
    const stores = makeComposeStores();
    const folders = await stores.folders.ensureSystemFolders('site1');
    const inbox = folders.find((f) => f.systemType === 'inbox')!;
    const drafts = folders.find((f) => f.systemType === 'drafts')!;
    const sent = folders.find((f) => f.systemType === 'sent')!;

    await stores.threads.save(makeThread({ id: 'th_unread', folderId: inbox.id, isRead: false }));
    await stores.threads.save(makeThread({ id: 'th_read', folderId: inbox.id, isRead: true }));
    await stores.threads.save(makeThread({ id: 'th_other', folderId: drafts.id, isRead: false }));

    // EmailMessageStore.save() always stamps updatedAt with the real clock, so control it via fake timers
    // rather than the (ignored) updatedAt override, to make the draft-sort assertion below deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T00:00:00Z'));
    await stores.messages.save(makeMessage({ id: 'msg_d1', status: 'draft' }));
    vi.setSystemTime(new Date('2026-07-04T00:00:00Z'));
    await stores.messages.save(makeMessage({ id: 'msg_d2', status: 'draft' }));
    vi.useRealTimers();

    await stores.messages.save(
      makeMessage({ id: 'msg_s1', status: 'scheduled', scheduledAt: '2026-07-06T09:00:00Z' })
    );
    await stores.messages.save(
      makeMessage({ id: 'msg_s2', status: 'scheduled', scheduledAt: '2026-07-06T08:00:00Z' })
    );
    await stores.messages.save(
      makeMessage({ id: 'msg_s3', status: 'scheduled', scheduledAt: '2026-07-07T10:00:00Z' })
    );

    await stores.messages.save(makeMessage({ id: 'msg_sent_today', status: 'sent', sentAt: '2026-07-05T05:00:00Z' }));
    await stores.messages.save(
      makeMessage({ id: 'msg_sent_yesterday', status: 'sent', sentAt: '2026-07-04T05:00:00Z' })
    );

    await stores.messages.save(
      makeMessage({
        id: 'msg_recent_reply',
        direction: 'inbound',
        status: 'received',
        sentAt: '2026-07-05T00:00:00Z',
      })
    );
    await stores.messages.save(
      makeMessage({ id: 'msg_old_reply', direction: 'inbound', status: 'received', sentAt: '2026-07-03T00:00:00Z' })
    );

    const dashboard = await buildInboxDashboard('site1', stores, NOW);

    expect(dashboard.stats).toEqual({
      unread: 1,
      scheduled: 3,
      drafts: 2,
      sentToday: 1,
      recentReplies: 1,
    });
    expect(dashboard.folders).toEqual({ inboxId: inbox.id, draftsId: drafts.id, sentId: sent.id });

    expect(dashboard.kanban.draft.map((m) => m.id)).toEqual(['msg_d2', 'msg_d1']);
    expect(dashboard.kanban.scheduled).toEqual([
      { day: '2026-07-06', messages: expect.arrayContaining([expect.objectContaining({ id: 'msg_s2' })]) },
      { day: '2026-07-07', messages: expect.arrayContaining([expect.objectContaining({ id: 'msg_s3' })]) },
    ]);
    expect(dashboard.kanban.scheduled[0].messages.map((m) => m.id)).toEqual(['msg_s2', 'msg_s1']);
    expect(dashboard.kanban.sent.map((m) => m.id)).toEqual(['msg_sent_today', 'msg_sent_yesterday']);
  });

  it('returns zeroed stats and empty kanban lists for a site with no mail yet', async () => {
    const stores = makeComposeStores();
    await stores.folders.ensureSystemFolders('site1');

    const dashboard = await buildInboxDashboard('site1', stores, NOW);

    expect(dashboard.stats).toEqual({ unread: 0, scheduled: 0, drafts: 0, sentToday: 0, recentReplies: 0 });
    expect(dashboard.kanban).toEqual({ draft: [], scheduled: [], sent: [] });
  });
});
