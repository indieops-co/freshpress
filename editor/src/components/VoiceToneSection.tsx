import { useCallback, useEffect, useState } from 'react';
import { api, type HumanizerSiteConfig, type WritingSkill } from '../api';
import WritingSkillEditor from './WritingSkillEditor';

interface Props {
  siteId: string;
}

/**
 * Voice & Tone (Chunk 6) — a section of the Site Theme page. Edits the site's brand-voice
 * writing skill (samples + never-say), stored alongside the email-reply skill on the humanizer
 * config, reusing the same WritingSkillEditor the Humanizer settings use.
 */
export default function VoiceToneSection({ siteId }: Props) {
  const [config, setConfig] = useState<HumanizerSiteConfig | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .getHumanizerConfig(siteId)
      .then((r) => setConfig(r.config))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load voice settings'));
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateBrandVoice(skill: WritingSkill) {
    if (!config) return;
    setConfig({ ...config, brandVoiceSkill: skill });
    setError('');
    setStatus('Saving…');
    try {
      const saved = await api.updateHumanizerConfig(siteId, { brandVoiceSkill: skill });
      setConfig(saved);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('');
      load(); // roll the optimistic edit back to the true persisted state
    }
  }

  return (
    <section className="panel settings-card settings-card--full" id="voice-tone">
      <h3>Voice &amp; Tone</h3>
      <p className="dash-page__muted">
        Teach the AI your brand&rsquo;s writing voice with real samples, and list phrases it should never use.
        These guide site copy generation and AI edits across this site.
      </p>
      {status && <p className="status-ok">{status}</p>}
      {error && <p className="dash-page__error">{error}</p>}

      {config ? (
        <div style={{ marginTop: '1rem' }}>
          <WritingSkillEditor
            skill={config.brandVoiceSkill}
            onChange={updateBrandVoice}
            sampleLabel="Brand voice writing samples"
            sampleHint="Paste 1–3 pieces of on-brand copy (about page, product blurb, tagline) that sound like you."
            samplePlaceholder="Paste a paragraph of your brand's writing…"
            neverLabel="Never say/do (brand voice)"
          />
        </div>
      ) : (
        <p className="dash-page__muted">Loading voice settings…</p>
      )}
    </section>
  );
}
