import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type SocialGenerationBatch,
  type SocialPlatform,
  type SocialPostDraft,
} from '../api';
import { useAuth } from '../context/AuthContext';
import TagPillInput from '../components/TagPillInput';
import SocialCopyPanel from '../components/SocialCopyPanel';
import HumanizePanel from '../components/HumanizePanel';

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

const PLATFORM_LIMITS: Record<SocialPlatform, { maxChars: number; maxTags: number }> = {
  linkedin: { maxChars: 3000, maxTags: 5 },
  x: { maxChars: 280, maxTags: 2 },
  instagram: { maxChars: 2200, maxTags: 30 },
  facebook: { maxChars: 63206, maxTags: 10 },
};

interface Props {
  siteId: string;
}

type Tab = 'review' | 'drafts' | 'published';

export default function SocialPage({ siteId }: Props) {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [tab, setTab] = useState<Tab>(isAdmin ? 'review' : 'drafts');
  const [drafts, setDrafts] = useState<SocialPostDraft[]>([]);
  const [batches, setBatches] = useState<SocialGenerationBatch[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [draftDetail, setDraftDetail] = useState<{
    draft: SocialPostDraft;
    blogUrl?: string;
  } | null>(null);
  const [batchDetail, setBatchDetail] = useState<SocialGenerationBatch | null>(null);
  const [selections, setSelections] = useState<
    Record<string, { selected: boolean; hero: boolean; light: boolean; dark: boolean }>
  >({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterPostId, setFilterPostId] = useState('');
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaAssets, setMediaAssets] = useState<Array<{ id: string; publicPath: string; filename: string }>>([]);

  // AI image generation for social drafts
  const [aiImageJobId, setAiImageJobId] = useState<string | null>(null);
  const [aiImageGenerating, setAiImageGenerating] = useState(false);
  const [aiImageUrl, setAiImageUrl] = useState<string | null>(null);
  const [aiImageError, setAiImageError] = useState('');
  const [mediaConfigured, setMediaConfigured] = useState<boolean | null>(null);
  const aiPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    const statusFilter = tab === 'published' ? 'published' : tab === 'drafts' ? 'draft' : undefined;
    api
      .listSocialDrafts(siteId, { status: statusFilter, sourcePostId: filterPostId || undefined })
      .then(setDrafts)
      .catch(() => setDrafts([]));
    if (isAdmin) {
      api
        .listSocialBatches(siteId, { status: 'pending_review', sourcePostId: filterPostId || undefined })
        .then(setBatches)
        .catch(() => setBatches([]));
    }
  }, [siteId, tab, filterPostId, isAdmin]);

  useEffect(() => {
    api.getMediaGenerateStatus(siteId)
      .then((r) => setMediaConfigured(r.configured))
      .catch(() => setMediaConfigured(false));
  }, [siteId]);

  // Clear AI image state when selected draft changes
  useEffect(() => {
    setAiImageUrl(null);
    setAiImageJobId(null);
    setAiImageError('');
    setAiImageGenerating(false);
    if (aiPollRef.current) clearInterval(aiPollRef.current);
  }, [selectedDraftId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll AI image job
  useEffect(() => {
    if (!aiImageJobId) return;
    aiPollRef.current = setInterval(() => {
      void api.pollGenerateImage(siteId, aiImageJobId).then((result) => {
        if (result.imageUrl) {
          setAiImageUrl(result.imageUrl);
          setAiImageJobId(null);
          setAiImageGenerating(false);
          if (aiPollRef.current) clearInterval(aiPollRef.current);
        } else if (result.status === 'failed') {
          setAiImageError('Generation failed. Try again.');
          setAiImageJobId(null);
          setAiImageGenerating(false);
          if (aiPollRef.current) clearInterval(aiPollRef.current);
        }
      }).catch(() => {/* keep polling */});
    }, 4000);
    return () => { if (aiPollRef.current) clearInterval(aiPollRef.current); };
  }, [aiImageJobId, siteId]);

  async function generateAiImage(draft: SocialPostDraft) {
    setAiImageGenerating(true);
    setAiImageError('');
    setAiImageUrl(null);
    try {
      const prompt = `Social media image for: ${draft.bodyText.slice(0, 200)}`;
      const res = await api.startGenerateImage(siteId, { prompt });
      setAiImageJobId(res.jobId);
    } catch (err) {
      setAiImageError(err instanceof Error ? err.message : 'Failed to start generation');
      setAiImageGenerating(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedDraftId) {
      setDraftDetail(null);
      return;
    }
    api
      .getSocialDraft(siteId, selectedDraftId)
      .then(setDraftDetail)
      .catch((e) => setError(e.message));
  }, [siteId, selectedDraftId]);

  useEffect(() => {
    if (!selectedBatchId || !isAdmin) {
      setBatchDetail(null);
      return;
    }
    api
      .getSocialBatch(siteId, selectedBatchId)
      .then((b) => {
        setBatchDetail(b);
        const sel: typeof selections = {};
        for (const v of b.variants) {
          sel[v.id] = {
            selected: false,
            hero: !!v.images.hero,
            light: !!v.images.textCardLight,
            dark: !!v.images.textCardDark,
          };
        }
        setSelections(sel);
      })
      .catch((e) => setError(e.message));
  }, [siteId, selectedBatchId, isAdmin]);

  async function acceptBatch() {
    if (!batchDetail) return;
    const selectionsList = Object.entries(selections)
      .filter(([, s]) => s.selected)
      .map(([variantId, s]) => ({
        variantId,
        includeHero: s.hero,
        includeTextCardLight: s.light,
        includeTextCardDark: s.dark,
      }));
    if (!selectionsList.length) {
      setError('Select at least one variant');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.acceptSocialBatch(siteId, batchDetail.id, selectionsList);
      setSelectedBatchId(null);
      setTab('drafts');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed');
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft(patch: Partial<SocialPostDraft>) {
    if (!draftDetail) return;
    const updated = await api.updateSocialDraft(siteId, draftDetail.draft.id, patch);
    setDraftDetail({ ...draftDetail, draft: updated });
    refresh();
  }

  async function markPublished() {
    if (!draftDetail) return;
    setLoading(true);
    try {
      const updated = await api.markSocialDraftPublished(siteId, draftDetail.draft.id);
      setDraftDetail({ ...draftDetail, draft: updated });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function openMediaPicker() {
    const assets = await api.listMedia(siteId);
    setMediaAssets(assets);
    setShowMediaPicker(true);
  }

  const draft = draftDetail?.draft;
  const limits = draft ? PLATFORM_LIMITS[draft.platform] : null;

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">Social</h2>
      <p className="dash-page__muted">
        {isAdmin
          ? 'Generate platform drafts from blog posts, review variants, edit, and copy to paste externally.'
          : 'Edit your social drafts, copy fields, and mark as posted when live.'}
      </p>
      {error && <p className="dash-page__error">{error}</p>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {isAdmin && (
          <button type="button" className={tab === 'review' ? '' : 'secondary'} onClick={() => setTab('review')}>
            Pending review
          </button>
        )}
        <button type="button" className={tab === 'drafts' ? '' : 'secondary'} onClick={() => setTab('drafts')}>
          Drafts
        </button>
        <button
          type="button"
          className={tab === 'published' ? '' : 'secondary'}
          onClick={() => setTab('published')}
        >
          Posted
        </button>
        <input
          value={filterPostId}
          onChange={(e) => setFilterPostId(e.target.value)}
          placeholder="Filter by blog post ID"
          style={{ marginLeft: 'auto', maxWidth: '200px' }}
        />
      </div>

      <div className="blog-page__layout">
        <aside>
          {tab === 'review' && isAdmin && (
            <>
              <h3 style={{ fontSize: '1rem' }}>Pending batches</h3>
              <ul className="blog-silo__posts">
                {batches.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="blog-silo__post-btn"
                      onClick={() => setSelectedBatchId(b.id)}
                    >
                      Run #{b.generationRun}
                      <span>{b.sourceSection}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {batches.length === 0 && <p className="dash-page__muted">No pending batches.</p>}
            </>
          )}

          {(tab === 'drafts' || tab === 'published') && (
            <>
              <h3 style={{ fontSize: '1rem' }}>{tab === 'drafts' ? 'Drafts' : 'Posted'}</h3>
              <ul className="blog-silo__posts">
                {drafts.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="blog-silo__post-btn"
                      onClick={() => {
                        setSelectedDraftId(d.id);
                        setSelectedBatchId(null);
                      }}
                    >
                      {PLATFORM_LABELS[d.platform]} — run #{d.generationRun}
                      <span>{d.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {drafts.length === 0 && <p className="dash-page__muted">No drafts yet.</p>}
            </>
          )}
        </aside>

        <main>
          {tab === 'review' && batchDetail && isAdmin && (
            <div className="panel">
              <h3>
                Review batch — run #{batchDetail.generationRun}
              </h3>
              <p className="dash-page__muted">
                Section: {batchDetail.sourceSection} · Keywords: {batchDetail.targetKeywords.join(', ')}
              </p>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {batchDetail.variants.map((v) => (
                  <div key={v.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        checked={selections[v.id]?.selected ?? false}
                        onChange={(e) =>
                          setSelections((s) => ({
                            ...s,
                            [v.id]: { ...s[v.id], selected: e.target.checked },
                          }))
                        }
                      />
                      {PLATFORM_LABELS[v.platform]} — variant {v.variantIndex}
                    </label>
                    <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{v.bodyText}</p>
                    <p className="dash-page__muted" style={{ fontSize: '0.85rem' }}>
                      Tags: {v.suggestedTags.join(', ')}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      {v.images.hero && (
                        <label>
                          <input
                            type="checkbox"
                            checked={selections[v.id]?.hero ?? false}
                            onChange={(e) =>
                              setSelections((s) => ({ ...s, [v.id]: { ...s[v.id], hero: e.target.checked } }))
                            }
                          />{' '}
                          Hero
                        </label>
                      )}
                      {v.images.textCardLight && (
                        <label>
                          <input
                            type="checkbox"
                            checked={selections[v.id]?.light ?? false}
                            onChange={(e) =>
                              setSelections((s) => ({ ...s, [v.id]: { ...s[v.id], light: e.target.checked } }))
                            }
                          />{' '}
                          Light card
                        </label>
                      )}
                      {v.images.textCardDark && (
                        <label>
                          <input
                            type="checkbox"
                            checked={selections[v.id]?.dark ?? false}
                            onChange={(e) =>
                              setSelections((s) => ({ ...s, [v.id]: { ...s[v.id], dark: e.target.checked } }))
                            }
                          />{' '}
                          Dark card
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" style={{ marginTop: '1rem' }} disabled={loading} onClick={() => void acceptBatch()}>
                Save to drafts
              </button>
            </div>
          )}

          {draft && (tab === 'drafts' || tab === 'published') && (
            <div className="panel">
              <h3>
                {PLATFORM_LABELS[draft.platform]} draft
                {draft.status === 'published' && (
                  <span className="dash-page__muted" style={{ fontWeight: 400, marginLeft: '0.5rem' }}>
                    — posted {draft.publishedAt ? new Date(draft.publishedAt).toLocaleString() : ''}
                  </span>
                )}
              </h3>
              <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                Caption
                {limits && (
                  <span className="dash-page__muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                    {draft.bodyText.length}/{limits.maxChars}
                  </span>
                )}
                <textarea
                  rows={6}
                  value={draft.bodyText}
                  onChange={(e) =>
                    setDraftDetail({ ...draftDetail!, draft: { ...draft, bodyText: e.target.value } })
                  }
                  onBlur={() => void saveDraft({ bodyText: draft.bodyText })}
                  style={{ width: '100%', marginTop: '0.25rem' }}
                />
              </label>

              <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                Tags
                <TagPillInput
                  tags={draft.tags}
                  maxTags={limits?.maxTags}
                  onChange={(tags) => {
                    setDraftDetail({ ...draftDetail!, draft: { ...draft, tags } });
                    void saveDraft({ tags });
                  }}
                />
              </label>

              {isAdmin && (
                <HumanizePanel
                  siteId={siteId}
                  contentHtml={draft.bodyText}
                  contentType="social"
                  humanizeTarget={{ kind: 'social', draftId: draft.id }}
                  onAccept={(html) => {
                    const text = html.replace(/<[^>]+>/g, ' ').trim();
                    setDraftDetail({ ...draftDetail!, draft: { ...draft, bodyText: text } });
                    void saveDraft({ bodyText: text });
                  }}
                />
              )}

              <SocialCopyPanel
                bodyText={draft.bodyText}
                tags={draft.tags}
                blogUrl={draftDetail.blogUrl}
                images={draft.images}
              />

              {isAdmin && (
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button type="button" className="secondary" onClick={() => void openMediaPicker()}>
                      Replace hero image
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void api.regenerateSocialCards(siteId, draft.id).then((updated) => {
                          setDraftDetail({ ...draftDetail!, draft: updated });
                        })
                      }
                    >
                      Regenerate text cards
                    </button>
                    {mediaConfigured && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={aiImageGenerating}
                        onClick={() => void generateAiImage(draft)}
                      >
                        {aiImageGenerating ? 'Generating AI image…' : 'Generate AI image'}
                      </button>
                    )}
                  </div>

                  {/* AI image variants */}
                  {(aiImageGenerating || aiImageUrl || aiImageError) && (
                    <div className="panel" style={{ padding: '0.75rem' }}>
                      <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>AI-generated variant</p>
                      {aiImageError && (
                        <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{aiImageError}</p>
                      )}
                      {aiImageGenerating && !aiImageUrl && (
                        <p className="hint" style={{ margin: 0 }}>Generating brand-grounded image (~15–30s)…</p>
                      )}
                      {aiImageUrl && (
                        <div>
                          <img
                            src={aiImageUrl}
                            alt="AI generated social image"
                            style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                          />
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="secondary"
                              style={{ fontSize: '0.8rem' }}
                              onClick={() => {
                                void saveDraft({ images: { ...draft.images, hero: aiImageUrl } }).then(() => {
                                  setDraftDetail({ ...draftDetail!, draft: { ...draft, images: { ...draft.images, hero: aiImageUrl } } });
                                });
                              }}
                            >
                              Use as hero image
                            </button>
                            <a
                              href={aiImageUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}
                            >
                              Open full size ↗
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {draft.status === 'draft' && (
                <button type="button" style={{ marginTop: '1rem' }} disabled={loading} onClick={() => void markPublished()}>
                  Mark as posted
                </button>
              )}
            </div>
          )}

          {!draft && !batchDetail && (
            <p className="dash-page__muted">Select a {tab === 'review' ? 'batch' : 'draft'} from the list.</p>
          )}
        </main>
      </div>

      {showMediaPicker && draft && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowMediaPicker(false)}
        >
          <div className="panel" style={{ maxWidth: 480, maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3>Pick hero image</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {mediaAssets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="secondary"
                  style={{ padding: 0, overflow: 'hidden' }}
                  onClick={() => {
                    void saveDraft({ images: { ...draft.images, hero: a.publicPath } }).then(() =>
                      setShowMediaPicker(false)
                    );
                  }}
                >
                  <img src={a.publicPath} alt={a.filename} style={{ width: '100%', height: 80, objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
