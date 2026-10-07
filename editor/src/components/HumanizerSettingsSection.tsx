import { useCallback, useEffect, useState } from 'react';
import { api, type HumanizerSiteConfig, type WritingSkill } from '../api';
import WritingSkillEditor from './WritingSkillEditor';

interface Props {
  siteId: string;
}

const TONE_PRESETS = [
  'friendly-professional',
  'conversational',
  'authoritative',
  'technical',
  'warm',
];

const READING_PRESETS = [
  'High school',
  "Bachelor's degree in liberal arts",
  'Journalist',
  'Technical / expert audience',
];

export default function HumanizerSettingsSection({ siteId }: Props) {
  const [config, setConfig] = useState<HumanizerSiteConfig | null>(null);
  const [upstreamVersion, setUpstreamVersion] = useState('');
  const [upstreamSyncedAt, setUpstreamSyncedAt] = useState('');
  const [promptEstimate, setPromptEstimate] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    api
      .getHumanizerConfig(siteId)
      .then((r) => {
        setConfig(r.config);
        setUpstreamVersion(r.upstream?.version ?? '');
        setUpstreamSyncedAt(r.upstream?.syncedAt ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load humanizer settings'));
    api
      .getHumanizerPromptPreview(siteId)
      .then((r) => setPromptEstimate(r.estimatedTokens))
      .catch(() => setPromptEstimate(null));
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(partial: Partial<HumanizerSiteConfig>) {
    if (!config) return;
    setError('');
    setStatus('Saving…');
    try {
      const saved = await api.updateHumanizerConfig(siteId, partial);
      setConfig(saved);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
      void api.getHumanizerPromptPreview(siteId).then((r) => setPromptEstimate(r.estimatedTokens));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('');
    }
  }

  function updateEmailReplySkill(skill: WritingSkill) {
    if (!config) return;
    setConfig({ ...config, emailReplySkill: skill });
    void save({ emailReplySkill: skill });
  }

  async function syncUpstream() {
    setSyncing(true);
    setError('');
    try {
      const manifest = await api.syncHumanizerUpstream();
      setUpstreamVersion(manifest.version);
      setUpstreamSyncedAt(manifest.syncedAt);
      setStatus(`Synced upstream v${manifest.version}`);
      setTimeout(() => setStatus(''), 3000);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  if (!config) {
    return <p className="dash-page__muted">Loading humanizer settings…</p>;
  }

  return (
    <section className="panel settings-card settings-card--full" id="humanizer">
      <h3>Humanizer</h3>
      <p className="dash-page__muted">
        Skill-based AI pattern detection and rewriting. Upstream base:{' '}
        <a href="https://github.com/blader/humanizer" target="_blank" rel="noreferrer">
          blader/humanizer
        </a>
        {upstreamVersion && (
          <>
            {' '}
            · v{upstreamVersion}
            {upstreamSyncedAt && ` · synced ${new Date(upstreamSyncedAt).toLocaleDateString()}`}
          </>
        )}
      </p>
      {status && <p className="status-ok">{status}</p>}
      {error && <p className="dash-page__error">{error}</p>}

      <div className="settings-form-grid" style={{ marginTop: '1rem' }}>
        <label>
          Default mode
          <select
            value={config.mode}
            onChange={(e) => void save({ mode: e.target.value as HumanizerSiteConfig['mode'] })}
          >
            <option value="simple">Simple (fast)</option>
            <option value="skill">Skill (pattern-aware)</option>
          </select>
        </label>

        <label>
          Content type hint
          <select
            value={config.contentTypeHint ?? 'auto'}
            onChange={(e) =>
              void save({ contentTypeHint: e.target.value as HumanizerSiteConfig['contentTypeHint'] })
            }
          >
            <option value="auto">Auto-detect</option>
            <option value="blog">Blog</option>
            <option value="email">Email</option>
          </select>
        </label>

        <label>
          Tone
          <input
            list="tone-presets"
            value={config.tone}
            onChange={(e) => setConfig({ ...config, tone: e.target.value })}
            onBlur={() => void save({ tone: config.tone })}
          />
          <datalist id="tone-presets">
            {TONE_PRESETS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        <label>
          Reading level
          <input
            list="reading-presets"
            value={config.readingLevel}
            onChange={(e) => setConfig({ ...config, readingLevel: e.target.value })}
            onBlur={() => void save({ readingLevel: config.readingLevel })}
          />
          <datalist id="reading-presets">
            {READING_PRESETS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </label>
      </div>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        Voice sample (optional)
        <textarea
          rows={4}
          value={config.voiceSample ?? ''}
          onChange={(e) => setConfig({ ...config, voiceSample: e.target.value })}
          onBlur={() => void save({ voiceSample: config.voiceSample || undefined })}
          placeholder="Paste 1–3 paragraphs of your writing for voice matching…"
          style={{ width: '100%', marginTop: '0.35rem' }}
        />
      </label>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        Custom augment (site-specific skill rules)
        <textarea
          rows={8}
          value={config.customAugment ?? ''}
          onChange={(e) => setConfig({ ...config, customAugment: e.target.value })}
          onBlur={() => void save({ customAugment: config.customAugment || undefined })}
          placeholder="Additional rules appended to the humanizer skill for this site…"
          style={{ width: '100%', marginTop: '0.35rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
        />
      </label>

      <h4 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }} id="email-reply-skill">
        Email auto-draft
      </h4>
      <p className="dash-page__muted" style={{ margin: '0 0 0.5rem' }}>
        Opening a personal (non-promo) Inbox thread auto-generates a first-draft reply in this voice, editable before
        sending.
      </p>
      <label className="humanize-panel__review-opt">
        <input
          type="checkbox"
          checked={config.autoDraftEnabled ?? true}
          onChange={(e) => void save({ autoDraftEnabled: e.target.checked })}
        />
        AI auto-draft replies in Inbox
      </label>

      <div style={{ marginTop: '1rem' }}>
        <WritingSkillEditor
          skill={config.emailReplySkill}
          onChange={updateEmailReplySkill}
          sampleLabel="Email reply writing samples"
          sampleHint="Falls back to the voice sample above until at least one email-specific sample is added."
          samplePlaceholder="Paste a real email reply you've sent, to teach the AI your voice…"
          neverLabel="Never say/do (email replies)"
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="secondary" disabled={syncing} onClick={() => void syncUpstream()}>
          {syncing ? 'Syncing…' : 'Sync upstream skill'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void save({ customAugment: undefined })}
        >
          Reset custom augment
        </button>
        {promptEstimate != null && (
          <span className="dash-page__muted">Skill prompt ≈ {promptEstimate.toLocaleString()} tokens</span>
        )}
      </div>
    </section>
  );
}
