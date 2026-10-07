import { useCallback, useEffect, useState } from 'react';
import { api, type SiteMeta } from '../api';
import { useDashboard } from '../context/DashboardContext';
import { useAuth } from '../context/AuthContext';
import type { AdminSection } from '../context/dashboardTypes';
import Editor from '../components/Editor';
import CreateSiteFlow from '../components/create-site/CreateSiteFlow';
import Sidebar from './Sidebar';
import OverviewPage from '../pages/OverviewPage';
import PagesPage from '../pages/PagesPage';
import SiteThemePage from '../pages/SiteThemePage';
import FormsPage from '../pages/FormsPage';
import EmailDesignPage from '../pages/EmailDesignPage';
import EmailInboxSection from '../pages/EmailInboxSection';
import MediaPage from '../pages/MediaPage';
import SnapshotsPage from '../pages/SnapshotsPage';
import PlaceholderPage from '../pages/PlaceholderPage';
import SettingsPage from '../pages/SettingsPage';
import BlogPage from '../pages/BlogPage';
import SeoPage from '../pages/SeoPage';
import CampaignsPage from '../pages/CampaignsPage';
import SocialPage from '../pages/SocialPage';
import AdminPage from '../pages/admin/AdminPage';
import AdminIntegrationsPage from '../pages/admin/AdminIntegrationsPage';
import TeamPage from '../pages/admin/TeamPage';
import AdminAiProvidersPage from '../pages/admin/AdminAiProvidersPage';

interface Props {
  onLogout: () => void;
}

