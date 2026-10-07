import { useMemo, useState } from 'react';
import type { SiteMeta } from '../api';
import { useDashboard } from '../context/DashboardContext';
import { useAuth } from '../context/AuthContext';
import {
  ADMIN_SECTION_LABELS,
  ADMIN_SECTIONS,
  SITE_SECTION_LABELS,
  SITE_SECTIONS,
  type SiteSection,
} from '../context/dashboardTypes';

interface Props {
  sites: SiteMeta[];
  loading: boolean;
  onAddSite: () => void;
  showAddSite: boolean;
  addSiteForm: React.ReactNode;
}

function siteStatusLabel(site: SiteMeta): string | null {
  if (site.domain) return 'Live';
  return 'Draft';
}

export default function Sidebar({
  sites,
  loading,
  onAddSite,
  showAddSite,
  addSiteForm,
}: Props) {
  const { role, user } = useAuth();
  const isClient = role === 'client';
  // A save-only workspace member is a trusted content editor, not an agency admin.
  const isMember = user?.role === 'member';
  // Clients get the content editor (Pages → Editor) plus their Social drafts. Members get
  // that plus Overview and Media. Everything else — theme, publishes, settings, integrations,
  // generation, campaigns — stays owner/admin-only.
  const visibleSiteSections = useMemo<readonly SiteSection[]>(() => {
    if (isClient) return ['pages', 'editor', 'social'] as const;
    if (isMember) return ['overview', 'pages', 'editor', 'media', 'social'] as const;
    return SITE_SECTIONS;
  }, [isClient, isMember]);
  const {
    sidebarMode,
    sidebarCollapsed,
    selectedSiteId,
    activeSiteSection,
    activeAdminSection,
    selectSite,
    switchToAdmin,
    switchToSites,
    setActiveSiteSection,
    setActiveAdminSection,
    toggleSidebarCollapsed,
  } = useDashboard();

  const [search, setSearch] = useState('');

  const filteredSites = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.domain?.toLowerCase().includes(q) ?? false) ||
        s.id.toLowerCase().includes(q)
    );
  }, [sites, search]);

  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? null;

  return (
    <aside
      className={`dash-sidebar${sidebarCollapsed ? ' dash-sidebar--collapsed' : ''}`}
      aria-label="Dashboard navigation"
    >
      <div className="dash-sidebar__header">
          {isClient ? (
            <span className="dash-sidebar__brand">FreshPress</span>
          ) : (
            !sidebarCollapsed && (
              <span className="dash-sidebar__brand">
                {sidebarMode === 'admin' ? 'FreshPress Admin' : 'FreshPress'}
              </span>
            )
          )}
        <button
          type="button"
          className="secondary dash-sidebar__collapse"
          onClick={toggleSidebarCollapsed}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? '»' : '«'}
        </button>
      </div>

      {sidebarMode === 'admin' ? (
        <>
          <button type="button" className="secondary dash-sidebar__back" onClick={switchToSites}>
            {sidebarCollapsed ? '←' : '← Back to Sites'}
          </button>
          <nav className="dash-sidebar__nav">
            {ADMIN_SECTIONS.map((section) => (
              <button
                key={section}
                type="button"
                className={`dash-sidebar__nav-item${activeAdminSection === section ? ' active' : ''}`}
                onClick={() => setActiveAdminSection(section)}
                title={ADMIN_SECTION_LABELS[section]}
              >
                {sidebarCollapsed ? ADMIN_SECTION_LABELS[section][0] : ADMIN_SECTION_LABELS[section]}
              </button>
            ))}
          </nav>
        </>
      ) : (
        <>
          {!sidebarCollapsed && !isClient && (
            <>
              <button type="button" className="dash-sidebar__add" onClick={onAddSite}>
                + Add Site
              </button>
              {showAddSite && addSiteForm}
              <input
                className="dash-sidebar__search"
                placeholder="Search sites…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </>
          )}

          <div className="dash-sidebar__section-label">
            {!sidebarCollapsed && 'Client Sites'}
          </div>

          {loading ? (
            !sidebarCollapsed && <p className="dash-sidebar__muted">Loading…</p>
          ) : filteredSites.length === 0 ? (
            !sidebarCollapsed && (
              <p className="dash-sidebar__muted">No client sites yet</p>
            )
          ) : (
            <ul className="dash-sidebar__site-list">
              {filteredSites.map((site) => {
                const status = siteStatusLabel(site);
                return (
                  <li key={site.id}>
                    <button
                      type="button"
                      className={`dash-sidebar__site-item${selectedSiteId === site.id ? ' active' : ''}`}
                      onClick={() => selectSite(site.id)}
                      title={site.name}
                    >
                      <span className="dash-sidebar__site-name">{site.name}</span>
                      {!sidebarCollapsed && site.domain && (
                        <span className="dash-sidebar__site-domain">{site.domain}</span>
                      )}
                      {!sidebarCollapsed && status && (
                        <span className={`dash-sidebar__badge dash-sidebar__badge--${status.toLowerCase()}`}>
                          {status}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedSite && (
            <>
              <div className="dash-sidebar__section-label">
                {!sidebarCollapsed && selectedSite.name}
              </div>
              <nav className="dash-sidebar__nav">
                {visibleSiteSections.map((section) => (
                  <button
                    key={section}
                    type="button"
                    className={`dash-sidebar__nav-item${activeSiteSection === section ? ' active' : ''}`}
                    onClick={() => setActiveSiteSection(section)}
                    title={SITE_SECTION_LABELS[section]}
                  >
                    {sidebarCollapsed
                      ? SITE_SECTION_LABELS[section][0]
                      : SITE_SECTION_LABELS[section]}
                  </button>
                ))}
              </nav>
            </>
          )}

          {!isClient && !isMember && (
            <div className="dash-sidebar__footer">
              <button type="button" className="secondary" onClick={switchToAdmin}>
                {sidebarCollapsed ? '⚙' : 'Admin Settings'}
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
