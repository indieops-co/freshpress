export type BlogPostKind = 'pillar' | 'supportive';
export type BlogPostStatus = 'draft' | 'published' | 'scheduled';

export interface BlogPillar {
  id: string;
  siteId: string;
  keyword: string;
  slug: string;
  title: string;
  metaTitle?: string;
  metaDescription?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlogPost {
  id: string;
  siteId: string;
  pillarId: string;
  kind: BlogPostKind;
  title: string;
  slug: string;
  keyword: string;
  bodyHtml: string;
  status: BlogPostStatus;
  metaTitle?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  order: number;
  publishedAt?: string;
  socialGenerationMeta?: {
    runCount: number;
    usedSections: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface BlogSiloView {
  pillar: BlogPillar;
  posts: BlogPost[];
}
