import { useCallback, useEffect, useState } from 'react';
import { api, type HumanizeResult, type HumanizerMode, type HumanizerSiteConfig } from '../api';

export interface HumanizePanelProps {
  siteId: string;
  contentHtml: string;
  contentType?: 'blog' | 'email' | 'social' | 'auto';
  /** When set, uses resource-specific humanize endpoint */
  humanizeTarget?:
    | { kind: 'generic' }
    | { kind: 'blog'; postId: string }
    | { kind: 'slot'; pageId: string; slotId: string }
    | { kind: 'campaign'; campaignId: string; stepId: string }
    | { kind: 'social'; draftId: string };
  onAccept: (html: string) => void;
  compact?: boolean;
}

export default function HumanizePanel({
  siteId,
  contentHtml,
  contentType = 'auto',
  humanizeTarget = { kind: 'generic' },
  onAccept,
  compact,
}: HumanizePanelProps) {
  const [config, setConfig] = useState<HumanizerSiteConfig | null>(null);
  const [mode, setMode] = useState<HumanizerMode>('simple');
  const [includeReview, setIncludeReview] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detectLoading, setDetectLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [aiProvider, setAiProvider] = useState('');
  const [result, setResult] = useState<HumanizeResult | null>(null);

  const loadConfig = useCallback(() => {
    api
      .getHumanizerConfig(siteId)
      .then((r) => {
        setConfig(r.config);
        setMode(r.config.mode);
      })
      .catch(() => {
        setMode('simple');
      });
  }, [siteId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function saveMode(next: HumanizerMode) {
    setMode(next);
    if (!config) return;
    try {
      const saved = await api.updateHumanizerConfig(siteId, { mode: next });
      setConfig(saved);
    } catch {
      // mode still applies for this session
    }
  }

  async function runHumanize() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const opts = { mode, includeReview, html: contentHtml, contentType };
      let res: HumanizeResult;
      switch (humanizeTarget.kind) {
        case 'blog':
          res = await api.humanizeBlogPost(siteId, humanizeTarget.postId, opts);
          break;
        case 'slot':
          res = await api.humanizePageSlot(
            siteId,
            humanizeTarget.pageId,
            humanizeTarget.slotId,
            opts
          );
          break;
        case 'campaign':
          res = await api.humanizeCampaignStep(
            siteId,
            humanizeTarget.campaignId,
            humanizeTarget.stepId,
            opts
          );
          break;
        case 'social':
          res = await api.humanizeSocialDraft(siteId, humanizeTarget.draftId, opts);
          break;
        default:
          res = await api.humanizeContent(siteId, opts);
      }
      setResult(res);
      if (res.review) setShowReview(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Humanize failed');
    } finally {
      setLoading(false);
    }
  }

  async function runDetect() {
    setDetectLoading(true);
    setError('');
    try {
      const res = await api.detectAiContent(siteId, contentHtml);
      setAiScore(res.score);
      setAiProvider(res.provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setDetectLoading(false);
    }
  }

  const humanizedHtml = result?.humanizedHtml ?? '';

  return (
    <div className={`humanize-panel${compact ? ' humanize-panel--compact' : ''}`}>
      <div className="humanize-panel__toolbar">
        <label className="humanize-panel__mode">
          Mode{' '}
          <select
            value={mode}
            onChange={(e) => void saveMode(e.target.value as HumanizerMode)}
            disabled={loading}
          >
            <option value="simple">Simple (fast)</option>
            <option value="skill">Skill (pattern-aware)</option>
          </select>
        </label>
        <label className="humanize-panel__review-opt">
          <input
            type="checkbox"
            checked={includeReview}
            onChange={(e) => setIncludeReview(e.target.checked)}
            disabled={loading || mode === 'simple'}
          />
          Include review
        </label>
        <button type="button" className="secondary" disabled={detectLoading || !contentHtml.trim()} onClick={() => void runDetect()}>
          {detectLoading ? 'Checking…' : aiScore != null ? `Check AI (${aiScore}%)` : 'Check AI'}
        </button>
        <button type="button" disabled={loading || !contentHtml.trim()} onClick={() => void runHumanize()}>
          {loading ? 'Humanizing…' : 'Humanize'}
        </button>
      </div>

      {aiProvider && aiScore != null && (
        <p className="dash-page__muted" style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
          Detection via {aiProvider}
        </p>
      )}

      {error && <p className="dash-page__error" style={{ marginTop: '0.5rem' }}>{error}</p>}

      <p className="humanize-panel__skill-link">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent('freshpress:navigate', {
                detail: { siteSection: 'settings', hash: 'humanizer' },
              })
            );
          }}
        >
          Edit Humanizer skill →
        </button>
      </p>

      {result?.review && (
        <div className="humanize-panel__review-wrap">
          <button
            type="button"
            className="secondary"
            style={{ marginTop: '0.75rem' }}
            onClick={() => setShowReview((v) => !v)}
          >
            {showReview ? 'Hide full review' : 'Show full review'}
          </button>
          {showReview && (
            <div className="panel humanize-panel__review" style={{ marginTop: '0.5rem' }}>
              <p><strong>Detected as:</strong> {result.review.contentType}</p>
              <p>{result.review.assessment}</p>
              <table className="humanize-panel__scores">
                <thead>
                  <tr>
                    <th>Dimension</th>
                    <th>Score</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.review.scores).map(([dim, s]) => (
                    <tr key={dim}>
                      <td>{dim}</td>
                      <td>{s.score}/10</td>
                      <td>{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.review.patternFlags.length > 0 && (
                <>
                  <h4>AI pattern flags</h4>
                  <ul>
                    {result.review.patternFlags.map((f, i) => (
                      <li key={i}>
                        <em>{f.quote}</em> — {f.suggestion}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {result.review.topChanges.length > 0 && (
                <>
                  <h4>Top changes</h4>
                  <ol>
                    {result.review.topChanges.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {humanizedHtml && (
        <div className="panel" style={{ marginTop: '0.75rem' }}>
          <h4>Humanized draft</h4>
          <div className="humanize-panel__preview" dangerouslySetInnerHTML={{ __html: humanizedHtml }} />
          <button type="button" style={{ marginTop: '0.5rem' }} onClick={() => onAccept(humanizedHtml)}>
            Accept humanized draft
          </button>
        </div>
      )}
    </div>
  );
}