export default function DashboardShell({ onLogout }: Props) {
  const auth = useAuth();
  const isClient = auth.role === 'client';
  const {
    selectedSiteId,
    sidebarMode,
    activeSiteSection,
    activeAdminSection,
    selectSite,
    setActiveSiteSection,
    validateSelectedSite,
    setSidebarCollapsed,
  } = useDashboard();

  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddSite, setShowAddSite] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  // Chunk 9: a just-created site whose setup wizard commandeers the content
  // pane (same takeover pattern as editorFocus; the sidebar stays).
  const [creatingSite, setCreatingSite] = useState<SiteMeta | null>(null);

  const refreshSites = useCallback(() => {
    if (isClient && auth.siteId) {
      return api
        .getSite(auth.siteId)
        .then((s) => {
          setSites([s.meta]);
          validateSelectedSite([s.meta.id]);
          return [s.meta];
        })
        .catch((e) => setError(e.message));
    }
    return api
      .listSites()
      .then((list) => {
        setSites(list);
        validateSelectedSite(list.map((s) => s.id));
        return list;
      })
      .catch((e) => setError(e.message));
  }, [validateSelectedSite, isClient, auth.siteId]);

  useEffect(() => {
    refreshSites().finally(() => setLoading(false));
  }, [refreshSites]);

  useEffect(() => {
    function onNavigate(e: Event) {
      const detail = (e as CustomEvent<{ siteSection?: string; hash?: string }>).detail;
      if (detail?.siteSection === 'settings') {
        setActiveSiteSection('settings');
        if (detail.hash) {
          requestAnimationFrame(() => {
            document.getElementById(detail.hash!)?.scrollIntoView({ behavior: 'smooth' });
          });
        }
      }
    }
    window.addEventListener('freshpress:navigate', onNavigate);
    return () => window.removeEventListener('freshpress:navigate', onNavigate);
  }, [setActiveSiteSection]);

  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? null;
  const editorFocus = sidebarMode === 'sites' && activeSiteSection === 'editor' && !!selectedSiteId;

  useEffect(() => {
    if (editorFocus) setSidebarCollapsed(true);
  }, [editorFocus, setSidebarCollapsed]);

  // Navigating anywhere else (another site, another section, admin) leaves the
  // wizard — the partially-set-up site is a valid intermediate to come back to.
  useEffect(() => {
    if (!creatingSite) return;
    if (selectedSiteId !== creatingSite.id || activeSiteSection !== 'overview' || sidebarMode !== 'sites') {
      setCreatingSite(null);
    }
  }, [creatingSite, selectedSiteId, activeSiteSection, sidebarMode]);

  async function handleCreateSite(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const site = await api.createSite(newName.trim(), newDomain.trim() || undefined);
      setSites((s) => [site.meta, ...s]);
      selectSite(site.meta.id);
      setNewName('');
      setNewDomain('');
      setShowAddSite(false);
      setActiveSiteSection('overview');
      // Chunk 9: land in the setup wizard instead of the bare Overview.
      setCreatingSite(site.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  function handleImported(siteId: string) {
    void refreshSites().then(() => {
      selectSite(siteId);
      setActiveSiteSection('overview');
    });
  }

  function renderAdminContent() {
    const common: Record<AdminSection, { title: string; description: string; body: React.ReactNode }> = {
      workspace: {
        title: 'Workspace',
        description: 'Agency name, timezone, and workspace overview.',
        body: (
          <div>
            {auth.workspace && (
              <p>
                <strong>{auth.workspace.name}</strong>{' '}
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '4px',
                    background: 'var(--border)',
                    textTransform: 'uppercase',
                  }}
                >
                  {auth.workspace.planTier}
                </span>
              </p>
            )}
            {auth.user && (
              <p className="dash-page__muted">
                Signed in as {auth.user.displayName} ({auth.user.email})
              </p>
            )}
            {!auth.workspace && (
              <p className="dash-page__muted">No workspace configured — use master key bootstrap.</p>
            )}
          </div>
        ),
      },
      users: {
        title: 'Team',
        description: 'Team members and their Save vs Publish permissions.',
        body: <TeamPage />,
      },
      'client-access': {
        title: 'Client Access',
        description: 'Overview of client access across all sites.',
        body: (
          <p>
            Per-site invites live under <strong>Site Settings → Access</strong>. This page will show a
            cross-site overview — TODO.
          </p>
        ),
      },
      integrations: {
        title: 'Integrations',
        description: 'Vercel, Firecrawl, On-Page.ai, and detection providers.',
        body: <AdminIntegrationsPage />,
      },
      email: {
        title: 'Email',
        description: 'Workspace email defaults (not the source of truth yet).',
        body: (
          <>
            <p>
              Email delivery is configured <strong>per site</strong> today via{' '}
              <code>SiteEmailConfig</code>. This admin page will hold workspace defaults and “apply to new
              sites” — TODO.
            </p>
            <p>Do not migrate per-site keys here without an explicit workspace storage model.</p>
          </>
        ),
      },
      'ai-providers': {
        title: 'AI Providers',
        description: 'OpenRouter and Anthropic BYOK for editor and blog AI.',
        body: <AdminAiProvidersPage />,
      },
      billing: {
        title: 'Billing',
        description: 'Subscription and usage.',
        body: <p>Billing — TODO.</p>,
      },
      defaults: {
        title: 'Defaults',
        description: 'Default Guardian rules, SEO defaults, media limits.',
        body: <p>Workspace defaults — TODO.</p>,
      },
      security: {
        title: 'Security',
        description: '2FA, login history, audit log.',
        body: <p>Security settings — TODO.</p>,
      },
    };
    const page = common[activeAdminSection];
    return (
      <AdminPage title={page.title} description={page.description}>
        {page.body}
      </AdminPage>
    );
  }

  function renderSiteContent() {
    if (!selectedSiteId) {
      return (
        <OverviewPage
          siteId={null}
          onSiteCreated={() => void refreshSites()}
          onImported={handleImported}
          onError={setError}
        />
      );
    }

    switch (activeSiteSection) {
      case 'overview':
        return (
          <OverviewPage
            siteId={selectedSiteId}
            siteName={selectedSite?.name}
            onSiteCreated={() => void refreshSites()}
            onImported={handleImported}
            onError={setError}
          />
        );
      case 'editor':
        return null;
      case 'pages':
        return <PagesPage siteId={selectedSiteId} />;
      case 'site-theme':
        return <SiteThemePage siteId={selectedSiteId} />;
      case 'media':
        return <MediaPage siteId={selectedSiteId} />;
      case 'forms':
        return (
          <FormsPage siteId={selectedSiteId} siteName={selectedSite?.name ?? 'Site'} />
        );
      case 'email-design':
        return <EmailDesignPage siteId={selectedSiteId} siteName={selectedSite?.name ?? 'Site'} />;
      case 'inbox':
        return <EmailInboxSection siteId={selectedSiteId} />;
      case 'blog':
        return <BlogPage siteId={selectedSiteId} />;
      case 'campaigns':
        return <CampaignsPage siteId={selectedSiteId} />;
      case 'social':
        return <SocialPage siteId={selectedSiteId} />;
      case 'seo':
        return <SeoPage siteId={selectedSiteId} />;
      case 'publishes':
        return (
          <PlaceholderPage
            title="Publishes"
            description="Publish history and deployment targets."
          />
        );
      case 'snapshots':
        return (
          <SnapshotsPage siteId={selectedSiteId} siteDomain={selectedSite?.domain} />
        );
      case 'settings':
        return <SettingsPage siteId={selectedSiteId} />;
      default:
        return null;
    }
  }

  const addSiteForm = (
    <form className="dash-sidebar__add-form" onSubmit={handleCreateSite}>
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="Site name"
        required
      />
      <input
        value={newDomain}
        onChange={(e) => setNewDomain(e.target.value)}
        placeholder="Domain (optional)"
      />
      <button type="submit">Create</button>
    </form>
  );

  return (
    <div className={`dashboard-shell${editorFocus ? ' dashboard-shell--editor-focus' : ''}`}>
      <Sidebar
        sites={sites}
        loading={loading}
        onAddSite={() => setShowAddSite((v) => !v)}
        showAddSite={showAddSite}
        addSiteForm={addSiteForm}
      />

      <div className="dashboard-main">
        <header className="topbar">
          <h1>
            {creatingSite
              ? `New Site — ${creatingSite.name}`
              : editorFocus
                ? `Editing — ${selectedSite?.name ?? 'Site'}`
                : sidebarMode === 'admin'
                  ? 'FreshPress Admin'
                  : 'FreshPress Dashboard'}
          </h1>
          <div className="spacer" />
          {editorFocus && (
            <button
              type="button"
              className="secondary"
              onClick={() => setActiveSiteSection('overview')}
            >
              Back to Overview
            </button>
          )}
          <button type="button" className="secondary" onClick={onLogout}>
            Sign out
          </button>
        </header>

        {error && !editorFocus && !creatingSite && <div className="error-banner dashboard-main__error">{error}</div>}

        <div className="dashboard-main__content">
          {creatingSite ? (
            <CreateSiteFlow
              siteId={creatingSite.id}
              siteName={creatingSite.name}
              onExit={() => setCreatingSite(null)}
              onApplied={() => {
                setCreatingSite(null);
                void refreshSites();
                setActiveSiteSection('pages');
              }}
            />
          ) : editorFocus && selectedSiteId ? (
            <Editor
              siteId={selectedSiteId}
              onBack={() => setActiveSiteSection('overview')}
              onLogout={onLogout}
              embedded
            />
          ) : sidebarMode === 'admin' ? (
            renderAdminContent()
          ) : (
            renderSiteContent()
          )}
        </div>
      </div>
    </div>
  );
}
