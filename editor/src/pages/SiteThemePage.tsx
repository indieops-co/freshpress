import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import { api, type EditableField, type ExtractedBrand, type SiteStyleGuide } from '../api';
import ElementSpecimen from '../components/design/ElementSpecimen';
import SwitchThemePanel from '../components/design/SwitchThemePanel';
import VoiceToneSection from '../components/VoiceToneSection';
import { BrandResearchSection } from '@paid';

interface Props {
  siteId: string;
}

/** Assign a leaf value into a nested object at a dotted path (used to build patches and the JSON slice). */
function assignPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let node = target;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      node[key] = value;
    } else {
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
  });
}

/** Build a nested patch object from a dotted path + leaf value ("components.card.radius" → {components:{card:{radius:v}}}). */
function nestPath(path: string, value: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  assignPath(root, path, value);
  return root;
}

/** Editable token fields (minus the raw-CSS field) → path→string draft map for the controlled inputs. */
function draftsFromFields(fields: EditableField[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const f of fields) {
    if (f.kind.kind === 'site-css') continue;
    drafts[f.path] = f.current == null ? '' : String(f.current);
  }
  return drafts;
}

/** Editable token fields (minus raw-CSS) re-nested into a pretty JSON slice for the Advanced panel. */
function jsonSliceFromFields(fields: EditableField[]): string {
  const slice: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.kind.kind === 'site-css') continue;
    assignPath(slice, f.path, f.current);
  }
  return JSON.stringify(slice, null, 2);
}

const SECTION_ORDER = ['Theme', 'Colors', 'Typography', 'Spacing, Radius & Shadow', 'Components & Motion', 'Other'];

function sectionOf(path: string): string | null {
  if (path === 'customCss') return null; // dedicated Advanced panel
  if (path === 'meta.name') return 'Theme';
  if (path.startsWith('colors')) return 'Colors';
  if (path.startsWith('typography')) return 'Typography';
  if (path.startsWith('spacing') || path.startsWith('radii') || path.startsWith('shadows')) {
    return 'Spacing, Radius & Shadow';
  }
  if (path.startsWith('components') || path.startsWith('motion')) return 'Components & Motion';
  return 'Other';
}

/** Short human label for a field, from the tail of its path. */
function fieldLabel(path: string): string {
  return path.replace(/^colors\.custom\./, 'custom · ').replace(/\./g, ' · ');
}

const SPECIMENS: Array<{ label: string; elementType: string; render: () => ReactElement }> = [
  { label: 'Title / h1', elementType: 'Title / h1', render: () => <h1 className="fp-h1">The quick brown fox</h1> },
  { label: 'Heading / h3', elementType: 'Heading / h3', render: () => <h3 className="fp-h3">Section heading</h3> },
  {
    label: 'Body text',
    elementType: 'Body text',
    render: () => <p className="fp-body">Body copy renders with the live theme&rsquo;s type scale and spacing.</p>,
  },
  { label: 'Button · Primary', elementType: 'Button · Primary', render: () => <button type="button" className="fp-btn-primary">Get started</button> },
  { label: 'Button · Secondary', elementType: 'Button · Secondary', render: () => <button type="button" className="fp-btn-secondary">Learn more</button> },
  {
    label: 'InfoCard',
    elementType: 'InfoCard',
    render: () => (
      <div className="fp-card">
        <h3 className="fp-h3" style={{ margin: '0 0 0.5rem' }}>Ship faster</h3>
        <p className="fp-body" style={{ margin: 0, color: 'var(--fp-text-muted)' }}>A real .fp-card element.</p>
      </div>
    ),
  },
  {
    label: 'Nav',
    elementType: 'Nav',
    render: () => (
      <nav className="fp-nav" style={{ borderRadius: 8 }}>
        <strong>Brand</strong>
        <button type="button" className="fp-btn-primary">Sign up</button>
      </nav>
    ),
  },
  {
    label: 'Footer',
    elementType: 'Footer',
    render: () => (
      <footer className="fp-footer" style={{ borderRadius: 8 }}>
        <small>© Your Company</small>
      </footer>
    ),
  },
];

