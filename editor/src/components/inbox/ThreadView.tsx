import { api, type EmailThread, type EmailInboxMessage } from '../../api';
import MessageComposer, { type ComposedMessage } from './MessageComposer';

interface Props {
  siteId: string;
  thread: EmailThread;
  messages: EmailInboxMessage[];
  onChanged: () => void;
}

export default function ThreadView({ siteId, thread, messages, onChanged }: Props) {
  const draft = messages.find((m) => m.status === 'draft' || m.status === 'scheduled');
  const sentOrReceived = messages.filter((m) => m.status !== 'draft' && m.status !== 'scheduled');

  async function handleSend(data: ComposedMessage) {
    const send = !data.scheduledAt;
    if (draft) {
      await api.updateInboxMessage(siteId, draft.id, { ...data, send });
    } else {
      await api.replyToThread(siteId, thread.id, { ...data, send });
    }
    onChanged();
  }

  async function handleSaveDraft(data: ComposedMessage) {
    if (draft) {
      // Reopening a scheduled send and hitting "Save draft" cancels the schedule, same as never picking a delay.
      const unschedule = draft.status === 'scheduled' ? { scheduledAt: null as string | null } : {};
      await api.updateInboxMessage(siteId, draft.id, { ...data, ...unschedule });
    } else {
      await api.replyToThread(siteId, thread.id, { ...data, send: false });
    }
    onChanged();
  }

  async function handleDiscardDraft() {
    if (!draft || draft.status !== 'draft') return;
    await api.deleteInboxMessage(siteId, draft.id);
    onChanged();
  }

  return (
    <div className="thread-view">
      <h3 className="thread-view__subject">{thread.subject || '(no subject)'}</h3>

      <div className="thread-view__messages">
        {sentOrReceived.map((message) => (
          <div
            key={message.id}
            className={`thread-view__message thread-view__message--${message.direction}`}
          >
            <div className="thread-view__message-meta">
              <span>{message.direction === 'inbound' ? message.from : `You (${message.from})`}</span>
              <span>{new Date(message.sentAt).toLocaleString()}</span>
            </div>
            <div className="thread-view__message-body" dangerouslySetInnerHTML={{ __html: message.bodyHtml }} />
          </div>
        ))}
      </div>

      <div className="panel thread-view__composer">
        <div className="thread-view__composer-header">
          <h4 style={{ margin: 0 }}>
            {draft?.status === 'scheduled' ? 'Edit scheduled send' : draft ? 'Edit draft' : 'Reply'}
          </h4>
          {draft?.isAiGenerated && <span className="thread-view__ai-badge">AI draft</span>}
          {draft?.status === 'scheduled' && draft.scheduledAt && (
            <span className="thread-view__ai-badge">Sends {new Date(draft.scheduledAt).toLocaleString()}</span>
          )}
          {draft?.status === 'draft' && (
            <button type="button" className="link-btn" onClick={() => void handleDiscardDraft()}>
              Discard
            </button>
          )}
        </div>
        <MessageComposer
          key={draft?.id ?? 'reply'}
          siteId={siteId}
          initialBodyHtml={draft?.bodyHtml ?? '<p></p>'}
          initialScheduledAt={draft?.status === 'scheduled' ? draft.scheduledAt : undefined}
          onSend={handleSend}
          onSaveDraft={handleSaveDraft}
        />
      </div>
    </div>
  );
}
