import { useEffect, useState } from 'react';
import { api, type StyleGuidePreview } from '../../api';
import ThemePreview from './ThemePreview';

/**
 * Chunk 9 follow-up: the vendored brand-theme gallery, rehomed from the
 * deleted DesignStep onboarding screen. One job: browse the analysed themes
 * (or paste any awesome-design-md URL), preview live, and replace the site's
 * active StyleGuide. Preview-first — nothing changes until the explicit
 * apply click — so there's deliberately no confirm modal on top.
 */

interface Props {
  siteId: string;
  /** Open the disclosure on mount (the no-theme-yet empty state does this). */
  defaultOpen?: boolean;
  /** Called after a successful apply so the page can reload guide state. */
  onApplied: () => Promise<void> | void;
}

export default function SwitchThemePanel({ siteId, defaultOpen = false, onApplied }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [themes, setThemes] = useState<Array<{ id: string; name: string; desc: string; aesthetic: string }> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<StyleGuidePreview | null>(null);
  const [previewStylesheet, setPreviewStylesheet] = useState<string | undefined>(undefined);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [themeUrl, setThemeUrl] = useState('');
  const [urlPreviewed, setUrlPreviewed] = useState(false);
  const [error, setError] = useState('');

  // Lazy: the list only loads the first time the panel is actually open
  // (covers both the disclosure click and defaultOpen mounting).
  useEffect(() => {
    if (!open || themes !== null) return;
    api.listDesignThemes().then((r) => setThemes(r.themes)).catch((e) => setError(e.message));
  }, [open, themes]);

  async function selectTheme(themeId: string) {
    setSelectedId(themeId);
    setUrlPreviewed(false);
    setLoadingPreview(true);
    setError('');
    try {
      const res = await api.previewDesignTheme(siteId, themeId);
      setPreview(res.styleGuide);
      setPreviewStylesheet(res.stylesheet);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoadingPreview(false);
    }
  }

  async function previewThemeUrl() {
    if (!themeUrl.trim() || loadingPreview) return;
    setSelectedId(null);
    setUrlPreviewed(false);
    setLoadingPreview(true);
    setError('');
    try {
      const res = await api.previewDesignThemeUrl(siteId, themeUrl.trim());
      setPreview(res.styleGuide);
      setPreviewStylesheet(res.stylesheet);
      setUrlPreviewed(true);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoadingPreview(false);
    }
  }

  async function applyTheme() {
    if ((!selectedId && !urlPreviewed) || applying) return;
    setApplying(true);
    setError('');
    try {
      if (urlPreviewed) {
        await api.applyDesignThemeUrl(siteId, themeUrl.trim());
      } else {
        await api.applyDesignTheme(siteId, selectedId!);
      }
      await onApplied();
      setPreview(null);
      setSelectedId(null);
      setUrlPreviewed(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  }

  const selectedName = selectedId ? themes?.find((t) => t.id === selectedId)?.name : undefined;

  return (
    <section className="panel settings-card settings-card--full">
      <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} Switch theme
      </button>
      {!open && (
        <p className="dash-page__muted" style={{ margin: '0.25rem 0 0' }}>
          Start over from one of {themes?.length || 20} professionally analysed brand design systems.
        </p>
      )}

      {open && (
        <>
          {error && <p className="dash-page__error">{error}</p>}
          <div className="design-step__layout" style={{ marginTop: '0.75rem' }}>
            <div className="design-step__themes">
              <ul className="design-theme-list">
                {(themes ?? []).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`design-theme-list__item${selectedId === t.id ? ' design-theme-list__item--active' : ''}`}
                      onClick={() => void selectTheme(t.id)}
                    >
                      <strong>{t.name}</strong>
                      <span>{t.desc}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <p className="dash-page__muted" style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
                  Or paste any DESIGN.md link from{' '}
                  <a href="https://github.com/VoltAgent/awesome-design-md/tree/main/design-md" target="_blank" rel="noreferrer">
                    awesome-design-md
                  </a>{' '}
                  — 70+ brands.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="url"
                    value={themeUrl}
                    onChange={(e) => setThemeUrl(e.target.value)}
                    placeholder="https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/stripe/DESIGN.md"
                    style={{ flex: 1, minWidth: 0 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void previewThemeUrl();
                    }}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={!themeUrl.trim() || loadingPreview}
                    onClick={() => void previewThemeUrl()}
                  >
                    Preview
                  </button>
                </div>
              </div>
            </div>

            <div className="design-step__preview">
              {loadingPreview && <p className="dash-page__muted">Loading preview…</p>}
              {!loadingPreview && preview && <ThemePreview guide={preview} stylesheet={previewStylesheet} />}
              {!loadingPreview && !preview && <p className="dash-page__muted">Select a theme to preview.</p>}
            </div>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={(!selectedId && !urlPreviewed) || applying} onClick={() => void applyTheme()}>
              {applying ? 'Applying…' : selectedName ? `Replace theme with ${selectedName}` : 'Use this theme'}
            </button>
            <span className="dash-page__muted" style={{ fontSize: '0.8rem' }}>
              Replaces every current theme token and site custom CSS.
            </span>
          </div>
        </>
      )}
    </section>
  );
}