export default function SiteThemePage({ siteId }: Props) {
  const [guide, setGuide] = useState<SiteStyleGuide | null>(null);
  const [stylesheet, setStylesheet] = useState('');
  const [fields, setFields] = useState<EditableField[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [noGuide, setNoGuide] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatReply, setChatReply] = useState('');

  const [jsonDraft, setJsonDraft] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [customCssDraft, setCustomCssDraft] = useState('');
  const [showCustomCss, setShowCustomCss] = useState(false);

  // Amendment F — extract brand from a URL (reviewable draft → explicit apply).
  const [extractUrl, setExtractUrl] = useState('');
  const [extractBusy, setExtractBusy] = useState(false);
  const [extractDraft, setExtractDraft] = useState<{ extracted: ExtractedBrand; patch: Record<string, unknown> } | null>(null);
  const [extractError, setExtractError] = useState('');

  // Held here, not in ImportDesignMdPanel: a first import on a theme-less site swaps the page to its
  // themed layout, which remounts the panel — its name fields and success message would vanish.
  const [importForm, setImportForm] = useState<ImportDesignForm>(EMPTY_IMPORT_FORM);
  useEffect(() => setImportForm(EMPTY_IMPORT_FORM), [siteId]);

  const loadFields = useCallback(
    async (elementType: string | null) => {
      const r = await api.getDesignEditable(siteId, elementType ?? undefined);
      setFields(r.fields);
      setDrafts(draftsFromFields(r.fields));
      setJsonDraft(jsonSliceFromFields(r.fields));
    },
    [siteId]
  );

  // Guide (stylesheet + customCss) is site-wide; refetch only when the site changes. A transient
  // failure here — not on a scope change or a fields fetch — is the only thing that shows the empty state.
  const loadGuide = useCallback(async () => {
    try {
      const r = await api.getSiteStyleGuide(siteId);
      setGuide(r.styleGuide);
      setStylesheet(r.stylesheet);
      setCustomCssDraft(r.styleGuide.customCss ?? '');
      setNoGuide(false);
    } catch {
      setNoGuide(true);
      setGuide(null);
    }
  }, [siteId]);

  useEffect(() => {
    void loadGuide();
  }, [loadGuide]);

  // The editable field slice is scope-dependent — reload it on scope change without touching the guide,
  // so clicking a specimen never blanks the page and never resets the site-wide Custom CSS textarea.
  useEffect(() => {
    void loadFields(scope).catch(() => {});
  }, [siteId, scope, loadFields]);

  function selectScope(elementType: string) {
    setScope((prev) => (prev === elementType ? null : elementType));
  }

  /**
   * Persist a patch. For a single-field commit, update just that field locally (don't re-pull the whole
   * field list) so a save resolving while the user types in another field can't wipe their in-progress edit.
   * Multi-field applies (JSON panel) re-sync the full slice.
   */
  async function applyPatch(patch: Record<string, unknown>, single?: { path: string; value: unknown }) {
    setStatus('Saving…');
    setError('');
    try {
      const r = await api.patchSiteDesign(siteId, patch, scope ?? undefined);
      setGuide(r.styleGuide);
      setStylesheet(r.stylesheet);
      setCustomCssDraft(r.styleGuide.customCss ?? '');
      if (single) {
        setFields((fs) => fs.map((f) => (f.path === single.path ? { ...f, current: single.value } : f)));
        setDrafts((d) => ({ ...d, [single.path]: single.value == null ? '' : String(single.value) }));
      } else {
        await loadFields(scope);
      }
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('');
    }
  }

  function commitField(field: EditableField, override?: string) {
    const raw = override ?? drafts[field.path] ?? '';
    const currentStr = field.current == null ? '' : String(field.current);
    if (raw === currentStr) return; // no-op (covers unchanged and untouched null-current fields)
    let value: unknown = raw;
    if (field.kind.kind === 'number') {
      if (raw.trim() === '' || Number.isNaN(Number(raw))) {
        setError(`${fieldLabel(field.path)} must be a number`);
        return;
      }
      value = Number(raw);
    }
    void applyPatch(nestPath(field.path, value), { path: field.path, value });
  }

  function toggleJson() {
    // Rebuild the slice from the latest committed field values whenever the panel opens.
    setShowJson((v) => {
      if (!v) setJsonDraft(jsonSliceFromFields(fields));
      return !v;
    });
  }

  async function sendChat() {
    const message = chatInput.trim();
    if (!message) return;
    setChatBusy(true);
    setError('');
    setChatReply('');
    try {
      const r = await api.siteDesignChat(siteId, message, scope ?? undefined);
      setGuide(r.styleGuide);
      setStylesheet(r.stylesheet);
      setCustomCssDraft(r.styleGuide.customCss ?? '');
      await loadFields(scope);
      setChatReply(r.explanation);
      setChatInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Theme chat failed');
    } finally {
      setChatBusy(false);
    }
  }

  function applyJson() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonDraft);
    } catch {
      setError('Structured panel: invalid JSON');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) {
      setError('Structured panel: JSON must be an object');
      return;
    }
    void applyPatch(parsed as Record<string, unknown>);
  }

  function saveCustomCss() {
    // Site-wide custom CSS is global — never send it under an element scope.
    setStatus('Saving…');
    setError('');
    api
      .patchSiteDesign(siteId, { customCss: customCssDraft })
      .then((r) => {
        setGuide(r.styleGuide);
        setStylesheet(r.stylesheet);
        setStatus('Saved');
        setTimeout(() => setStatus(''), 2000);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Save failed');
        setStatus('');
      });
  }

  async function runExtract() {
    const url = extractUrl.trim();
    if (!url) return;
    setExtractBusy(true);
    setExtractError('');
    setExtractDraft(null);
    try {
      const r = await api.extractBrand(siteId, url);
      setExtractDraft(r);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtractBusy(false);
    }
  }

  async function applyExtract() {
    if (!extractDraft) return;
    if (Object.keys(extractDraft.patch).length === 0) {
      setExtractError('Nothing to apply — extraction found no theme tokens on that page.');
      return;
    }
    setStatus('Applying extracted brand…');
    setError('');
    try {
      // The extracted patch is whole-theme (colors/fonts) — apply un-scoped through the validated path.
      const r = await api.patchSiteDesign(siteId, extractDraft.patch);
      setGuide(r.styleGuide);
      setStylesheet(r.stylesheet);
      setCustomCssDraft(r.styleGuide.customCss ?? '');
      await loadFields(scope);
      setExtractDraft(null);
      setExtractUrl('');
      setStatus('Applied extracted brand');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      // Keep the error in the extract panel (next to the draft the user is looking at), consistent
      // with runExtract — not the page-level banner.
      setExtractError(err instanceof Error ? err.message : 'Apply failed');
      setStatus('');
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, EditableField[]>();
    for (const f of fields) {
      const section = sectionOf(f.path);
      if (!section) continue;
      if (!map.has(section)) map.set(section, []);
      map.get(section)!.push(f);
    }
    return map;
  }, [fields]);

  if (noGuide) {
    return (
      <div className="dash-page">
        <h2 className="dash-page__title">Site Theme</h2>
        <p className="dash-page__muted">
          This site doesn&rsquo;t have a design system yet — apply a brand theme below to get started,
          then fine-tune every token here.
        </p>
        <SwitchThemePanel
          siteId={siteId}
          defaultOpen
          onApplied={async () => {
            await loadGuide();
            await loadFields(scope);
          }}
        />
        <ImportDesignMdPanel
          siteId={siteId}
          form={importForm}
          setForm={setImportForm}
          onApplied={async () => {
            await loadGuide();
            await loadFields(scope);
          }}
        />
      </div>
    );
  }

  return (
    <div className="dash-page site-theme-page">
      <style>{stylesheet}</style>
      <h2 className="dash-page__title">Site Theme{guide?.meta.name ? ` · ${guide.meta.name}` : ''}</h2>
      <p className="dash-page__muted">
        Every token below renders as the real element it controls. Click a specimen to focus edits on that
        element type, then tweak it with the fields, the structured JSON, or the AI chat — all validated
        through one path.
      </p>
      {status && <p className="status-ok">{status}</p>}
      {error && <p className="dash-page__error">{error}</p>}

      {scope && (
        <div className="chat-scope-pill" style={{ marginBottom: '0.75rem' }}>
          Editing: {scope}
          <button type="button" onClick={() => setScope(null)} aria-label="Clear scope">
            ×
          </button>
        </div>
      )}

      {/* ── Extract brand from a URL (Amendment F) ───────────────────── */}
      <section className="panel settings-card settings-card--full">
        <h3>Extract brand from a URL</h3>
        <p className="dash-page__muted">
          Point at your old site (or any site you love) to pull its colors, fonts, and logo into a
          reviewable draft. Nothing changes until you click <strong>Apply to theme</strong>.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <input
            value={extractUrl}
            onChange={(e) => setExtractUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runExtract();
            }}
            placeholder="https://example.com"
            aria-label="URL to extract brand from"
            style={{ flex: '1 1 320px' }}
            disabled={extractBusy}
          />
          <button type="button" onClick={() => void runExtract()} disabled={extractBusy || !extractUrl.trim()}>
            {extractBusy ? 'Extracting…' : 'Extract'}
          </button>
        </div>
        {extractError && <p className="dash-page__error" style={{ marginTop: '0.5rem' }}>{extractError}</p>}

        {extractDraft && (
          <BrandDraftPreview
            draft={extractDraft.extracted}
            hasPatch={Object.keys(extractDraft.patch).length > 0}
            onApply={() => void applyExtract()}
            onDiscard={() => {
              setExtractDraft(null);
              setExtractError('');
            }}
          />
        )}
      </section>

      {/* ── Switch theme (vendored gallery, rehomed from DesignStep) ─── */}
      <SwitchThemePanel
        siteId={siteId}
        onApplied={async () => {
          await loadGuide();
          await loadFields(scope);
        }}
      />

      {/* ── Import DESIGN.md (Brand Studio handoff) ──────────────────── */}
      <ImportDesignMdPanel
        siteId={siteId}
        form={importForm}
        setForm={setImportForm}
        onApplied={async () => {
          await loadGuide();
          await loadFields(scope);
        }}
      />

      {/* ── Specimen gallery ─────────────────────────────────────────── */}
      <section className="panel settings-card settings-card--full">
        <h3>Elements</h3>
        <p className="dash-page__muted">Live specimens styled by this site&rsquo;s theme. Click one to scope your edits.</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
          }}
        >
          {SPECIMENS.map((s) => (
            <ElementSpecimen
              key={s.elementType}
              label={s.label}
              elementType={s.elementType}
              selected={scope === s.elementType}
              onSelect={selectScope}
            >
              {s.render()}
            </ElementSpecimen>
          ))}
        </div>
      </section>

      {/* ── AI chat (scoped) ─────────────────────────────────────────── */}
      <section className="panel settings-card settings-card--full">
        <h3>Ask AI</h3>
        <p className="dash-page__muted">
          {scope ? `Restyle "${scope}" site-wide` : 'Restyle the whole site theme'} in plain English — e.g.
          &ldquo;make the corners rounder&rdquo; or &ldquo;use a warmer accent color&rdquo;.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendChat();
            }}
            placeholder="Describe a change…"
            style={{ flex: '1 1 320px' }}
            disabled={chatBusy}
          />
          <button type="button" onClick={() => void sendChat()} disabled={chatBusy || !chatInput.trim()}>
            {chatBusy ? 'Thinking…' : 'Apply'}
          </button>
        </div>
        {chatReply && <p className="status-ok" style={{ marginTop: '0.5rem' }}>{chatReply}</p>}
      </section>

      {/* ── Structured token fields ──────────────────────────────────── */}
      <section className="panel settings-card settings-card--full">
        <h3>Tokens{scope ? ` · ${scope}` : ''}</h3>
        {SECTION_ORDER.filter((s) => grouped.has(s)).map((section) => (
          <div key={section} style={{ marginTop: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem' }}>{section}</h4>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '0.75rem',
              }}
            >
              {grouped.get(section)!.map((field) => (
                <label key={field.path} style={{ fontSize: '0.8rem' }}>
                  {fieldLabel(field.path)}
                  {renderFieldInput(
                    field,
                    drafts[field.path] ?? '',
                    (v) => setDrafts((d) => ({ ...d, [field.path]: v })),
                    (explicit) => commitField(field, explicit)
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}

        {/* Advanced: structured JSON — same validated write path as the fields above. */}
        <div style={{ marginTop: '1.25rem' }}>
          <button type="button" className="link-btn" onClick={toggleJson}>
            {showJson ? '▾' : '▸'} Advanced: edit as JSON{scope ? ` (${scope} slice)` : ' (whole theme)'}
          </button>
          {showJson && (
            <div style={{ marginTop: '0.5rem' }}>
              <textarea
                rows={12}
                value={jsonDraft}
                onChange={(e) => setJsonDraft(e.target.value)}
                spellCheck={false}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
              <button type="button" className="secondary" style={{ marginTop: '0.35rem' }} onClick={applyJson}>
                Apply JSON
              </button>
            </div>
          )}
        </div>

        {/* Advanced: site-wide custom CSS (Q2 — global, not per-instance). */}
        <div style={{ marginTop: '1rem' }}>
          <button type="button" className="link-btn" onClick={() => setShowCustomCss((v) => !v)}>
            {showCustomCss ? '▾' : '▸'} Advanced: site-wide Custom CSS
          </button>
          {showCustomCss && (
            <div style={{ marginTop: '0.5rem' }}>
              <p className="dash-page__muted" style={{ fontSize: '0.8rem', margin: '0 0 0.35rem' }}>
                Raw CSS appended to every page after the theme stylesheet. Selectors and @media are allowed;
                @import, scripts, and url(javascript:) are blocked.
              </p>
              <textarea
                rows={8}
                value={customCssDraft}
                onChange={(e) => setCustomCssDraft(e.target.value)}
                spellCheck={false}
                placeholder=".fp-card { border-top: 3px solid var(--fp-accent); }"
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
              <button type="button" className="secondary" style={{ marginTop: '0.35rem' }} onClick={saveCustomCss}>
                Save custom CSS
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── Voice & Tone (Chunk 6) ───────────────────────────────────── */}
      <VoiceToneSection siteId={siteId} />

      <BrandResearchSection siteId={siteId} />
    </div>
  );
}

function renderFieldInput(
  field: EditableField,
  value: string,
  onChange: (v: string) => void,
  onCommit: (explicit?: string) => void
): ReactElement {
  const common = {
    style: { width: '100%', marginTop: '0.25rem' },
  };
  if (field.kind.kind === 'enum') {
    return (
      <select
        {...common}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onCommit(e.target.value); // commit the freshly-selected value directly (draft state is async)
        }}
      >
        {(field.kind.values ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind.kind === 'color') {
    // Only show the native swatch for 6-digit hex — for rgba()/hsl()/var() it would misrender as
    // black and overwrite the real value if touched. The text input stays the source of truth.
    const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
    return (
      <span style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem' }}>
        {isHex && (
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => onCommit()}
            style={{ width: 36, height: 32, padding: 0, border: 'none', background: 'none' }}
          />
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit()}
          style={{ flex: 1 }}
        />
      </span>
    );
  }
  return (
    <input
      {...common}
      type={field.kind.kind === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit()}
    />
  );
}

/** Confidence 0–1 → short label. Low values still surface so the user knows a field is a rough guess. */
function confidenceLabel(c: number): string {
  if (c >= 0.75) return 'high';
  if (c >= 0.5) return 'medium';
  if (c > 0) return 'low';
  return '—';
}

/** Reviewable preview of an extracted brand draft: swatches, fonts, logo, provenance, and apply/discard. */
function BrandDraftPreview({
  draft,
  hasPatch,
  onApply,
  onDiscard,
}: {
  draft: ExtractedBrand;
  hasPatch: boolean;
  onApply: () => void;
  onDiscard: () => void;
}): ReactElement {
  const colorEntries = Object.entries(draft.colors).filter(([, v]) => v) as [string, string][];
  const fontEntries = Object.entries(draft.typography).filter(([, v]) => v) as [string, string][];
  // radii/shadows are part of the applied patch, so they must be shown here too — otherwise Apply
  // would change tokens the user never reviewed (the "nothing changes until Apply" contract).
  const shapeEntries = [
    draft.radii.md ? (['radius', draft.radii.md] as [string, string]) : null,
    draft.shadows.md ? (['shadow', draft.shadows.md] as [string, string]) : null,
  ].filter(Boolean) as [string, string][];
  const hasAnything = colorEntries.length > 0 || fontEntries.length > 0 || shapeEntries.length > 0 || !!draft.logoUrl;

  return (
    <div style={{ marginTop: '1rem', border: '1px solid var(--fp-border, #e5e5e5)', borderRadius: 8, padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <strong>Brand draft</strong>
        <span className="dash-page__muted" style={{ fontSize: '0.8rem' }}>
          via {draft.engine === 'firecrawl' ? 'Firecrawl' : 'page analysis'} · {draft.sourceUrl}
        </span>
      </div>

      {colorEntries.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div className="dash-page__muted" style={{ fontSize: '0.8rem' }}>
            Colors · confidence {confidenceLabel(draft.confidence.colors)}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
            {colorEntries.map(([role, value]) => (
              <span key={role} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem' }}>
                <span
                  style={{ width: 20, height: 20, borderRadius: 4, background: value, border: '1px solid rgba(0,0,0,0.15)', display: 'inline-block' }}
                  title={value}
                />
                {role}: {value}
              </span>
            ))}
          </div>
        </div>
      )}

      {fontEntries.length > 0 && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
          <span className="dash-page__muted">Fonts · confidence {confidenceLabel(draft.confidence.typography)}: </span>
          {fontEntries.map(([role, value]) => `${role} ${value}`).join(' · ')}
        </div>
      )}

      {shapeEntries.length > 0 && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
          <span className="dash-page__muted">Shape: </span>
          {shapeEntries.map(([role, value]) => `${role} ${value}`).join(' · ')}
        </div>
      )}

      {draft.logoUrl && (
        <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
          <span className="dash-page__muted">Logo:</span>
          <img
            src={draft.logoUrl}
            alt="Extracted logo"
            style={{ maxHeight: 32, maxWidth: 120 }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <span className="dash-page__muted" style={{ fontSize: '0.7rem' }}>(preview only — not applied to tokens)</span>
        </div>
      )}

      {!hasAnything && (
        <p className="dash-page__muted" style={{ marginTop: '0.75rem' }}>
          That page didn&rsquo;t reveal usable brand tokens. Try a more design-forward page, or configure a Firecrawl
          key in Admin → Integrations for higher-fidelity extraction.
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button type="button" onClick={onApply} disabled={!hasPatch}>
          Apply to theme
        </button>
        <button type="button" className="secondary" onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

/** The Import DESIGN.md panel's name fields and last success message (owned by the page). */
interface ImportDesignForm {
  name: string;
  aesthetic: string;
  done: string;
}

const EMPTY_IMPORT_FORM: ImportDesignForm = { name: '', aesthetic: '', done: '' };

/**
 * Import a raw DESIGN.md document (e.g. authored by the Brand Studio skill) as this
 * site's StyleGuide. Same activation semantics as applying a theme — replaces the
 * current guide, so it warns accordingly.
 */
function ImportDesignMdPanel({
  siteId,
  form,
  setForm,
  onApplied,
}: {
  siteId: string;
  form: ImportDesignForm;
  setForm: Dispatch<SetStateAction<ImportDesignForm>>;
  onApplied: () => Promise<void> | void;
}): ReactElement {
  const { name, aesthetic, done } = form;
  const [rawMd, setRawMd] = useState('');
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState('');

  async function runImport() {
    setBusy(true);
    setPanelError('');
    setForm((f) => ({ ...f, done: '' }));
    try {
      await api.importSiteDesign(siteId, rawMd, name.trim(), aesthetic.trim() || undefined);
      setForm((f) => ({ ...f, done: `Imported "${name.trim()}" as this site's theme` }));
      setRawMd('');
      await onApplied();
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-card settings-card--full">
      <h3>Import DESIGN.md</h3>
      <p className="dash-page__muted">
        Paste a DESIGN.md design contract — e.g. one authored by the Brand Studio skill — and it becomes
        this site&rsquo;s theme. Importing replaces the current design system.
      </p>
      <p className="dash-page__muted" style={{ fontSize: '0.85rem' }}>
        Without an AI key, the first six hex codes are used in order as primary, secondary, accent, background,
        surface and text — follow the DESIGN.md template&rsquo;s section order, or add an AI key in Admin →
        Integrations for best results.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Brand name"
          aria-label="Brand name for the imported design"
          style={{ flex: '1 1 200px' }}
          disabled={busy}
        />
        <input
          value={aesthetic}
          onChange={(e) => setForm((f) => ({ ...f, aesthetic: e.target.value }))}
          placeholder="One-line aesthetic (optional)"
          aria-label="Aesthetic description"
          style={{ flex: '2 1 280px' }}
          disabled={busy}
        />
      </div>
      <textarea
        value={rawMd}
        onChange={(e) => setRawMd(e.target.value)}
        placeholder="# Brand Design System&#10;&#10;## 1. Visual Theme & Atmosphere&#10;…"
        aria-label="DESIGN.md content"
        rows={8}
        style={{ width: '100%', marginTop: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}
        disabled={busy}
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void runImport()} disabled={busy || !rawMd.trim() || !name.trim()}>
          {busy ? 'Importing…' : 'Import as site theme'}
        </button>
        {done && <span className="status-ok">{done}</span>}
      </div>
      {panelError && <p className="dash-page__error" style={{ marginTop: '0.5rem' }}>{panelError}</p>}
    </section>
  );
}
