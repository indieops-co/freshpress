import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BlogPost, type BlogSilo } from '../api';
import { useDashboard } from '../context/DashboardContext';
import TipTapEditor from '../components/blog/TipTapEditor';
import HumanizePanel from '../components/HumanizePanel';

interface Props {
  siteId: string;
}

export default function BlogPage({ siteId }: Props) {
  const { setActiveSiteSection } = useDashboard();
  const [silos, setSilos] = useState<BlogSilo[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [post, setPost] = useState<BlogPost | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newPillarKeyword, setNewPillarKeyword] = useState('');
  const [newPillarTitle, setNewPillarTitle] = useState('');
  const [seoRecipes, setSeoRecipes] = useState<Array<{ id: string; number: number; title: string }>>([]);
  const [seoContent, setSeoContent] = useState('');
  const [seoCopied, setSeoCopied] = useState(false);
  const [rssUrl, setRssUrl] = useState('');
  const [rssLabel, setRssLabel] = useState('');
  const [rssFeeds, setRssFeeds] = useState<Array<{ id: string; url: string; label: string }>>([]);
  const [socialGenerating, setSocialGenerating] = useState(false);
  const [includeFullScreenCards, setIncludeFullScreenCards] = useState(true);
  const [socialDraftCount, setSocialDraftCount] = useState(0);

  // Hero image generation
  const [heroImagePrompt, setHeroImagePrompt] = useState('');
  const [heroGenerating, setHeroGenerating] = useState(false);
  const [heroJobId, setHeroJobId] = useState<string | null>(null);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const [heroError, setHeroError] = useState('');
  const [mediaConfigured, setMediaConfigured] = useState<boolean | null>(null);
  const heroPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    api.listBlogSilos(siteId).then(setSilos).catch((e) => setError(e.message));
  }, [siteId]);

  useEffect(() => {
    api.getMediaGenerateStatus(siteId)
      .then((r) => setMediaConfigured(r.configured))
      .catch(() => setMediaConfigured(false));
  }, [siteId]);

  // Reset hero state when post changes
  useEffect(() => {
    setHeroImageUrl(null);
    setHeroJobId(null);
    setHeroError('');
    if (heroPollRef.current) clearInterval(heroPollRef.current);
  }, [selectedPostId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll hero image job
  useEffect(() => {
    if (!heroJobId) return;
    heroPollRef.current = setInterval(() => {
      void api.pollGenerateImage(siteId, heroJobId).then((result) => {
        if (result.imageUrl) {
          setHeroImageUrl(result.imageUrl);
          setHeroJobId(null);
          setHeroGenerating(false);
          if (heroPollRef.current) clearInterval(heroPollRef.current);
        } else if (result.status === 'failed') {
          setHeroError('Image generation failed. Try again.');
          setHeroJobId(null);
          setHeroGenerating(false);
          if (heroPollRef.current) clearInterval(heroPollRef.current);
        }
      }).catch(() => {/* keep polling */});
    }, 4000);
    return () => { if (heroPollRef.current) clearInterval(heroPollRef.current); };
  }, [heroJobId, siteId]);

  async function generateHeroImage() {
    if (!post) return;
    const prompt = heroImagePrompt.trim() ||
      `Hero banner image for a blog post titled "${post.title}". Professional, editorial photography style.`;
    setHeroGenerating(true);
    setHeroError('');
    setHeroImageUrl(null);
    try {
      const res = await api.startGenerateImage(siteId, { prompt });
      setHeroJobId(res.jobId);
    } catch (err) {
      setHeroError(err instanceof Error ? err.message : 'Failed to start generation');
      setHeroGenerating(false);
    }
  }

  useEffect(() => {
    refresh();
    api.listRssFeeds(siteId).then(setRssFeeds).catch(() => setRssFeeds([]));
  }, [refresh, siteId]);

  useEffect(() => {
    if (!selectedPostId) {
      setPost(null);
      return;
    }
    api.getBlogPost(siteId, selectedPostId).then(setPost).catch((e) => setError(e.message));
    api
      .listBlogSeoRecipes(siteId, selectedPostId)
      .then((r) => setSeoRecipes(r.recipes))
      .catch(() => setSeoRecipes([]));
    setSeoContent('');
  }, [siteId, selectedPostId]);

  useEffect(() => {
    if (!selectedPostId) {
      setSocialDraftCount(0);
      return;
    }
    api
      .listSocialDrafts(siteId, { sourcePostId: selectedPostId })
      .then((d) => setSocialDraftCount(d.length))
      .catch(() => setSocialDraftCount(0));
  }, [siteId, selectedPostId, post?.status]);

  async function createPillar(e: React.FormEvent) {
    e.preventDefault();
    if (!newPillarTitle.trim() || !newPillarKeyword.trim()) return;
    const slug = newPillarKeyword.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      const res = await api.createBlogPillar(siteId, {
        keyword: newPillarKeyword.trim(),
        slug,
        title: newPillarTitle.trim(),
      });
      setNewPillarKeyword('');
      setNewPillarTitle('');
      refresh();
      setSelectedPostId(res.pillarPost.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function addSupportive(pillarId: string) {
    const title = window.prompt('Supportive post title');
    if (!title?.trim()) return;
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    try {
      const created = await api.createSupportivePost(siteId, pillarId, { title: title.trim(), slug });
      refresh();
      setSelectedPostId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function savePost() {
    if (!post) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateBlogPost(siteId, post.id, {
        title: post.title,
        bodyHtml: post.bodyHtml,
        status: post.status,
        metaTitle: post.metaTitle,
        metaDescription: post.metaDescription,
      });
      setPost(updated);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-page blog-page">
      <h2 className="dash-page__title">Blog</h2>
      <p className="dash-page__muted">Keyword silos — pillar posts and supportive cluster articles.</p>
      {error && <p className="dash-page__error">{error}</p>}

      <div className="blog-page__layout">
        <aside className="blog-page__silos">
          <form
            className="blog-page__new-pillar"
            onSubmit={(e) => {
              e.preventDefault();
              if (!rssUrl.trim() || !rssLabel.trim()) return;
              void api.addRssFeed(siteId, rssUrl.trim(), rssLabel.trim()).then((f) => {
                setRssFeeds((prev) => [...prev, f]);
                setRssUrl('');
                setRssLabel('');
              });
            }}
          >
            <input value={rssLabel} onChange={(e) => setRssLabel(e.target.value)} placeholder="Feed label" />
            <input value={rssUrl} onChange={(e) => setRssUrl(e.target.value)} placeholder="RSS URL" />
            <button type="submit" className="secondary">
              + RSS feed
            </button>
          </form>
          {rssFeeds.length > 0 && (
            <ul className="blog-silo__posts" style={{ marginBottom: '1rem' }}>
              {rssFeeds.map((f) => (
                <li key={f.id} className="dash-page__muted" style={{ fontSize: '0.85rem' }}>
                  {f.label}
                </li>
              ))}
            </ul>
          )}
          <form className="blog-page__new-pillar" onSubmit={createPillar}>
            <input
              value={newPillarTitle}
              onChange={(e) => setNewPillarTitle(e.target.value)}
              placeholder="Pillar title"
            />
            <input
              value={newPillarKeyword}
              onChange={(e) => setNewPillarKeyword(e.target.value)}
              placeholder="Main keyword"
            />
            <button type="submit">+ Pillar</button>
          </form>

          {silos.map(({ pillar, posts }) => (
            <div key={pillar.id} className="blog-silo">
              <div className="blog-silo__header">
                <strong>{pillar.title}</strong>
                <span className="dash-page__muted">{pillar.keyword}</span>
              </div>
              <ul className="blog-silo__posts">
                {posts.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`blog-silo__post-btn${selectedPostId === p.id ? ' blog-silo__post-btn--active' : ''}`}
                      onClick={() => setSelectedPostId(p.id)}
                    >
                      {p.kind === 'pillar' ? '★ ' : '· '}
                      {p.title}
                      <span>{p.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="secondary" onClick={() => void addSupportive(pillar.id)}>
                + Supportive
              </button>
            </div>
          ))}
        </aside>

        <main className="blog-page__editor">
          {!post && <p className="dash-page__muted">Select a post to edit.</p>}
          {post && (
            <>
              <input
                value={post.title}
                onChange={(e) => setPost({ ...post, title: e.target.value })}
                style={{ marginBottom: '0.75rem', fontSize: '1.25rem', fontWeight: 600 }}
              />
              <TipTapEditor content={post.bodyHtml} onChange={(html) => setPost({ ...post, bodyHtml: html })} />
              {/* Hero image generation */}
              {mediaConfigured && (
                <div className="panel" style={{ marginTop: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Hero image</h3>
                  <p className="hint" style={{ marginBottom: '0.75rem' }}>
                    AI generates a brand-grounded image based on your post title. Your site's design system is applied automatically.
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <input
                      value={heroImagePrompt}
                      onChange={(e) => setHeroImagePrompt(e.target.value)}
                      placeholder={`Hero image for "${post.title}" — or leave blank to auto-generate`}
                      style={{ flex: '1 1 280px' }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={heroGenerating}
                      onClick={() => void generateHeroImage()}
                    >
                      {heroGenerating ? 'Generating…' : 'Generate hero image'}
                    </button>
                  </div>
                  {heroError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>{heroError}</p>}
                  {heroGenerating && !heroImageUrl && (
                    <p className="hint" style={{ margin: '0.25rem 0 0' }}>Generating image (takes ~15–30s)…</p>
                  )}
                  {heroImageUrl && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <img
                        src={heroImageUrl}
                        alt="Generated hero"
                        style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                      />
                      <p className="hint" style={{ marginTop: '0.35rem' }}>
                        <a href={heroImageUrl} target="_blank" rel="noreferrer">Open full size ↗</a>
                        {' · '}Copy URL to insert into post
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="blog-seo-lab panel" style={{ marginTop: '1.25rem' }}>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>SEO Lab</h3>
                <p className="dash-page__muted" style={{ marginBottom: '0.75rem' }}>
                  Copy agent-ready recipes (On-Page.ai BYOK in Admin). Meta title/description auto-fill on save.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  {seoRecipes.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="secondary"
                      onClick={() =>
                        void api.getBlogSeoRecipe(siteId, post.id, r.id).then((res) => setSeoContent(res.content))
                      }
                    >
                      #{r.number} {r.title.slice(0, 28)}
                      {r.title.length > 28 ? '…' : ''}
                    </button>
                  ))}
                </div>
                {seoContent && (
                  <>
                    <textarea readOnly value={seoContent} rows={8} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }} />
                    <button
                      type="button"
                      className="secondary"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => {
                        void navigator.clipboard.writeText(seoContent);
                        setSeoCopied(true);
                        setTimeout(() => setSeoCopied(false), 2000);
                      }}
                    >
                      {seoCopied ? 'Copied!' : 'Copy for agent'}
                    </button>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <select
                  value={post.status}
                  onChange={(e) =>
                    setPost({
                      ...post,
                      status: e.target.value as BlogPost['status'],
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="scheduled">Scheduled</option>
                </select>
                <button type="button" onClick={() => void savePost()} disabled={saving}>
                  {saving ? 'Saving…' : 'Save post'}
                </button>
              </div>
              {post.status === 'published' && (
                <div className="panel" style={{ marginTop: '1rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Social drafts</h3>
                  {post.socialGenerationMeta && (
                    <p className="dash-page__muted" style={{ fontSize: '0.85rem' }}>
                      Last run #{post.socialGenerationMeta.runCount} · sections used:{' '}
                      {post.socialGenerationMeta.usedSections.join(', ') || 'none'}
                    </p>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <input
                      type="checkbox"
                      checked={includeFullScreenCards}
                      onChange={(e) => setIncludeFullScreenCards(e.target.checked)}
                    />
                    Include full-screen text cards this run
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="secondary"
                      disabled={socialGenerating}
                      onClick={() => {
                        setSocialGenerating(true);
                        void api
                          .generateSocialDrafts(siteId, post.id, { includeFullScreenCards })
                          .then(() => {
                            setActiveSiteSection('social');
                          })
                          .catch((err) => setError(err.message))
                          .finally(() => setSocialGenerating(false));
                      }}
                    >
                      {socialGenerating ? 'Generating…' : 'Generate social drafts'}
                    </button>
                    {socialDraftCount > 0 && (
                      <button type="button" className="secondary" onClick={() => setActiveSiteSection('social')}>
                        View social drafts for this post →
                      </button>
                    )}
                  </div>
                </div>
              )}
              <HumanizePanel
                siteId={siteId}
                contentHtml={post.bodyHtml}
                contentType="blog"
                humanizeTarget={{ kind: 'blog', postId: post.id }}
                onAccept={(html) => setPost({ ...post, bodyHtml: html })}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
