import { ZipArchive } from 'archiver';
import { PassThrough } from 'node:stream';
import type { WordPressThemeExport } from './export.js';

/** Bundle theme files into a ZIP buffer for download */
export function createThemeZip(exportData: WordPressThemeExport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(stream);

    const root = exportData.themeSlug;
    for (const [filePath, content] of Object.entries(exportData.files)) {
      archive.append(content, { name: `${root}/${filePath}` });
    }

    void archive.finalize();
  });
}
