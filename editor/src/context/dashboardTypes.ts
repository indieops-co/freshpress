export type SidebarMode = 'sites' | 'admin';

export type SiteSection =
  | 'overview'
  | 'editor'
  | 'pages'
  | 'site-theme'
  | 'media'
  | 'forms'
  | 'email-design'
  | 'inbox'
  | 'blog'
  | 'campaigns'
  | 'social'
  | 'seo'
  | 'publishes'
  | 'snapshots'
  | 'settings';

export type AdminSection =
  | 'workspace'
  | 'users'
  | 'client-access'
  | 'integrations'
  | 'email'
  | 'ai-providers'
  | 'billing'
  | 'defaults'
  | 'security';

export const SITE_SECTIONS: SiteSection[] = [
  'overview',
  'editor',
  'pages',
  'site-theme',
  'media',
  'forms',
  'email-design',
  'inbox',
  'blog',
  'campaigns',
  'social',
  'seo',
  'publishes',
  'snapshots',
  'settings',
];

export const ADMIN_SECTIONS: AdminSection[] = [
  'workspace',
  'users',
  'client-access',
  'integrations',
  'email',
  'ai-providers',
  'billing',
  'defaults',
  'security',
];

export const SITE_SECTION_LABELS: Record<SiteSection, string> = {
  overview: 'Overview',
  editor: 'Editor',
  pages: 'Pages',
  'site-theme': 'Site Theme',
  media: 'Media',
  forms: 'Forms',
  'email-design': 'Email Design',
  inbox: 'Inbox',
  blog: 'Blog',
  campaigns: 'Campaigns',
  social: 'Social',
  seo: 'SEO',
  publishes: 'Publishes',
  snapshots: 'Snapshots',
  settings: 'Settings',
};

export const ADMIN_SECTION_LABELS: Record<AdminSection, string> = {
  workspace: 'Workspace',
  users: 'Users',
  'client-access': 'Client Access',
  integrations: 'Integrations',
  email: 'Email',
  'ai-providers': 'AI Providers',
  billing: 'Billing',
  defaults: 'Defaults',
  security: 'Security',
};

export interface DashboardState {
  selectedSiteId: string | null;
  sidebarMode: SidebarMode;
  activeSiteSection: SiteSection;
  activeAdminSection: AdminSection;
  sidebarCollapsed: boolean;
}
