export interface ContentSlot {
  id: string;
  type: 'text' | 'image' | 'link' | 'button';
  value: string;
  href?: string;
  alt?: string;
  tag: string;
  path: string;
}

export interface ElementStyleOverrides {
  padding?: string;
  margin?: string;
  radius?: string;
  shadow?: string;
  background?: string;
  textColor?: string;
}

export interface NamedElement {
  id: string;
  type: string;
  index: number;
  pageNumber: number;
  containerId: string;
  styleOverrides?: ElementStyleOverrides;
  customCss?: string;
  source: 'heuristic' | 'generated';
}

export interface ContainerNode {
  id: string;
  path: string;
  tag: string;
  suggestedType?: string;
  elementId?: string;
  slotIds: string[];
  children: ContainerNode[];
}

export interface PageContent {
  template: string;
  slots: Record<string, ContentSlot>;
  slotOrder: string[];
  containers?: ContainerNode[];
  namedElements?: Record<string, NamedElement>;
}

export interface SitePage {
  id: string;
  path: string;
  title: string;
  sourceUrl?: string;
  content: PageContent;
  updatedAt: string;
}

export interface SiteReviewState {
  status: 'pending';
  versionId: string;
  submittedBy: string;
  submittedAt: string;
  note?: string;
}

export interface SiteMeta {
  id: string;
  name: string;
  domain?: string;
  styleGuideId?: string;
  /** When true a site-password client may publish directly; otherwise they submit for review. */
  clientCanPublish?: boolean;
  /** Outstanding content review awaiting an approver with publish rights. */
  review?: SiteReviewState;
  createdAt: string;
  updatedAt: string;
}

export interface Site {
  meta: SiteMeta;
  pages: SitePage[];
  /** The current caller's resolved capabilities for this site (from GET /sites/:id). */
  capabilities?: { canPublish: boolean };
}

export interface SlotChange {
  slotId: string;
  value?: string;
  href?: string;
  alt?: string;
}

export interface SiteVersion {
  id: string;
  label: string;
  createdAt: string;
  publishId?: string;
}
