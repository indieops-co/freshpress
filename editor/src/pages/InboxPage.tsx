import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { api, type EmailFolder, type EmailThread, type EmailInboxMessage } from '../api';
import FolderSidebar from '../components/inbox/FolderSidebar';
import ThreadList from '../components/inbox/ThreadList';
import ThreadView from '../components/inbox/ThreadView';
import MessageComposer, { type ComposedMessage } from '../components/inbox/MessageComposer';

interface Props {
  siteId: string;
  /** Pre-selects a folder when arriving via a Dashboard stat card / kanban entry deep link. */
  initialFolderId?: string;
  /** Opens a specific thread on mount — used for kanban entries linking straight to one message. */
  initialThreadId?: string;
  /** Shown as a small nav link back to Screen 1 when this page was reached from the Dashboard. */
  onBackToDashboard?: () => void;
}

export default function InboxPage({ siteId, initialFolderId, initialThreadId, onBackToDashboard }: Props) {
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(initialFolderId ?? null);
  const [error, setError] = useState('');

  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState('');

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<{ thread: EmailThread; messages: EmailInboxMessage[] } | null>(
    null
  );
  const [composing, setComposing] = useState(false);
  const [autoDraftEnabled, setAutoDraftEnabled] = useState(false);

  const refreshFolders = useCallback(() => {
    api
      .listInboxFolders(siteId)
      .then((res) => {
        setFolders(res.folders);
        setSelectedFolderId((prev) => prev ?? res.folders.find((f) => f.systemType === 'inbox')?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load folders'));
  }, [siteId]);

  useEffect(() => {
    refreshFolders();
    api
      .getHumanizerConfig(siteId)
      .then((r) => setAutoDraftEnabled(r.config.autoDraftEnabled ?? true))
      .catch(() => setAutoDraftEnabled(false));
  }, [siteId, refreshFolders]);

  const refreshThreads = useCallback(() => {
    if (!selectedFolderId) return;
    setThreadsLoading(true);
    api
      .listInboxThreads(siteId, selectedFolderId)
      .then((res) => setThreads(res.threads))
      .catch((e) => setThreadsError(e instanceof Error ? e.message : 'Failed to load threads'))
      .finally(() => setThreadsLoading(false));
  }, [siteId, selectedFolderId]);

  useEffect(() => {
    setSelectedThreadId(null);
    setThreadDetail(null);
    setComposing(false);
    refreshThreads();
  }, [refreshThreads]);

  const openThread = useCallback(
    (threadId: string) => {
      setComposing(false);
      setSelectedThreadId(threadId);
      api
        .getInboxThread(siteId, threadId)
        .then((res) => {
          setThreadDetail(res);
          if (!res.thread.isRead) {
            void api.updateInboxThread(siteId, threadId, { isRead: true }).then(() => refreshThreads());
          }

          const isPromo = res.thread.category === 'promo' || res.thread.category === 'newsletter';
          const hasDraft = res.messages.some((m) => m.status === 'draft');
          const hasInbound = res.messages.some((m) => m.direction === 'inbound');
          if (autoDraftEnabled && !isPromo && !hasDraft && hasInbound) {
            void api
              .autoDraftReply(siteId, threadId)
              .then(() => api.getInboxThread(siteId, threadId))
              .then(setThreadDetail)
              .catch(() => {
                // Best-effort — e.g. no AI provider configured yet. The user can still reply manually.
              });
          }
        })
        .catch((e) => setThreadsError(e instanceof Error ? e.message : 'Failed to load thread'));
    },
    [siteId, refreshThreads, autoDraftEnabled]
  );

  const openedInitialThread = useRef(false);
  useEffect(() => {
    if (openedInitialThread.current || !initialThreadId) return;
    openedInitialThread.current = true;
    openThread(initialThreadId);
  }, [initialThreadId, openThread]);

  function afterThreadChanged() {
    if (selectedThreadId) {
      void api.getInboxThread(siteId, selectedThreadId).then(setThreadDetail);
    }
    refreshThreads();
  }

  async function handleComposeSend(data: ComposedMessage) {
    const res = await api.composeInboxMessage(siteId, {
      ...data,
      to: data.to ?? [],
      subject: data.subject ?? '',
      send: !data.scheduledAt,
    });
    setComposing(false);
    openThread(res.thread.id);
    refreshThreads();
  }

  async function handleComposeSaveDraft(data: ComposedMessage) {
    const res = await api.composeInboxMessage(siteId, {
      ...data,
      to: data.to ?? [],
      subject: data.subject ?? '',
      send: false,
    });
    setComposing(false);
    openThread(res.thread.id);
    refreshThreads();
  }

  return (
    <div className="dash-page">
      <div className="inbox-page__header">
        <h2 className="dash-page__title">Inbox</h2>
        {onBackToDashboard && (
          <button type="button" className="link-btn" onClick={onBackToDashboard}>
            <LayoutDashboard size={14} /> Dashboard
          </button>
        )}
      </div>
      {error && <p className="dash-page__error">{error}</p>}

      <div className="inbox-page__layout">
        <FolderSidebar
          siteId={siteId}
          folders={folders}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          onFoldersChanged={refreshFolders}
          unreadCounts={{}}
        />

        <ThreadList
          threads={threads}
          selectedThreadId={selectedThreadId}
          onSelectThread={openThread}
          onNewMessage={() => {
            setComposing(true);
            setSelectedThreadId(null);
            setThreadDetail(null);
          }}
          composing={composing}
          loading={threadsLoading}
          error={threadsError}
        />

        <div className="panel thread-pane">
          {composing ? (
            <>
              <h3 style={{ margin: '0 0 0.75rem' }}>New message</h3>
              <MessageComposer
                siteId={siteId}
                showTo
                showSubject
                onSend={handleComposeSend}
                onSaveDraft={handleComposeSaveDraft}
              />
            </>
          ) : threadDetail ? (
            <ThreadView
              siteId={siteId}
              thread={threadDetail.thread}
              messages={threadDetail.messages}
              onChanged={afterThreadChanged}
            />
          ) : (
            <p className="dash-page__muted">
              {selectedFolderId ? 'Select an email or start a new message.' : 'Select a folder to get started.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
