/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the public FreshPress docs site, used for in-app help links.
   * No docs site is hosted yet — set this (e.g. https://docs.yourfreshpress.com)
   * when one exists. Falls back to the GitHub-hosted markdown when unset.
   */
  readonly VITE_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
