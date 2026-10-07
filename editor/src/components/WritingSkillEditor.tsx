import { useState } from 'react';
import type { WritingSample, WritingSkill } from '../api';
import TagPillInput from './TagPillInput';

interface Props {
  skill?: WritingSkill;
  onChange: (skill: WritingSkill) => void;
  disabled?: boolean;
  /** Label above the writing-samples list. */
  sampleLabel?: string;
  samplePlaceholder?: string;
  /** Helper line under the samples label. */
  sampleHint?: string;
  neverLabel?: string;
}

const EMPTY: WritingSkill = { samples: [], neverPhrases: [] };

/**
 * Shared editor for an evolvable "writing skill" — a growing list of writing samples plus a set of
 * "never say/do" phrases (Chunk 6). Extracted from HumanizerSettingsSection so the Humanizer email
 * settings and the Site Theme page's Voice & Tone section render the exact same control.
 */
export default function WritingSkillEditor({
  skill,
  onChange,
  disabled,
  sampleLabel = 'Writing samples',
  samplePlaceholder = "Paste a real piece of your writing to teach the AI your voice…",
  sampleHint,
  neverLabel = 'Never say/do',
}: Props) {
  const [newSampleText, setNewSampleText] = useState('');
  const current = skill ?? EMPTY;

  function addSample() {
    const text = newSampleText.trim();
    if (!text) return;
    const sample: WritingSample = {
      id: crypto.randomUUID(),
      text,
      addedAt: new Date().toISOString(),
    };
    onChange({ ...current, samples: [...current.samples, sample] });
    setNewSampleText('');
  }

  function removeSample(id: string) {
    onChange({ ...current, samples: current.samples.filter((s) => s.id !== id) });
  }

  function setNeverPhrases(neverPhrases: string[]) {
    onChange({ ...current, neverPhrases });
  }

  return (
    <div className="writing-skill-editor">
      <div>
        <span className="field-label">{sampleLabel}</span>
        {sampleHint && (
          <p className="dash-page__muted" style={{ margin: '0.15rem 0 0.5rem', fontSize: '0.85rem' }}>
            {sampleHint}
          </p>
        )}
        {current.samples.map((sample) => (
          <div key={sample.id} className="panel" style={{ marginBottom: '0.5rem', padding: '0.6rem' }}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>{sample.text}</p>
            {!disabled && (
              <button
                type="button"
                className="link-btn"
                style={{ marginTop: '0.35rem' }}
                onClick={() => removeSample(sample.id)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <>
            <textarea
              rows={3}
              value={newSampleText}
              onChange={(e) => setNewSampleText(e.target.value)}
              placeholder={samplePlaceholder}
              style={{ width: '100%' }}
            />
            <button type="button" className="secondary" style={{ marginTop: '0.35rem' }} onClick={addSample}>
              Add sample
            </button>
          </>
        )}
      </div>

      <label style={{ display: 'block', marginTop: '1rem' }}>
        {neverLabel}
        <div style={{ marginTop: '0.35rem' }}>
          <TagPillInput tags={current.neverPhrases} onChange={setNeverPhrases} disabled={disabled} />
        </div>
      </label>
    </div>
  );
}
