import { SquarePen } from 'lucide-react';
import type { EmailThread } from '../../api';

interface Props {
  threads: EmailThread[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewMessage: () => void;
  composing: boolean;
  loading: boolean;
  error?: string;
}

export default function ThreadList({
  threads,
  selectedThreadId,
  onSelectThread,
  onNewMessage,
  composing,
  loading,
  error,
}: Props) {
  return (
    <div className="thread-list">
      <div className="thread-list__header">
        <button type="button" className={composing ? '' : 'secondary'} onClick={onNewMessage}>
          <SquarePen size={14} /> New message
        </button>
      </div>

      {error && <p className="dash-page__error">{error}</p>}
      {loading ? (
        <p className="dash-page__muted">Loading…</p>
      ) : threads.length === 0 ? (
        <p className="dash-page__muted">No emails in this folder.</p>
      ) : (
        <ul className="blog-silo__posts">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                className={`blog-silo__post-btn thread-list__item${
                  !composing && thread.id === selectedThreadId ? ' blog-silo__post-btn--active' : ''
                }${thread.isRead ? '' : ' thread-list__item--unread'}`}
                onClick={() => onSelectThread(thread.id)}
              >
                <span className="thread-list__subject">{thread.subject || '(no subject)'}</span>
                <span className="thread-list__snippet">{thread.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
