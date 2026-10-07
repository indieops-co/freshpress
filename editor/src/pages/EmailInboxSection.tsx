import { useState } from 'react';
import EmailDashboardPage, { type InboxNavTarget } from './EmailDashboardPage';
import InboxPage from './InboxPage';
import UpgradeNotice from '../components/UpgradeNotice';
import { useAuth } from '../context/AuthContext';

interface Props {
  siteId: string;
}

/**
 * Screen 1 (Dashboard) is the landing view for the Inbox nav section; Screen 2 (the 3-pane Folder
 * view) is one click away. This just toggles between the two and carries the deep-link target
 * (folder/thread) from a Dashboard click into InboxPage's initial selection.
 */
export default function EmailInboxSection({ siteId }: Props) {
  const auth = useAuth();
  const [view, setView] = useState<'dashboard' | 'folder'>('dashboard');
  const [target, setTarget] = useState<InboxNavTarget>({});

  if (!(auth.features?.emailSystem ?? true)) {
    return (
      <UpgradeNotice title="Email">
        A full client-inbox and outreach system — shared folders, threads, scheduled sends,
        and AI-drafted replies for every site.
      </UpgradeNotice>
    );
  }

  function openFolder(next: InboxNavTarget) {
    setTarget(next);
    setView('folder');
  }

  if (view === 'folder') {
    return (
      <InboxPage
        siteId={siteId}
        initialFolderId={target.folderId}
        initialThreadId={target.threadId}
        onBackToDashboard={() => setView('dashboard')}
      />
    );
  }

  return <EmailDashboardPage siteId={siteId} onOpenFolder={openFolder} />;
}
