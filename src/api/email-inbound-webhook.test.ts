import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { getHeader, textSnippet, ingestReceivedEmail, type ReceivedEmailContent } from './email-inbound-webhook.js';
import { EmailFolderStore } from '../storage/email-folders.js';
import { EmailThreadStore } from '../storage/email-threads.js';
import { EmailMessageStore } from '../storage/email-messages.js';

describe('getHeader', () => {
  it('looks up a header case-insensitively', () => {
    const headers = { 'Message-Id': '<abc@x.com>', 'In-Reply-To': '<def@x.com>' };
    expect(getHeader(headers, 'message-id')).toBe('<abc@x.com>');
    expect(getHeader(headers, 'MESSAGE-ID')).toBe('<abc@x.com>');
  });

  it('returns undefined for missing headers or a missing key', () => {
    expect(getHeader(null, 'message-id')).toBeUndefined();
    expect(getHeader({}, 'message-id')).toBeUndefined();
  });
});

describe('textSnippet', () => {
  it('strips tags and collapses whitespace', () => {
    expect(textSnippet('<p>Hello   <strong>world</strong></p>')).toBe('Hello world');
  });

  it('truncates long text with an ellipsis', () => {
    const long = 'a'.repeat(200);
    const snippet = textSnippet(`<p>${long}</p>`, 20);
    expect(snippet).toBe(`${'a'.repeat(20)}…`);
  });
});

