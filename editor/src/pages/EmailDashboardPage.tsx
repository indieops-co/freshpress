import { useEffect, useState } from 'react';
import { PanelLeftOpen } from 'lucide-react';
import { api, type EmailInboxDashboard, type EmailInboxMessage } from '../api';

export interface InboxNavTarget {
  folderId?: string;
  threadId?: string;
}

interface Props {
  siteId: string;
  onOpenFolder: (target: InboxNavTarget) => void;
}

interface StatCard {
  label: string;
  value: number;
  target: InboxNavTarget;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function EmailDashboardPage({ siteId, onOpenFolder }: Props) {
  const [dashboard, setDashboard] = useState<EmailInboxDashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getInboxDashboard(siteId)
      .then(setDashboard)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dashboard'));
  }, [siteId]);

  if (error) return <p className="dash-page__error">{error}</p>;
  if (!dashboard) return <p className="dash-page__muted">Loading…</p>;

  const { stats, kanban, folders } = dashboard;

  const statCards: StatCard[] = [
    { label: 'Unread', value: stats.unread, target: { folderId: folders.inboxId } },
    { label: 'Scheduled', value: stats.scheduled, target: { folderId: folders.draftsId } },
    { label: 'Drafts', value: stats.drafts, target: { folderId: folders.draftsId } },
    { label: 'Sent today', value: stats.sentToday, target: { folderId: folders.sentId } },
    { label: 'Recent replies (24h)', value: stats.recentReplies, target: { folderId: folders.inboxId } },
  ];

  function messageCard(message: EmailInboxMessage, folderId: string, timeLabel: string) {
    return (
      <button
        key={message.id}
        type="button"
        className="email-dashboard__kanban-card"
        onClick={() => onOpenFolder({ folderId, threadId: message.threadId })}
      >
        <span className="email-dashboard__kanban-card-subject">{message.subject || '(no subject)'}</span>
        <span className="email-dashboard__kanban-card-meta">
          {message.to.join(', ') || message.from} · {timeLabel}
        </span>
      </button>
    );
  }

  return (
    <div className="dash-page">
      <div className="inbox-page__header">
        <h2 className="dash-page__title">Inbox</h2>
        <button type="button" className="link-btn" onClick={() => onOpenFolder({})}>
          <PanelLeftOpen size={14} /> Folder view
        </button>
      </div>

      <div className="email-dashboard__stats">
        {statCards.map((card) => (
          <button
            key={card.label}
            type="button"
            className="panel stat-card"
            onClick={() => onOpenFolder(card.target)}
          >
            <span className="stat-card__value">{card.value}</span>
            <span className="stat-card__label">{card.label}</span>
          </button>
        ))}
      </div>

      <div className="email-dashboard__kanban">
        <div className="panel email-dashboard__kanban-column">
          <h3 className="email-dashboard__kanban-title">Draft</h3>
          {kanban.draft.length === 0 ? (
            <p className="dash-page__muted">No drafts.</p>
          ) : (
            kanban.draft.map((m) => messageCard(m, folders.draftsId, formatTime(m.updatedAt)))
          )}
        </div>

        <div className="panel email-dashboard__kanban-column">
          <h3 className="email-dashboard__kanban-title">Scheduled</h3>
          {kanban.scheduled.length === 0 ? (
            <p className="dash-page__muted">Nothing scheduled.</p>
          ) : (
            kanban.scheduled.map((group) => (
              <div key={group.day} className="email-dashboard__kanban-day">
                <h4 className="email-dashboard__kanban-day-label">{formatDay(group.day)}</h4>
                {group.messages.map((m) =>
                  messageCard(m, folders.draftsId, m.scheduledAt ? formatTime(m.scheduledAt) : '')
                )}
              </div>
            ))
          )}
        </div>

        <div className="panel email-dashboard__kanban-column">
          <h3 className="email-dashboard__kanban-title">Sent</h3>
          {kanban.sent.length === 0 ? (
            <p className="dash-page__muted">Nothing sent yet.</p>
          ) : (
            kanban.sent.map((m) => messageCard(m, folders.sentId, formatTime(m.sentAt)))
          )}
        </div>
      </div>
    </div>
  );
}
