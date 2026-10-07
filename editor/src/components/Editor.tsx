import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  getToken,
  type Site,
  type ContentSlot,
  type SlotChange,
  type SiteVersion,
} from '../api';
import SeoPromptsPanel from './SeoPromptsPanel';
import HumanizePanel from './HumanizePanel';
import NamedElementsSidebar from './NamedElementsSidebar';
import { attachPreviewBridge, type PreviewBridge } from './PreviewBridge';
import { useAuth } from '../context/AuthContext';

interface Props {
  siteId: string;
  onBack: () => void;
  onLogout: () => void;
  /** When true, shell provides top bar; editor fills remaining viewport */
  embedded?: boolean;
}

export default function Editor({ siteId, onBack, onLogout, embedded }: Props) {
  const auth = useAuth();
  const [site, setSite] = useState<Site | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [activeElementId, setActiveElementId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editHref, setEditHref] = useState('');
  const [editAlt, setEditAlt] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showSeo, setShowSeo] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewBridgeRef = useRef<PreviewBridge | null>(null);
  const skipNextScrollRef = useRef(false);

  const activePage = site?.pages.find((p) => p.id === activePageId) ?? null;
  const activeSlot = activePage?.content.slots[activeSlotId ?? ''] ?? null;

  const loadSite = useCallback(async () => {
    try {
      const data = await api.getSite(siteId);
      setSite(data);
      if (!activePageId && data.pages.length > 0) {
        setActivePageId(data.pages[0].id);
      }
      const vers = await api.listVersions(siteId);
      setVersions(vers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load site');
    }
  }, [siteId, activePageId]);

  useEffect(() => {
    loadSite();
  }, [loadSite]);

  useEffect(() => {
    if (!activePage) return;
    fetch(`/api/sites/${siteId}/pages/${activePage.id}/preview`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.text())
      .then(setPreviewHtml)
      .catch(() => setError('Preview load failed'));
  }, [activePage, siteId]);

  useEffect(() => {
    if (activeSlot) {
      setEditValue(activeSlot.value);
      setEditHref(activeSlot.href ?? '');
      setEditAlt(activeSlot.alt ?? '');
    }
  }, [activeSlot]);

  // Re-highlight whenever the active element changes, whether the click that caused it came
  // from the sidebar (needs to scroll into view) or from inside the preview iframe itself
  // (already visible — scrolling would just jump the page under the cursor that clicked it).
  useEffect(() => {
    previewBridgeRef.current?.highlight(activeElementId, { scroll: !skipNextScrollRef.current });
    skipNextScrollRef.current = false;
  }, [activeElementId]);

  useEffect(() => {
    return () => previewBridgeRef.current?.destroy();
  }, []);

  function selectElementFromPreview(elementId: string) {
    skipNextScrollRef.current = true;
    setActiveElementId(elementId);
  }

  function handlePreviewLoad() {
    previewBridgeRef.current?.destroy();
    if (!iframeRef.current) return;
    previewBridgeRef.current = attachPreviewBridge(iframeRef.current, selectElementFromPreview);
    previewBridgeRef.current?.highlight(activeElementId);
  }

  function selectSlot(slot: ContentSlot) {
    setActiveSlotId(slot.id);
  }

  async function saveSlot() {
    if (!activePage || !activeSlotId) return;
    setError('');
    setStatus('Saving…');

    const changes: SlotChange[] = [{ slotId: activeSlotId, value: editValue }];
    if (activeSlot?.type === 'link') changes[0].href = editHref;
    if (activeSlot?.type === 'image') changes[0].alt = editAlt;

    try {
      const { page, html } = await api.updatePage(siteId, activePage.id, changes);
      setSite((s) =>
        s ? { ...s, pages: s.pages.map((p) => (p.id === page.id ? page : p)) } : s
      );
      setPreviewHtml(html);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('');
    }
  }

  async function snapshotVersion() {
    try {
      const v = await api.createVersion(siteId, `Edit ${new Date().toLocaleString()}`);
      setVersions((vs) => [v, ...vs]);
      setStatus('Snapshot saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Snapshot failed');
    }
  }

  async function publishSite() {
    try {
      setStatus('Publishing…');
      const result = await api.publish(siteId, `Publish ${new Date().toLocaleString()}`);
      const url = result.deploymentUrl ?? result.publish.deploymentUrl;
      setStatus(url ? `Published → ${url}` : 'Published locally');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
      setStatus('');
    }
  }

  async function submitForReview() {
    setError('');
    try {
      setStatus('Submitting for review…');
      await api.submitReview(siteId);
      await loadSite();
      setStatus('Submitted — an approver has been notified');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit for review failed');
      setStatus('');
    }
  }

  async function approveReview() {
    setError('');
    try {
      setStatus('Approving & publishing…');
      const result = await api.approveReview(siteId, `Approved ${new Date().toLocaleString()}`);
      const url = result.deploymentUrl ?? result.publish.deploymentUrl;
      await loadSite();
      setStatus(url ? `Published → ${url}` : 'Published');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
      setStatus('');
    }
  }

  async function rejectReview() {
    const note = window.prompt('Optional note about what needs changing (sent to the editor):');
    if (note === null) return; // cancelled
    setError('');
    try {
      setStatus('Sending back…');
      await api.rejectReview(siteId, note.trim() || undefined);
      await loadSite();
      setStatus('Review sent back');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reject failed');
      setStatus('');
    }
  }

  async function rollback(versionId: string) {
    if (!confirm('Restore this version? Current unsaved edits will be replaced.')) return;
    try {
      const restored = await api.restoreVersion(siteId, versionId);
      setSite(restored);
      setStatus('Version restored');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    }
  }

  async function downloadWordPress() {
    if (!site?.meta.name) return;
    setError('');
    setStatus('Building theme…');
    try {
      await api.downloadWordPressTheme(siteId, site.meta.name);
      setStatus('WordPress theme downloaded');
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WordPress export failed');
      setStatus('');
    }
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!activePage || !chatInput.trim()) return;
    setError('');
    setStatus('Thinking…');
    try {
      const result = await api.chat(siteId, activePage.id, chatInput.trim(), activeElementId ?? undefined);
      setSite((s) =>
        s ? { ...s, pages: s.pages.map((p) => (p.id === result.page.id ? result.page : p)) } : s
      );
      setPreviewHtml(result.html);
      setChatInput('');
      setStatus(result.warnings?.length ? `${result.explanation} (${result.warnings.join('; ')})` : result.explanation);
      setTimeout(() => setStatus(''), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed');
      setStatus('');
    }
  }

  const isClient = auth.role === 'client';
  // Save-only members and clients don't get owner tools (WordPress export, SEO prompts hit
  // owner-only routes).
  const showOwnerTools = !isClient && auth.user?.role !== 'member';
  // Clients read their publish right from the site payload; workspace users from /auth/me
  // (undefined ⇒ full rights, e.g. owner/master-key/legacy sessions).
  const canPublish = isClient ? site?.capabilities?.canPublish === true : auth.canPublish !== false;
  const pendingReview = site?.meta.review ?? null;

  const editorActions = (
    <>
      {status && <span className="status-ok">{status}</span>}
      <button className="secondary" onClick={snapshotVersion}>
        Snapshot
      </button>
      {pendingReview && canPublish ? (
        <>
          <button onClick={approveReview}>Approve &amp; publish</button>
          <button className="secondary" onClick={rejectReview}>
            Reject
          </button>
        </>
      ) : canPublish ? (
        <button onClick={publishSite}>Publish</button>
      ) : (
        <button onClick={submitForReview} disabled={!!pendingReview}>
          {pendingReview ? 'Awaiting review' : 'Submit for review'}
        </button>
      )}
      {showOwnerTools && (
        <>
          <button className="secondary" onClick={downloadWordPress}>
            WordPress
          </button>
          <button className="secondary" onClick={() => setShowSeo(true)}>
            SEO prompts
          </button>
        </>
      )}
    </>
  );

  const reviewBanner = pendingReview ? (
    <div
      className="review-banner"
      style={{
        margin: embedded ? '0 0 0.75rem' : '0.75rem 1rem 0',
        padding: '0.6rem 0.9rem',
        borderRadius: '8px',
        background: 'rgba(108, 140, 255, 0.12)',
        border: '1px solid rgba(108, 140, 255, 0.4)',
        color: 'var(--text, #e8eaef)',
        fontSize: '0.9rem',
      }}
    >
      {canPublish
        ? `Changes were submitted for review by ${pendingReview.submittedBy}. Approve to publish, or send back for edits.`
        : 'Your changes are awaiting review. An approver will publish them once approved.'}
      {pendingReview.note ? ` — “${pendingReview.note}”` : ''}
    </div>
  ) : null;

  return (
    <div className={`app-shell${embedded ? ' app-shell--embedded' : ''}`}>
      {embedded ? (
        <div className="editor-embedded-toolbar">
          <div className="spacer" />
          {editorActions}
        </div>
      ) : (
        <header className="topbar">
          <button className="secondary" onClick={onBack}>
            ← Back
          </button>
          <h1>{site?.meta.name ?? 'Editor'}</h1>
          <div className="spacer" />
          {editorActions}
          <button className="secondary" onClick={onLogout}>
            Sign out
          </button>
        </header>
      )}

      {error && (
        <div className="error-banner" style={{ margin: embedded ? '0' : '0.75rem 1rem 0' }}>
          {error}
        </div>
      )}

      {reviewBanner}

      <div className="editor-layout">
        <aside className="sidebar">
          <div>
            <h2>Pages</h2>
            <div className="page-tabs" style={{ marginTop: '0.5rem' }}>
              {site?.pages.map((page) => (
                <button
                  key={page.id}
                  className={`page-tab ${page.id === activePageId ? 'active' : ''}`}
                  onClick={() => {
                    setActivePageId(page.id);
                    setActiveSlotId(null);
                    setActiveElementId(null);
                  }}
                >
                  {page.title}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2>Content slots</h2>
            <ul className="slot-list">
              {activePage?.content.slotOrder.map((id) => {
                const slot = activePage.content.slots[id];
                return (
                  <li
                    key={id}
                    className={`slot-item ${id === activeSlotId ? 'active' : ''}`}
                    onClick={() => selectSlot(slot)}
                  >
                    <div className="tag">
                      {slot.type} · {slot.tag}
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {slot.value.slice(0, 60)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {activePage?.content.containers && activePage.content.namedElements && (
            <div>
              <h2>Named elements</h2>
              <NamedElementsSidebar
                containers={activePage.content.containers}
                namedElements={activePage.content.namedElements}
                activeElementId={activeElementId}
                onSelectElement={setActiveElementId}
              />
            </div>
          )}

          {versions.length > 0 && (
            <div>
              <h2>Versions</h2>
              <ul className="slot-list">
                {versions.slice(0, 5).map((v) => (
                  <li key={v.id} className="slot-item" onClick={() => rollback(v.id)}>
                    <div>{v.label}</div>
                    <div className="tag">{new Date(v.createdAt).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form className="chat-box" onSubmit={sendChat}>
            <h2>AI chat</h2>
            {activeElementId && (
              <div className="chat-scope-pill">
                Scoped to: {activeElementId}
                <button type="button" onClick={() => setActiveElementId(null)} aria-label="Clear scope">
                  ×
                </button>
              </div>
            )}
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Describe a change in plain English…"
            />
            <button type="submit" style={{ marginTop: '0.5rem', width: '100%' }} disabled={!chatInput.trim()}>
              Apply with Guardian
            </button>
            <div className="hint">
              {activeElementId
                ? 'AI edits stay confined to the scoped element — clear the scope above to restyle the whole page.'
                : 'AI proposes content-only changes — Guardian validates before saving.'}
            </div>
          </form>
        </aside>

        <main className="preview-pane">
          <div className="preview-toolbar">
            Live preview · click a named element or slot in the sidebar to edit
            {activePage && <span> · {activePage.path}</span>}
          </div>
          <iframe
            ref={iframeRef}
            className="preview-frame"
            srcDoc={previewHtml}
            title="Preview"
            sandbox="allow-same-origin"
            onLoad={handlePreviewLoad}
          />

          {activeSlot && (
            <div className="edit-panel">
              <h3>
                Edit {activeSlot.type} ({activeSlot.tag})
              </h3>
              <div className="form-group">
                <label>Value</label>
                <textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  rows={3}
                />
              </div>
              {activeSlot.type === 'link' && (
                <div className="form-group">
                  <label>Link URL</label>
                  <input value={editHref} onChange={(e) => setEditHref(e.target.value)} />
                </div>
              )}
              {activeSlot.type === 'image' && (
                <div className="form-group">
                  <label>Alt text</label>
                  <input value={editAlt} onChange={(e) => setEditAlt(e.target.value)} />
                </div>
              )}
              <div className="edit-actions">
                <button onClick={saveSlot}>Save change</button>
                <button className="secondary" onClick={() => setActiveSlotId(null)}>
                  Cancel
                </button>
              </div>
              {activePage && activeSlotId && (
                <HumanizePanel
                  siteId={siteId}
                  contentHtml={
                    editValue.includes('<') ? editValue : `<p>${editValue}</p>`
                  }
                  contentType="blog"
                  humanizeTarget={{
                    kind: 'slot',
                    pageId: activePage.id,
                    slotId: activeSlotId,
                  }}
                  compact
                  onAccept={(html) => {
                    const plain = html.replace(/<[^>]+>/g, '').trim() || html;
                    setEditValue(activeSlot?.type === 'text' ? plain : html);
                  }}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {showSeo && (
        <div className="seo-modal-backdrop" onClick={() => setShowSeo(false)}>
          <div className="seo-modal" onClick={(e) => e.stopPropagation()}>
            <SeoPromptsPanel
              siteId={siteId}
              pageId={activePageId ?? undefined}
              onClose={() => setShowSeo(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