describe('ingestReceivedEmail', () => {
  const TEST_DATA = join(process.cwd(), 'data-test-inbound-webhook');

  afterEach(async () => {
    await rm(TEST_DATA, { recursive: true, force: true });
  });

  function makeStores() {
    return {
      folders: new EmailFolderStore({ dataDir: TEST_DATA }),
      threads: new EmailThreadStore({ dataDir: TEST_DATA }),
      messages: new EmailMessageStore({ dataDir: TEST_DATA }),
    };
  }

  function makeEmail(overrides: Partial<ReceivedEmailContent> = {}): ReceivedEmailContent {
    return {
      from: 'lead@customer.com',
      to: ['sales@mail.clientdomain.com'],
      subject: 'Question about pricing',
      html: '<p>How much does this cost?</p>',
      text: null,
      headers: { 'Message-Id': '<msg1@customer.com>' },
      message_id: 'msg1@customer.com',
      created_at: '2026-07-01T00:00:00Z',
      ...overrides,
    };
  }

  it('creates a new thread in Inbox for a first-contact email', async () => {
    const stores = makeStores();
    const { thread, message } = await ingestReceivedEmail('site1', makeEmail(), stores);

    expect(thread.subject).toBe('Question about pricing');
    expect(thread.messageCount).toBe(1);
    expect(thread.snippet).toBe('How much does this cost?');
    expect(message.direction).toBe('inbound');
    expect(message.messageIdHeader).toBe('<msg1@customer.com>');

    const inbox = (await stores.folders.list('site1')).find((f) => f.systemType === 'inbox');
    expect(thread.folderId).toBe(inbox!.id);
  });

  it('sanitizes script tags out of the body before storing', async () => {
    const stores = makeStores();
    const { message } = await ingestReceivedEmail(
      'site1',
      makeEmail({ html: '<p>hi</p><script>alert(1)</script>' }),
      stores
    );
    expect(message.bodyHtml).not.toContain('<script');
    expect(message.bodyHtml).toContain('<p>hi</p>');
  });

  it('threads a reply into the original conversation via In-Reply-To', async () => {
    const stores = makeStores();
    const { thread: firstThread } = await ingestReceivedEmail('site1', makeEmail(), stores);

    const { thread: secondThread, message: reply } = await ingestReceivedEmail(
      'site1',
      makeEmail({
        subject: 'Re: Question about pricing',
        headers: { 'Message-Id': '<msg2@customer.com>', 'In-Reply-To': '<msg1@customer.com>' },
        message_id: 'msg2@customer.com',
        created_at: '2026-07-02T00:00:00Z',
      }),
      stores
    );

    expect(secondThread.id).toBe(firstThread.id);
    expect(secondThread.messageCount).toBe(2);
    expect(reply.threadId).toBe(firstThread.id);

    const messages = await stores.messages.listByThread('site1', firstThread.id);
    expect(messages).toHaveLength(2);
  });

  it('threads via References when In-Reply-To is absent', async () => {
    const stores = makeStores();
    const { thread: firstThread } = await ingestReceivedEmail('site1', makeEmail(), stores);

    const { thread: secondThread } = await ingestReceivedEmail(
      'site1',
      makeEmail({
        headers: { 'Message-Id': '<msg3@customer.com>', References: '<other@x.com> <msg1@customer.com>' },
        message_id: 'msg3@customer.com',
      }),
      stores
    );

    expect(secondThread.id).toBe(firstThread.id);
  });

  it('routes a new thread into a folder whose filterRule matches, skipping Inbox', async () => {
    const stores = makeStores();
    await stores.folders.ensureSystemFolders('site1');
    const leadsFolder = await stores.folders.save({
      id: 'fld_leads',
      siteId: 'site1',
      name: 'Leads',
      kind: 'custom',
      order: 10,
      filterRule: { matchType: 'keyword', value: 'pricing' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const { thread } = await ingestReceivedEmail('site1', makeEmail({ subject: 'Question about pricing' }), stores);
    expect(thread.folderId).toBe(leadsFolder.id);
  });

  it('tags a new thread with the injected classifier\'s category', async () => {
    const stores = makeStores();
    const { thread } = await ingestReceivedEmail('site1', makeEmail(), stores, {
      classify: async () => 'promo',
    });
    expect(thread.category).toBe('promo');
  });

  it('leaves category undefined when no classifier is injected', async () => {
    const stores = makeStores();
    const { thread } = await ingestReceivedEmail('site1', makeEmail(), stores);
    expect(thread.category).toBeUndefined();
  });

  it('does not re-classify an existing thread on a reply', async () => {
    const stores = makeStores();
    const { thread: firstThread } = await ingestReceivedEmail('site1', makeEmail(), stores, {
      classify: async () => 'personal',
    });
    expect(firstThread.category).toBe('personal');

    const { thread: secondThread } = await ingestReceivedEmail(
      'site1',
      makeEmail({
        headers: { 'Message-Id': '<msg2@customer.com>', 'In-Reply-To': '<msg1@customer.com>' },
        message_id: 'msg2@customer.com',
      }),
      stores,
      { classify: async () => 'promo' }
    );
    expect(secondThread.id).toBe(firstThread.id);
    expect(secondThread.category).toBe('personal');
  });

  it('leaves category undefined when the classifier fails open', async () => {
    const stores = makeStores();
    const { thread } = await ingestReceivedEmail('site1', makeEmail(), stores, {
      classify: async () => undefined,
    });
    expect(thread.category).toBeUndefined();
  });

  it('leaves an existing thread in its current folder even if a filter would now match', async () => {
    const stores = makeStores();
    const { thread: firstThread } = await ingestReceivedEmail('site1', makeEmail(), stores);
    await stores.folders.save({
      id: 'fld_leads',
      siteId: 'site1',
      name: 'Leads',
      kind: 'custom',
      order: 10,
      filterRule: { matchType: 'keyword', value: 'pricing' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const { thread: secondThread } = await ingestReceivedEmail(
      'site1',
      makeEmail({
        headers: { 'Message-Id': '<msg2@customer.com>', 'In-Reply-To': '<msg1@customer.com>' },
        message_id: 'msg2@customer.com',
      }),
      stores
    );

    expect(secondThread.id).toBe(firstThread.id);
    expect(secondThread.folderId).toBe(firstThread.folderId);
  });
});
