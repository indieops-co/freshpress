import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type MediaAsset } from '../api';

interface Props {
  siteId: string;
}

type Tab = 'library' | 'generate';

function sourceLabel(asset: MediaAsset): string {
  if (asset.wpPostId != null) return 'WordPress import';
  return 'Imported';
}

// ─── Image generation panel ───────────────────────────────────────────────────

interface GeneratedItem {
  id: string;
  type: 'image' | 'video';
  jobId: string;
  prompt: string;
  status: 'pending' | 'succeeded' | 'failed';
  url: string | null;
}

function GeneratePanel({ siteId }: { siteId: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);

  // image form
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageStyle, setImageStyle] = useState('');

  // video form
  const [videoDescription, setVideoDescription] = useState('');
  const [videoScript, setVideoScript] = useState('');
  const [videoDuration, setVideoDuration] = useState(10);
  const [videoSubtitles, setVideoSubtitles] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<GeneratedItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getMediaGenerateStatus(siteId)
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, [siteId]);

  // Poll pending jobs every 4 seconds
  useEffect(() => {
    if (jobs.every((j) => j.status !== 'pending')) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(() => {
      void Promise.all(
        jobs
          .filter((j) => j.status === 'pending')
          .map(async (j) => {
            try {
              const result =
                j.type === 'image'
                  ? await api.pollGenerateImage(siteId, j.jobId)
                  : await api.pollGenerateVideo(siteId, j.jobId);

              const url = j.type === 'image'
                ? (result as { imageUrl: string | null }).imageUrl
                : (result as { videoUrl: string | null }).videoUrl;

              const done = result.status === 'succeeded' || result.status === 'failed' || !!url;
              if (done) {
                setJobs((prev) =>
                  prev.map((x) =>
                    x.id === j.id
                      ? { ...x, status: url ? 'succeeded' : 'failed', url }
                      : x
                  )
                );
              }
            } catch {
              // keep polling
            }
          })
      );
    }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobs, siteId]);

  async function startImageGeneration(e: React.FormEvent) {
    e.preventDefault();
    if (!imagePrompt.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.startGenerateImage(siteId, {
        prompt: imagePrompt.trim(),
        style: imageStyle.trim() || undefined,
      });
      const item: GeneratedItem = {
        id: crypto.randomUUID(),
        type: 'image',
        jobId: res.jobId,
        prompt: res.groundedPrompt,
        status: 'pending',
        url: null,
      };
      setJobs((prev) => [item, ...prev]);
      setImagePrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start generation');
    } finally {
      setSubmitting(false);
    }
  }

  async function startVideoGeneration(e: React.FormEvent) {
    e.preventDefault();
    if (!videoDescription.trim() || !videoScript.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.startGenerateVideo(siteId, {
        description: videoDescription.trim(),
        script: videoScript.trim(),
        duration: videoDuration,
        subtitles: videoSubtitles,
      });
      const item: GeneratedItem = {
        id: crypto.randomUUID(),
        type: 'video',
        jobId: res.jobId,
        prompt: res.groundedDescription,
        status: 'pending',
        url: null,
      };
      setJobs((prev) => [item, ...prev]);
      setVideoDescription('');
      setVideoScript('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start video generation');
    } finally {
      setSubmitting(false);
    }
  }

  if (configured === null) return <p className="dash-page__muted">Checking configuration…</p>;

  if (!configured) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Agent Media not configured</h3>
        <p className="dash-page__muted">
          Add your Agent Media API key in <strong>Admin → Integrations</strong> to generate brand-grounded images and UGC videos.
        </p>
        <p className="hint" style={{ marginTop: '0.5rem' }}>
          Get an API key at{' '}
          <a href="https://agent-media.ai" target="_blank" rel="noreferrer">agent-media.ai</a>
          {' '}(plans from $39/mo, credits-based, BYOK).
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>

      {/* Image generation */}
      <div className="panel">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Generate image</h3>
        <p className="hint" style={{ marginBottom: '0.75rem' }}>
          Your site's brand style guide is automatically injected into every prompt.
        </p>
        <form onSubmit={(e) => void startImageGeneration(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label>
            <span className="field-label">Describe the image</span>
            <textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="e.g. A hero banner showing a confident professional at a laptop, natural daylight"
              rows={3}
              required
            />
          </label>
          <label>
            <span className="field-label">Style preset (optional)</span>
            <input
              value={imageStyle}
              onChange={(e) => setImageStyle(e.target.value)}
              placeholder="e.g. photorealistic, illustration, cinematic"
            />
          </label>
          <button type="submit" disabled={submitting || !imagePrompt.trim()}>
            {submitting ? 'Starting…' : 'Generate image'}
          </button>
        </form>
      </div>

      {/* Video generation */}
      <div className="panel">
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Generate UGC video</h3>
        <p className="hint" style={{ marginBottom: '0.75rem' }}>
          Creates a lip-synced vertical UGC video via Agent Media's pipeline.
        </p>
        <form onSubmit={(e) => void startVideoGeneration(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <label>
            <span className="field-label">Person / scene description</span>
            <input
              value={videoDescription}
              onChange={(e) => setVideoDescription(e.target.value)}
              placeholder="e.g. a friendly 30-year-old professional, soft daylight, home office"
              required
            />
          </label>
          <label>
            <span className="field-label">Script (spoken words)</span>
            <textarea
              value={videoScript}
              onChange={(e) => setVideoScript(e.target.value)}
              placeholder="What the person says. ~2–4 words per second of duration."
              rows={3}
              required
            />
          </label>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <label style={{ flex: 1 }}>
              <span className="field-label">Duration (seconds)</span>
              <select value={videoDuration} onChange={(e) => setVideoDuration(Number(e.target.value))}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '0.5rem', width: '100%' }}>
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={15}>15s</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '1.25rem' }}>
              <input type="checkbox" checked={videoSubtitles} onChange={(e) => setVideoSubtitles(e.target.checked)} />
              Subtitles
            </label>
          </div>
          <button type="submit" disabled={submitting || !videoDescription.trim() || !videoScript.trim()}>
            {submitting ? 'Starting…' : 'Generate video'}
          </button>
        </form>
      </div>

      {/* Jobs list */}
      {(error || jobs.length > 0) && (
        <div style={{ gridColumn: '1 / -1' }}>
          {error && <p className="dash-page__error">{error}</p>}

          {jobs.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Generated assets</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {jobs.map((job) => (
                  <div key={job.id} className="panel" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 0.25rem', fontWeight: 600, fontSize: '0.9rem' }}>
                        {job.type === 'image' ? 'Image' : 'UGC Video'}
                      </p>
                      <p className="hint" style={{ margin: 0, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.prompt}
                      </p>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      {job.status === 'pending' && (
                        <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Generating…</span>
                      )}
                      {job.status === 'failed' && (
                        <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Failed</span>
                      )}
                      {job.status === 'succeeded' && job.url && job.type === 'image' && (
                        <a href={job.url} target="_blank" rel="noreferrer">
                          <img src={job.url} alt="Generated" style={{ height: 80, borderRadius: 8, objectFit: 'cover' }} />
                        </a>
                      )}
                      {job.status === 'succeeded' && job.url && job.type === 'video' && (
                        <a href={job.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>
                          View video ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MediaPage({ siteId }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('library');
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [search, setSearch] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .listMedia(siteId)
      .then(setAssets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [siteId]);

  const mimeTypes = useMemo(() => {
    const set = new Set(assets.map((a) => a.mimeType).filter(Boolean) as string[]);
    return [...set].sort();
  }, [assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (mimeFilter && a.mimeType !== mimeFilter) return false;
      if (!q) return true;
      const haystack = [
        a.filename,
        a.publicPath,
        a.relativePath,
        a.sourceUrl,
        sourceLabel(a),
        a.mimeType,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [assets, search, mimeFilter]);

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">Media</h2>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <button
          type="button"
          className={activeTab === 'library' ? '' : 'secondary'}
          onClick={() => setActiveTab('library')}
        >
          Library
        </button>
        <button
          type="button"
          className={activeTab === 'generate' ? '' : 'secondary'}
          onClick={() => setActiveTab('generate')}
        >
          Generate
        </button>
      </div>

      {activeTab === 'generate' && <GeneratePanel siteId={siteId} />}

      {activeTab === 'library' && (
        <>
          <p className="dash-page__muted">
            Browse media imported for this site. Upload, optimization, alt text, dimensions, and safe image
            replacement are coming in Guarded Media Stage 2.
          </p>

          {loading && <p className="dash-page__muted">Loading media…</p>}
          {error && <div className="error-banner">{error}</div>}

          {!loading && !error && (
            <>
              <div className="media-toolbar panel">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search filename, path, URL, type…"
                  style={{ flex: '1 1 200px' }}
                />
                <select
                  value={mimeFilter}
                  onChange={(e) => setMimeFilter(e.target.value)}
                  style={{
                    flex: '0 0 160px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    padding: '0.5rem',
                  }}
                >
                  <option value="">All types</option>
                  {mimeTypes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className="dash-page__muted" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                  {filtered.length} of {assets.length}
                </span>
              </div>

              {assets.length === 0 ? (
                <div className="panel dash-placeholder" style={{ marginTop: '1rem' }}>
                  <p>No media yet. Media uploads and optimization are coming soon.</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="panel dash-placeholder" style={{ marginTop: '1rem' }}>
                  <p>No media matches your search.</p>
                </div>
              ) : (
                <div className="media-grid">
                  {filtered.map((asset) => (
                    <article key={asset.id} className="panel media-card">
                      <div className="media-card__preview">
                        {asset.mimeType?.startsWith('image/') ? (
                          <img src={asset.publicPath} alt="" loading="lazy" />
                        ) : (
                          <span className="media-card__file-icon">📄</span>
                        )}
                      </div>
                      <h3 className="media-card__title">{asset.filename}</h3>
                      <dl className="media-card__meta">
                        <dt>Source</dt>
                        <dd>{sourceLabel(asset)}</dd>
                        <dt>MIME type</dt>
                        <dd>{asset.mimeType ?? 'Unknown'}</dd>
                        <dt>File size</dt>
                        <dd>Unknown</dd>
                        <dt>Dimensions</dt>
                        <dd>Unknown</dd>
                        <dt>Alt text</dt>
                        <dd className="media-card__placeholder">Not tracked yet</dd>
                        <dt>Caption</dt>
                        <dd className="media-card__placeholder">Not tracked yet</dd>
                        <dt>Usage</dt>
                        <dd className="media-card__placeholder">Not tracked yet</dd>
                      </dl>
                      {asset.sourceUrl && (
                        <p className="media-card__url hint">
                          <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
                            Original URL
                          </a>
                        </p>
                      )}
                      <code className="media-card__path">{asset.publicPath}</code>
                    </article>
                  ))}
                </div>
              )}

              <div className="panel media-future" style={{ marginTop: '1.5rem' }}>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Coming in Stage 2</h3>
                <ul className="media-future__list">
                  <li>Upload images</li>
                  <li>Compress automatically</li>
                  <li>Generate WebP / AVIF</li>
                  <li>TinyPNG / Cloudinary / imgix integrations</li>
                  <li>Replace image slots safely</li>
                </ul>
                <p className="hint" style={{ margin: '0.75rem 0 0' }}>
                  See <code>docs/guarded-media-stage-2.md</code> for the planned pipeline.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
