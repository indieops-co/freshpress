import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ADMIN_SECTIONS,
  SITE_SECTIONS,
  type AdminSection,
  type DashboardState,
  type SidebarMode,
  type SiteSection,
} from './dashboardTypes';

const STORAGE_KEY = 'freshpress_dashboard';
const LEGACY_STORAGE_KEY = 'presspal_dashboard';

const DEFAULT_STATE: DashboardState = {
  selectedSiteId: null,
  sidebarMode: 'sites',
  activeSiteSection: 'overview',
  activeAdminSection: 'workspace',
  sidebarCollapsed: false,
};

function isSiteSection(value: unknown): value is SiteSection {
  return typeof value === 'string' && SITE_SECTIONS.includes(value as SiteSection);
}

function isAdminSection(value: unknown): value is AdminSection {
  return typeof value === 'string' && ADMIN_SECTIONS.includes(value as AdminSection);
}

function isSidebarMode(value: unknown): value is SidebarMode {
  return value === 'sites' || value === 'admin';
}

function loadPersistedState(): DashboardState {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        localStorage.setItem(STORAGE_KEY, raw);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<DashboardState>;
    return {
      selectedSiteId:
        typeof parsed.selectedSiteId === 'string' ? parsed.selectedSiteId : null,
      sidebarMode: isSidebarMode(parsed.sidebarMode) ? parsed.sidebarMode : 'sites',
      activeSiteSection: isSiteSection(parsed.activeSiteSection)
        ? parsed.activeSiteSection
        : 'overview',
      activeAdminSection: isAdminSection(parsed.activeAdminSection)
        ? parsed.activeAdminSection
        : 'workspace',
      sidebarCollapsed: parsed.sidebarCollapsed === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persistState(state: DashboardState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

interface DashboardContextValue extends DashboardState {
  selectSite: (siteId: string | null) => void;
  switchToAdmin: () => void;
  switchToSites: () => void;
  setActiveSiteSection: (section: SiteSection) => void;
  setActiveAdminSection: (section: AdminSection) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  validateSelectedSite: (siteIds: string[]) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  children,
  initialSiteId,
  initialSiteSection,
}: {
  children: ReactNode;
  initialSiteId?: string;
  initialSiteSection?: SiteSection;
}) {
  const [state, setState] = useState<DashboardState>(() => ({
    ...loadPersistedState(),
    ...(initialSiteId ? { selectedSiteId: initialSiteId, sidebarMode: 'sites' as const } : {}),
    ...(initialSiteSection ? { activeSiteSection: initialSiteSection } : {}),
  }));

  useEffect(() => {
    persistState(state);
  }, [state]);

  const update = useCallback((patch: Partial<DashboardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const selectSite = useCallback((siteId: string | null) => {
    setState((prev) => ({
      ...prev,
      selectedSiteId: siteId,
      sidebarMode: 'sites',
      activeSiteSection: siteId ? prev.activeSiteSection : 'overview',
    }));
  }, []);

  const switchToAdmin = useCallback(() => {
    update({ sidebarMode: 'admin' });
  }, [update]);

  const switchToSites = useCallback(() => {
    update({ sidebarMode: 'sites' });
  }, [update]);

  const setActiveSiteSection = useCallback((section: SiteSection) => {
    update({ activeSiteSection: section, sidebarMode: 'sites' });
  }, [update]);

  const setActiveAdminSection = useCallback((section: AdminSection) => {
    update({ activeAdminSection: section, sidebarMode: 'admin' });
  }, [update]);

  const toggleSidebarCollapsed = useCallback(() => {
    setState((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    update({ sidebarCollapsed: collapsed });
  }, [update]);

  const validateSelectedSite = useCallback((siteIds: string[]) => {
    setState((prev) => {
      if (!prev.selectedSiteId) return prev;
      if (siteIds.includes(prev.selectedSiteId)) return prev;
      return { ...prev, selectedSiteId: null, activeSiteSection: 'overview' };
    });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      selectSite,
      switchToAdmin,
      switchToSites,
      setActiveSiteSection,
      setActiveAdminSection,
      toggleSidebarCollapsed,
      setSidebarCollapsed,
      validateSelectedSite,
    }),
    [
      state,
      selectSite,
      switchToAdmin,
      switchToSites,
      setActiveSiteSection,
      setActiveAdminSection,
      toggleSidebarCollapsed,
      setSidebarCollapsed,
      validateSelectedSite,
    ]
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
}
