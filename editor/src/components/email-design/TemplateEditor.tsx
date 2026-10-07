import { useEffect, useMemo, useState } from 'react';
import { api, type EmailBlock, type EmailBlockKind, type EmailTemplate, type EmailFormat, type SiteMeta } from '../../api';
import TemplatePreview from './TemplatePreview';

interface Props {
  siteId: string;
}

const BLOCK_KIND_LABELS: Record<EmailBlockKind, string> = {
  'header-logo': 'Header / logo',
  heading: 'Heading',
  body: 'Body (composed content)',
  'cta-button': 'CTA button',
  divider: 'Divider',
  'signature-slot': 'Signature',
  footer: 'Footer',
};

const ADDABLE_KINDS: EmailBlockKind[] = ['header-logo', 'heading', 'cta-button', 'divider', 'signature-slot', 'footer'];

let blockIdCounter = 0;
function newBlockId() {
  blockIdCounter += 1;
  return `block_${Date.now()}_${blockIdCounter}`;
}

export default function TemplateEditor({ siteId }: Props) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [formats, setFormats] = useState<EmailFormat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EmailTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [addKind, setAddKind] = useState<EmailBlockKind>('cta-button');

  const [showImport, setShowImport] = useState(false);
  const [sites, setSites] = useState<SiteMeta[]>([]);
  const [importSourceSiteId, setImportSourceSiteId] = useState('');
  const [importSourceTemplates, setImportSourceTemplates] = useState<EmailTemplate[]>([]);
  const [importSourceId, setImportSourceId] = useState('');

  const selected = useMemo(() => templates.find((t) => t.id === selectedId) ?? null, [templates, selectedId]);
  const defaultFormatId = formats.find((f) => f.isDefault)?.id ?? formats[0]?.id ?? null;

  async function refresh(selectId?: string) {
    const [tRes, fRes] = await Promise.all([api.listEmailTemplates(siteId), api.listEmailFormats(siteId)]);
    setTemplates(tRes.templates);
    setFormats(fRes.formats);
    if (selectId) setSelectedId(selectId);
    else if (!tRes.templates.find((t) => t.id === selectedId)) {
      setSelectedId(tRes.templates[0]?.id ?? null);
    }
  }

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [siteId]);

  useEffect(() => {
    setDraft(selected ? structuredClone(selected) : null);
  }, [selected]);

  async function handleNew() {
    setError('');
    try {
      const { template } = await api.createEmailTemplate(siteId);
      await refresh(template.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    }
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const { template } = await api.updateEmailTemplate(siteId, draft.id, draft);
      await refresh(template.id);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setError('');
    try {
      await api.deleteEmailTemplate(siteId, id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function handleSetDefault(id: string) {
    setError('');
    try {
      await api.setDefaultEmailTemplate(siteId, id);
      await refresh(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set default');
    }
  }

  async function openImport() {
    setShowImport(true);
    if (sites.length === 0) {
      const list = await api.listSites();
      setSites(list.filter((s) => s.id !== siteId));
    }
  }

  async function handlePickImportSite(sourceSiteId: string) {
    setImportSourceSiteId(sourceSiteId);
    setImportSourceId('');
    if (!sourceSiteId) {
      setImportSourceTemplates([]);
      return;
    }
    const res = await api.listEmailTemplates(sourceSiteId);
    setImportSourceTemplates(res.templates);
  }

  async function handleImport() {
    if (!importSourceSiteId || !importSourceId) return;
    setError('');
    try {
      const { template } = await api.importEmailTemplateFromSite(siteId, importSourceSiteId, importSourceId);
      setShowImport(false);
      await refresh(template.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    }
  }

  function updateBlocks(blocks: EmailBlock[]) {
    setDraft((d) => (d ? { ...d, blocks } : d));
  }

  function moveBlock(index: number, dir: -1 | 1) {
    if (!draft) return;
    const blocks = [...draft.blocks];
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    updateBlocks(blocks);
  }

  function removeBlock(index: number) {
    if (!draft) return;
    if (draft.blocks[index].required) return;
    updateBlocks(draft.blocks.filter((_, i) => i !== index));
  }

  function addBlock() {
    if (!draft) return;
    const block: EmailBlock = {
      id: newBlockId(),
      kind: addKind,
      required: false,
      config: addKind === 'cta-button' ? { label: 'Learn more', href: '' } : {},
    };
    updateBlocks([...draft.blocks, block]);
  }

  function updateBlockConfig(index: number, key: string, value: string) {
    if (!draft) return;
    const blocks = [...draft.blocks];
    blocks[index] = { ...blocks[index], config: { ...blocks[index].config, [key]: value } };
    updateBlocks(blocks);
  }

  if (loading) return <p className="dash-page__muted">Loading templates…</p>;

  return (
    <div className="design-step__layout">
      <div className="design-step__themes">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Templates</h3>
        <ul className="design-theme-list">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={`design-theme-list__item${t.id === selectedId ? ' design-theme-list__item--active' : ''}`}
                onClick={() => setSelectedId(t.id)}
              >
                <strong>
                  {t.name}
                  {t.isDefault ? ' ★' : ''}
                </strong>
                <span>{t.blocks.length} blocks</span>
              </button>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button type="button" onClick={() => void handleNew()}>
            + New Template
          </button>
          <button type="button" className="secondary" onClick={() => void openImport()}>
            Import from another site
          </button>
        </div>

        {showImport && (
          <div className="panel" style={{ marginTop: '0.75rem', padding: '0.75rem' }}>
            <label>
              <span className="field-label">Source site</span>
              <select value={importSourceSiteId} onChange={(e) => void handlePickImportSite(e.target.value)}>
                <option value="">Select a site…</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {importSourceTemplates.length > 0 && (
              <label>
                <span className="field-label">Template</span>
                <select value={importSourceId} onChange={(e) => setImportSourceId(e.target.value)}>
                  <option value="">Select a template…</option>
                  {importSourceTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button type="button" disabled={!importSourceId} onClick={() => void handleImport()}>
                Import
              </button>
              <button type="button" className="secondary" onClick={() => setShowImport(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="design-step__preview">
        {error && <p className="dash-page__error">{error}</p>}
        {status && <p className="status-ok">{status}</p>}
        {!draft ? (
          <p className="dash-page__muted">Select or create a Template to edit.</p>
        ) : (
          <>
            <label>
              <span className="field-label">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>

            <ul className="dash-list" style={{ marginTop: '0.75rem' }}>
              {draft.blocks.map((block, i) => (
                <li key={block.id} className="dash-list__item" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>{BLOCK_KIND_LABELS[block.kind]}</strong>
                    {block.kind === 'cta-button' && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                        <input
                          placeholder="Button label"
                          value={(block.config.label as string) ?? ''}
                          onChange={(e) => updateBlockConfig(i, 'label', e.target.value)}
                        />
                        <input
                          placeholder="Button URL"
                          value={(block.config.href as string) ?? ''}
                          onChange={(e) => updateBlockConfig(i, 'href', e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button type="button" className="secondary btn--sm" onClick={() => moveBlock(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="secondary btn--sm" onClick={() => moveBlock(i, 1)}>
                      ↓
                    </button>
                    {!block.required && (
                      <button type="button" className="secondary btn--sm" onClick={() => removeBlock(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <select value={addKind} onChange={(e) => setAddKind(e.target.value as EmailBlockKind)}>
                {ADDABLE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {BLOCK_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary" onClick={addBlock}>
                + Add block
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              <button type="button" disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="secondary" onClick={() => void handleSetDefault(draft.id)}>
                Set as default
              </button>
              <button type="button" className="danger" onClick={() => void handleDelete(draft.id)}>
                Delete
              </button>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>Preview</h4>
              <TemplatePreview siteId={siteId} template={draft} formatId={defaultFormatId} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
