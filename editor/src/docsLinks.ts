/**
 * The PUBLIC free-core repo — the only FreshPress repo customers can open. In-app links
 * must never point at the private dev repo (customers get a 404). If the repos move to
 * another GitHub org, this is the one line to change.
 */
export const PUBLIC_REPO_URL = 'https://github.com/indieops-co/freshpress';

/**
 * End-user guide link. No docs site is hosted yet, so this defaults to the guide's
 * markdown in the public repo (the doc must be in sync-public-core.sh ALLOW_DOCS); set
 * VITE_DOCS_URL to a real docs site when one exists and links follow it.
 */
export function guideUrl(docsSitePath: string, repoDocPath: string): string {
  const docsBase = import.meta.env.VITE_DOCS_URL;
  return docsBase
    ? `${docsBase.replace(/\/+$/, '')}/${docsSitePath}`
    : `${PUBLIC_REPO_URL}/blob/main/${repoDocPath}`;
}
