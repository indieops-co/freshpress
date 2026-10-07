import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { EmailFolderStore } from './email-folders.js';
import { EmailThreadStore } from './email-threads.js';
import { EmailMessageStore } from './email-messages.js';
import type { EmailThread, EmailMessage } from '../content/email-inbox-types.js';

const TEST_DATA = join(process.cwd(), 'data-test-email-inbox');

afterEach(async () => {
  await rm(TEST_DATA, { recursive: true, force: true });
});

describe('EmailFolderStore', () => {
  it('seeds Inbox/Drafts/Sent once and is idempotent', async () => {
    const store = new EmailFolderStore({ dataDir: TEST_DATA });
    const first = await store.ensureSystemFolders('site1');
    expect(first.map((f) => f.systemType).sort()).toEqual(['drafts', 'inbox', 'sent']);

    const second = await store.ensureSystemFolders('site1');
    expect(second).toHaveLength(3);
    expect(await store.list('site1')).toHaveLength(3);
  });

  it('creates, lists, and deletes a custom folder', async () => {
    const store = new EmailFolderStore({ dataDir: TEST_DATA });
    const now = new Date().toISOString();
    const saved = await store.save({
      id: 'fld_custom1',
      siteId: 'site1',
      name: 'Leads',
      kind: 'custom',
      order: 10,
      createdAt: now,
      updatedAt: now,
    });
    expect(saved.name).toBe('Leads');
    expect(await store.get('site1', 'fld_custom1')).not.toBeNull();

    await store.delete('site1', 'fld_custom1');
    expect(await store.get('site1', 'fld_custom1')).toBeNull();
  });
});

describe('EmailThreadStore', () => {
  function makeThread(overrides: Partial<EmailThread> = {}): EmailThread {
    const now = new Date().toISOString();
    return {
      id: 'th_1',
      siteId: 'site1',
      folderId: 'fld_inbox',
      subject: 'Hello',
      participantEmails: ['a@b.com'],
      lastMessageAt: now,
      messageCount: 1,
      isRead: false,
      snippet: 'Hi there',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('lists threads scoped to a folder, newest first', async () => {
    const store = new EmailThreadStore({ dataDir: TEST_DATA });
    await store.save(makeThread({ id: 'th_old', folderId: 'fld_inbox', lastMessageAt: '2026-01-01T00:00:00Z' }));
    await store.save(makeThread({ id: 'th_new', folderId: 'fld_inbox', lastMessageAt: '2026-02-01T00:00:00Z' }));
    await store.save(makeThread({ id: 'th_other_folder', folderId: 'fld_sent', lastMessageAt: '2026-03-01T00:00:00Z' }));

    const inboxThreads = await store.list('site1', 'fld_inbox');
    expect(inboxThreads.map((t) => t.id)).toEqual(['th_new', 'th_old']);

    const allThreads = await store.list('site1');
    expect(allThreads).toHaveLength(3);
  });
});

describe('EmailMessageStore', () => {
  function makeMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
    const now = new Date().toISOString();
    return {
      id: 'msg_1',
      siteId: 'site1',
      threadId: 'th_1',
      direction: 'inbound',
      status: 'received',
      from: 'a@b.com',
      to: ['site@example.com'],
      subject: 'Hello',
      bodyHtml: '<p>Hi</p>',
      sentAt: now,
      isRead: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('lists messages in a thread oldest-first', async () => {
    const store = new EmailMessageStore({ dataDir: TEST_DATA });
    await store.save(makeMessage({ id: 'msg_2', sentAt: '2026-02-01T00:00:00Z' }));
    await store.save(makeMessage({ id: 'msg_1', sentAt: '2026-01-01T00:00:00Z' }));

    const messages = await store.listByThread('site1', 'th_1');
    expect(messages.map((m) => m.id)).toEqual(['msg_1', 'msg_2']);
  });

  describe('listScheduledDue', () => {
    it('finds scheduled messages due by now across every site, excluding others', async () => {
      const store = new EmailMessageStore({ dataDir: TEST_DATA });
      await store.save(
        makeMessage({ id: 'msg_due_site1', siteId: 'site1', status: 'scheduled', scheduledAt: '2026-07-01T00:00:00Z' })
      );
      await store.save(
        makeMessage({ id: 'msg_due_site2', siteId: 'site2', status: 'scheduled', scheduledAt: '2026-07-02T00:00:00Z' })
      );
      await store.save(
        makeMessage({
          id: 'msg_future',
          siteId: 'site1',
          status: 'scheduled',
          scheduledAt: '2026-12-01T00:00:00Z',
        })
      );
      await store.save(makeMessage({ id: 'msg_draft', siteId: 'site1', status: 'draft' }));
      await store.save(makeMessage({ id: 'msg_sent', siteId: 'site1', status: 'sent' }));

      const due = await store.listScheduledDue('2026-07-03T00:00:00Z');
      expect(due.map((m) => m.id).sort()).toEqual(['msg_due_site1', 'msg_due_site2']);
    });

    it('returns an empty array when no messages exist yet', async () => {
      const store = new EmailMessageStore({ dataDir: TEST_DATA });
      expect(await store.listScheduledDue(new Date().toISOString())).toEqual([]);
    });
  });
});
