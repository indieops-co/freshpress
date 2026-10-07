import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export interface MediaMigratorOptions {
  siteId: string;
  publicDir: string;
  sourceBaseUrl?: string;
  uploadsZipPath?: string;
  maxFileSizeBytes?: number;
}

export interface MigrateMediaResult {
  relativePath: string;
  publicPath: string;
  sourceUrl?: string;
  failed?: boolean;
  error?: string;
}

function mediaPublicPath(siteId: string, relativePath: string): string {
  return `/media/${siteId}/wp-content/uploads/${relativePath.replace(/^\/+/, '')}`;
}

function normalizeRelativePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/^wp-content\/uploads\//, '');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Extract relative uploads path from a full attachment URL */
export function relativePathFromUrl(url: string, sourceBaseUrl?: string): string | null {
  try {
    const parsed = new URL(url);
    const idx = parsed.pathname.indexOf('/wp-content/uploads/');
    if (idx >= 0) {
      return parsed.pathname.slice(idx + '/wp-content/uploads/'.length);
    }
    if (sourceBaseUrl) {
      const base = new URL(sourceBaseUrl);
      if (parsed.hostname === base.hostname && parsed.pathname.startsWith('/wp-content/uploads/')) {
        return parsed.pathname.slice('/wp-content/uploads/'.length);
      }
    }
  } catch {
    // not a valid URL
  }
  return null;
}

export class MediaMigrator {
  private zipIndex = new Map<string, Buffer>();
  private zipLoaded = false;

  constructor(private opts: MediaMigratorOptions) {}

  async migrateFromUrl(url: string, attachedFile?: string): Promise<MigrateMediaResult> {
    const relative =
      (attachedFile ? normalizeRelativePath(attachedFile) : null) ??
      relativePathFromUrl(url, this.opts.sourceBaseUrl);

    if (!relative) {
      return { relativePath: '', publicPath: url, sourceUrl: url, failed: true, error: 'Could not resolve uploads path' };
    }

    const destPath = join(this.opts.publicDir, 'wp-content', 'uploads', relative);
    const publicPath = mediaPublicPath(this.opts.siteId, relative);

    if (await fileExists(destPath)) {
      return { relativePath: relative, publicPath, sourceUrl: url };
    }

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'FreshPress-Import/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buf = Buffer.from(await response.arrayBuffer());
      const max = this.opts.maxFileSizeBytes ?? 50 * 1024 * 1024;
      if (buf.length > max) throw new Error('File exceeds size limit');
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, buf);
      return { relativePath: relative, publicPath, sourceUrl: url };
    } catch (err) {
      if (this.opts.uploadsZipPath) {
        const zipResult = await this.migrateFromZip(relative);
        if (zipResult && !zipResult.failed) return { ...zipResult, sourceUrl: url };
      }
      return {
        relativePath: relative,
        publicPath: url,
        sourceUrl: url,
        failed: true,
        error: err instanceof Error ? err.message : 'Download failed',
      };
    }
  }

  async migrateFromZip(relativePath: string): Promise<MigrateMediaResult | null> {
    if (!this.opts.uploadsZipPath) return null;
    await this.loadZipIndex();

    const normalized = normalizeRelativePath(relativePath);
    const buf = this.zipIndex.get(normalized);
    if (!buf) return null;

    const destPath = join(this.opts.publicDir, 'wp-content', 'uploads', normalized);
    const publicPath = mediaPublicPath(this.opts.siteId, normalized);

    if (!(await fileExists(destPath))) {
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, buf);
    }

    return { relativePath: normalized, publicPath };
  }

  /** Write raw bytes to uploads path (avatars etc.) */
  async writeBytes(relativePath: string, data: Buffer): Promise<MigrateMediaResult> {
    const normalized = normalizeRelativePath(relativePath);
    const destPath = join(this.opts.publicDir, 'wp-content', 'uploads', normalized);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, data);
    return {
      relativePath: normalized,
      publicPath: mediaPublicPath(this.opts.siteId, normalized),
    };
  }

  private async loadZipIndex(): Promise<void> {
    if (this.zipLoaded || !this.opts.uploadsZipPath) return;
    this.zipLoaded = true;

    const data = await readFile(this.opts.uploadsZipPath);
    let offset = 0;

    while (offset < data.length - 30) {
      if (data.readUInt32LE(offset) !== 0x04034b50) {
        offset++;
        continue;
      }
      const compMethod = data.readUInt16LE(offset + 8);
      const compSize = data.readUInt32LE(offset + 18);
      const nameLen = data.readUInt16LE(offset + 26);
      const extraLen = data.readUInt16LE(offset + 28);
      const name = data.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
      const dataStart = offset + 30 + nameLen + extraLen;
      const raw = data.subarray(dataStart, dataStart + compSize);

      const normalized = name.replace(/\\/g, '/');
      if (normalized.includes('uploads/')) {
        const idx = normalized.indexOf('uploads/');
        const rel = normalized.slice(idx + 'uploads/'.length);
        if (rel && !normalized.endsWith('/')) {
          try {
            const buf =
              compMethod === 0 ? Buffer.from(raw) : compMethod === 8 ? inflateRawSync(raw) : null;
            if (buf) this.zipIndex.set(rel, buf);
          } catch {
            // skip corrupt entry
          }
        }
      }

      offset = dataStart + compSize;
    }
  }
}

/** Rewrite attachment URLs in HTML content to local media paths */
export function rewriteContentUrls(html: string, urlMap: Map<string, string>): string {
  let result = html;
  for (const [oldUrl, newPath] of urlMap) {
    result = result.split(oldUrl).join(newPath);
    const encoded = oldUrl.replace(/&/g, '&amp;');
    if (encoded !== oldUrl) result = result.split(encoded).join(newPath);
  }
  return result;
}

export { mediaPublicPath, normalizeRelativePath };
