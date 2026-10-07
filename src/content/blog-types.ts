export interface Author {
  id: string;
  siteId: string;
  wpAuthorId?: number;
  login?: string;
  displayName: string;
  email: string;
  url?: string;
  avatarPath?: string;
  createdAt: string;
}

export interface Category {
  id: string;
  siteId: string;
  wpTermId?: number;
  name: string;
  slug: string;
  parentId?: string;
  /** Breadcrumb path of slugs, root → leaf */
  path: string[];
  createdAt: string;
}

export interface Tag {
  id: string;
  siteId: string;
  wpTermId?: number;
  name: string;
  slug: string;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  siteId: string;
  wpPostId?: number;
  filename: string;
  /** Public URL path e.g. /media/{siteId}/wp-content/uploads/2024/01/file.jpg */
  publicPath: string;
  /** Relative path under wp-content/uploads */
  relativePath: string;
  mimeType?: string;
  sourceUrl?: string;
  createdAt: string;
}

export type ArticleType = 'post' | 'page';
export type ArticleStatus = 'publish' | 'draft' | 'private' | 'pending' | 'future' | 'trash';

export interface Article {
  id: string;
  siteId: string;
  wpPostId?: number;
  type: ArticleType;
  title: string;
  slug: string;
  contentHtml: string;
  excerpt?: string;
  authorId?: string;
  categoryIds: string[];
  tagIds: string[];
  featuredMediaId?: string;
  status: ArticleStatus;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  siteId: string;
  wpCommentId?: number;
  articleId: string;
  parentId?: string;
  authorName: string;
  authorEmail?: string;
  authorUrl?: string;
  content: string;
  status: string;
  createdAt: string;
}

export type ImportJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ImportJobStats {
  authors: number;
  categories: number;
  tags: number;
  attachments: number;
  articles: number;
  comments: number;
  sitePages: number;
  mediaFailed: number;
}

export interface ImportJob {
  id: string;
  siteId: string;
  status: ImportJobStatus;
  progress: number;
  currentStep?: string;
  errors: string[];
  stats: ImportJobStats;
  createdAt: string;
  updatedAt: string;
}

export interface ImportPreview {
  siteName: string;
  siteUrl?: string;
  suggestedDomain?: string;
  counts: ImportJobStats;
  authors: Array<{ login: string; displayName: string; email: string }>;
  pages: Array<{ slug: string; title: string; wpPostId: number }>;
}
