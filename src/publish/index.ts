import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import { renderPage } from '../content/render.js';
import { injectWatermark } from './watermark.js';
import type { StyleGuide } from '../design/style-guide.js';
import type { SitePage } from '../storage/types.js';

export interface PublishRecord {
  id: string;
  siteId: string;
  label: string;
  createdAt: string;
  pageCount: number;
  bundlePath: string;
  /** Content version captured immediately before this publish */
  prePublishVersionId?: string;
  deploymentUrl?: string;
  vercelDeploymentId?: string;
}

export interface VersionLink {
  id: string;
  label: string;
  publishId?: string;
}

export type RollbackResolveResult =
  | { ok: true; versionId: string }
  | { ok: false; error: string };

/** Resolve the content version to restore for a publish record (new links + legacy fallbacks). */
export function resolveRollbackVersionId(
  record: Pick<PublishRecord, 'id' | 'prePublishVersionId'>,
  versions: VersionLink[]
): RollbackResolveResult {
  if (record.prePublishVersionId) {
    const linked = versions.find((v) => v.id === record.prePublishVersionId);
    if (!linked) {
      return { ok: false, error: 'Linked content snapshot not found for this publish' };
    }
    if (linked.publishId && linked.publishId !== record.id) {
      return { ok: false, error: 'Publish and content snapshot link mismatch' };
    }
    return { ok: true, versionId: linked.id };
  }

  const byPublishId = versions.find((v) => v.publishId === record.id);
  if (byPublishId) return { ok: true, versionId: byPublishId.id };

  const byLabel = versions.find((v) => v.label === `Pre-publish ${record.id}`);
  if (byLabel) return { ok: true, versionId: byLabel.id };

  return { ok: false, error: 'No linked content snapshot for this publish' };
}

export interface PublishBundle {
  record: PublishRecord;
  files: Record<string, string>;
}

const PUBLISH_ROOT = process.env.DATA_DIR
  ? join(process.env.DATA_DIR, 'publishes')
  : join(process.cwd(), 'data', 'publishes');

function publishDir(siteId: string, publishId: string) {
  return join(PUBLISH_ROOT, siteId, publishId);
}

/** Render all pages into a static file map (path -> html) */
export function renderStaticBundle(pages: SitePage[], styleGuide?: StyleGuide): Record<string, string> {
  const files: Record<string, string> = {};

  for (const page of pages) {
    const html = renderPage(page.content, styleGuide);
    const filePath = page.path === '/' ? 'index.html' : `${page.path.replace(/^\//, '')}.html`;
    files[filePath] = wrapHtmlDocument(page.title, html);
  }

  if (!files['index.html'] && pages.length > 0) {
    const first = pages[0];
    files['index.html'] = wrapHtmlDocument(first.title, renderPage(first.content, styleGuide));
  }

  return files;
}

function wrapHtmlDocument(title: string, bodyHtml: string): string {
  if (bodyHtml.toLowerCase().includes('<html')) return bodyHtml;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Write immutable publish snapshot to disk */
export async function savePublishBundle(
  siteId: string,
  pages: SitePage[],
  label: string,
  extraFiles: Record<string, string> = {},
  styleGuide?: StyleGuide,
  watermark = false
): Promise<PublishBundle> {
  const id = nanoid(12);
  let files = { ...renderStaticBundle(pages, styleGuide), ...extraFiles };
  // Single choke point for the tier watermark: every .html in the snapshot (static
  // pages AND blog extraFiles) passes through here, including full-document pages
  // that wrapHtmlDocument leaves untouched.
  if (watermark) {
    files = Object.fromEntries(
      Object.entries(files).map(([path, content]) =>
        path.endsWith('.html') ? [path, injectWatermark(content)] : [path, content]
      )
    );
  }
  const dir = publishDir(siteId, id);
  await mkdir(dir, { recursive: true });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(dir, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }

  const record: PublishRecord = {
    id,
    siteId,
    label,
    createdAt: new Date().toISOString(),
    pageCount: pages.length,
    bundlePath: dir,
  };

  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...record, files: Object.keys(files) }, null, 2));

  return { record, files };
}

export async function listPublishes(siteId: string): Promise<PublishRecord[]> {
  const siteDir = join(PUBLISH_ROOT, siteId);
  try {
    const dirs = await readdir(siteDir);
    const records: PublishRecord[] = [];
    for (const dir of dirs) {
      try {
        const raw = await readFile(join(siteDir, dir, 'manifest.json'), 'utf-8');
        const manifest = JSON.parse(raw) as PublishRecord;
        records.push(manifest);
      } catch {
        // skip
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function getPublishBundle(siteId: string, publishId: string): Promise<PublishBundle | null> {
  try {
    const dir = publishDir(siteId, publishId);
    const raw = await readFile(join(dir, 'manifest.json'), 'utf-8');
    const record = JSON.parse(raw) as PublishRecord;
    const files: Record<string, string> = {};
    for (const file of (JSON.parse(raw) as { files: string[] }).files) {
      files[file] = await readFile(join(dir, file), 'utf-8');
    }
    return { record, files };
  } catch {
    return null;
  }
}

/** Deploy static bundle to Vercel via REST API */
export async function deployToVercel(
  record: PublishRecord,
  files: Record<string, string>,
  options: { token: string; projectName: string; teamId?: string }
): Promise<{ url: string; deploymentId: string }> {
  const fileEntries = Object.entries(files).map(([path, content]) => ({
    file: path,
    data: Buffer.from(content, 'utf-8').toString('base64'),
    encoding: 'base64' as const,
  }));

  const body = {
    name: options.projectName,
    files: fileEntries,
    projectSettings: { framework: null },
    target: 'production',
  };

  const url = options.teamId
    ? `https://api.vercel.com/v13/deployments?teamId=${options.teamId}`
    : 'https://api.vercel.com/v13/deployments';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vercel deploy failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { url: string; id: string };
  return { url: `https://${data.url}`, deploymentId: data.id };
}

export async function updatePublishRecord(record: PublishRecord): Promise<void> {
  const manifestPath = join(record.bundlePath, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  await writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, ...record }, null, 2)
  );
}
