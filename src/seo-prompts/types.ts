export type SeoPromptCategory = 'nextjs' | 'advanced-recipe';

export interface SeoPrompt {
  id: string;
  category: SeoPromptCategory;
  title: string;
  number: number;
  description?: string;
  content: string;
  source: 'headcheck';
}

export interface SeoPromptCollection {
  id: SeoPromptCategory;
  title: string;
  description: string;
  sourceUrl: string;
  prompts: SeoPrompt[];
}
