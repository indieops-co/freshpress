import { Router } from 'express';
import { getStorage } from '../storage/filesystem.js';
import { requireOwner } from '../auth/middleware.js';
import { buildWordPressTheme, type WordPressExportOptions } from '../wordpress/export.js';
import { createThemeZip } from '../wordpress/zip.js';
import { routeParam } from '../util/params.js';
import { getStyleGuideStore } from '../storage/style-guides.js';
import { getWorkspaceUsersStore } from '../storage/workspace-users.js';
import { hasFeature } from '../auth/entitlements.js';
import { getDesignMdCached } from '../design/awesome-design-md.js';
import { extractFontSubstitutesNote } from '../design/parse-design-md.js';

const router = Router();

/**
 * Best-effort: a site with no StyleGuide (or a failed guide read) still
 * exports — it just ships without the bundled theme stylesheet/notes.
 */
async function loadExportOptions(siteId: string): Promise<WordPressExportOptions> {
  // Tier watermark mirrors the publish pipeline: no workspace exports like free.
  const workspace = await (await getWorkspaceUsersStore()).getWorkspace();
  const watermark = !hasFeature(workspace?.planTier ?? 'free', 'removeWatermark');
  try {
    const store = await getStyleGuideStore();
    const styleGuide = await store.get(siteId);
    if (!styleGuide) return { watermark };
    let fontSubstitutesNote: string | undefined;
    if (styleGuide.meta.source === 'awesome-design-md' && styleGuide.meta.sourceRef) {
      try {
        const rawMd = await getDesignMdCached(styleGuide.meta.sourceRef);
        fontSubstitutesNote = extractFontSubstitutesNote(rawMd) || undefined;
      } catch {
        // vendored DESIGN.md missing — THEME-NOTES falls back to the verify-licensing note
      }
    }
    return { styleGuide, fontSubstitutesNote, watermark };
  } catch (err) {
    console.warn(`[wordpress] StyleGuide load failed for ${siteId}; exporting without theme bundle:`, err);
    return { watermark };
  }
}

/** Download site as WordPress theme ZIP */
router.get('/sites/:siteId/wordpress/download', requireOwner, async (req, res) => {
  try {
    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }
    if (site.pages.length === 0) {
      res.status(400).json({ error: 'No pages to export — ingest at least one page first' });
      return;
    }

    const theme = buildWordPressTheme(site, await loadExportOptions(site.meta.id));
    const zip = await createThemeZip(theme);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${theme.themeSlug}-wordpress-theme.zip"`
    );
    res.send(zip);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Export failed' });
  }
});

/** Preview export metadata without downloading */
router.get('/sites/:siteId/wordpress', requireOwner, async (req, res) => {
  try {
    const storage = await getStorage();
    const site = await storage.getSite(routeParam(req.params.siteId));
    if (!site) {
      res.status(404).json({ error: 'Site not found' });
      return;
    }

    const theme = buildWordPressTheme(site, await loadExportOptions(site.meta.id));
    res.json({
      themeSlug: theme.themeSlug,
      themeName: theme.themeName,
      pageCount: site.pages.length,
      slotCount: Object.keys(JSON.parse(theme.files['inc/slots.json'])).length,
      files: Object.keys(theme.files),
      includes: [
        'INSTALL.md',
        'ANIMATIONS.md',
        ...(theme.files['THEME-NOTES.md'] ? ['THEME-NOTES.md'] : []),
        'inc/slots.json',
        'PHP page templates',
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Preview failed' });
  }
});

export default router;
