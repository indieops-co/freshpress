import { useState } from 'react';
import { api, type ExtractedBrand, type GeneratedDirection } from '../../api';
import { useAuth } from '../../context/AuthContext';
import PillToggleGroup, { PERSONALITY_OPTIONS, MOOD_OPTIONS, toggleChip } from '../design/PillToggleGroup';
import { TextField, TextAreaField } from '../brand-research/fields';
import WizardStep from './WizardStep';

/**
 * Chunk 9 + Amendment D — the stepped create-site wizard. Mounted full-pane by
 * DashboardShell right after "+ Add Site" creates the (empty) site. Sequential
 * persist (decision #2): Generate runs /design/generate (saves the StyleGuide),
 * then /generate (returns directions), and applying the chosen direction
 * persists its page via /pages/apply-generated. Exiting mid-way leaves a bare
 * or themed-but-empty site — a valid, recoverable intermediate.
 */

interface Props {
  siteId: string;
  siteName: string;
  /** Cancel at any point — the site stays in whatever state it reached. */
  onExit: () => void;
  /** A direction was applied; the site has a themed home page now. */
  onApplied: () => void;
}

// Mirrors the section-pattern library's industries (section-patterns-manifest.json)
// so a chip click lands on a scaffold match; free text still works for anything else.
const INDUSTRY_SUGGESTIONS = [
  'Service business',
  'SaaS / software',
  'E-commerce / online store',
  'Portfolio / personal',
  'Restaurant / local',
  'Professional services',
];

const AUDIENCE_SUGGESTIONS = [
  'homeowners',
  'small business owners',
  'developers',
  'creatives',
  'local customers',
  'online shoppers',
  'professionals',
];

const STEP_COUNT = 6;

type Phase =
  | { kind: 'intake' }
  | { kind: 'generating'; stage: 'theme' | 'directions' }
  | { kind: 'pick'; directions: GeneratedDirection[]; critiqueSkipped?: string }
  | { kind: 'applying'; directions: GeneratedDirection[]; index: number; critiqueSkipped?: string };

export default function CreateSiteFlow({ siteId, siteName, onExit, onApplied }: Props) {
  const auth = useAuth();
  // Feature-flag era default matches BrandResearchSection: entitled unless told otherwise.
  const powerpack = auth.features?.designPowerpack ?? true;
  const emailSystem = auth.features?.emailSystem ?? true;

  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'intake' });
  const [error, setError] = useState('');

  // Step 1 — name & what you do
  const [brandName, setBrandName] = useState(siteName);
  const [description, setDescription] = useState('');
  const [industry, setIndustry] = useState('');
  // Step 2 — who it's for
  const [audienceChips, setAudienceChips] = useState<string[]>([]);
  const [audienceText, setAudienceText] = useState('');
  // Step 3 — personality (last required step)
  const [personality, setPersonality] = useState<string[]>([]);
  // Step 4 — mood & colors
  const [moodKeywords, setMoodKeywords] = useState<string[]>([]);
  const [colorPreferences, setColorPreferences] = useState('');
  // Step 5 — references & assets
  const [referenceUrls, setReferenceUrls] = useState('');
  const [existingBrandNotes, setExistingBrandNotes] = useState('');
  const [extractUrl, setExtractUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractDraft, setExtractDraft] = useState<ExtractedBrand | null>(null);
  const [extracted, setExtracted] = useState<ExtractedBrand | null>(null);
  // Step 6 — how many directions
  const [count, setCount] = useState(1);
  const [critiqueOptIn, setCritiqueOptIn] = useState(false);
  const [signupOptIn, setSignupOptIn] = useState(false);
  // Fingerprint of the intake the persisted StyleGuide was generated from —
  // lets a retry (or regenerate with unchanged inputs) skip the theme AI call
  // instead of silently replacing a good saved guide.
  const [themeIntakeKey, setThemeIntakeKey] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<GeneratedDirection | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);

  const targetAudience =
    [...audienceChips, audienceText.trim()].filter(Boolean).join(', ') || undefined;

  function designIntake() {
    const urls = referenceUrls
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    const notes = [
      description.trim() && `What we do: ${description.trim()}`,
      existingBrandNotes.trim(),
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      brandName: brandName.trim(),
      industry: industry.trim() || undefined,
      personality,
      targetAudience,
      colorPreferences: colorPreferences.trim() || undefined,
      moodKeywords: moodKeywords.length > 0 ? moodKeywords : undefined,
      referenceUrls: urls.length > 0 ? urls : undefined,
      existingBrandNotes: notes || undefined,
    };
  }

  async function extractBrand() {
    if (!extractUrl.trim() || extracting) return;
    setExtracting(true);
    setError('');
    try {
      const res = await api.extractBrand(siteId, extractUrl.trim());
      setExtractDraft(res.extracted);
      setLogoBroken(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Brand extraction failed');
    } finally {
      setExtracting(false);
    }
  }

  async function generate() {
    setError('');
    const intake = designIntake();
    const intakeKey = JSON.stringify([intake, extracted]);
    try {
      // Skip the theme call when a guide from this exact intake is already
      // persisted (e.g. retrying after the directions call failed).
      if (themeIntakeKey !== intakeKey) {
        setPhase({ kind: 'generating', stage: 'theme' });
        await api.generateDesignSystem(siteId, intake, extracted ?? undefined);
        setThemeIntakeKey(intakeKey);
      }
      setPhase({ kind: 'generating', stage: 'directions' });
      const res = await api.generateSiteDirections(siteId, {
        brandName: brandName.trim(),
        industry: industry.trim() || undefined,
        personality,
        targetAudience,
        moodKeywords,
        count,
        ...(critiqueOptIn ? { critique: true } : {}),
        ...(emailSystem && signupOptIn ? { includeSignup: true } : {}),
      });
      setPhase({ kind: 'pick', directions: res.directions, critiqueSkipped: res.critiqueSkipped });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
      setPhase({ kind: 'intake' }); // back on step 6 — inputs intact, retry cheap
    }
  }

  async function apply(directions: GeneratedDirection[], index: number, critiqueSkipped?: string) {
    const direction = directions[index];
    setError('');
    setPhase({ kind: 'applying', directions, index, critiqueSkipped });
    try {
      await api.applyGeneratedPages(siteId, [direction.page]);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
      setPhase({ kind: 'pick', directions, critiqueSkipped });
    }
  }

  const header = (
    <div className="create-wizard__header">
      <h1 className="create-wizard__brand">Set up {brandName.trim() || siteName}</h1>
      <button type="button" className="secondary" onClick={onExit}>
        ✕ Exit setup
      </button>
    </div>
  );

  // ── Generation progress ────────────────────────────────────────────────────
  if (phase.kind === 'generating') {
    return (
      <div className="create-wizard">
        {header}
        <div className="create-wizard__gen">
          <p className="create-wizard__gen-title">Building your site…</p>
          <ul className="create-wizard__gen-steps">
            <li className={phase.stage === 'theme' ? 'active' : 'done'}>
              {phase.stage === 'theme' ? '⏳' : '✓'} Generating your design system
            </li>
            <li className={phase.stage === 'directions' ? 'active' : ''}>
              {phase.stage === 'directions' ? '⏳' : '·'} Writing {count} home page{count > 1 ? ' directions' : ''}
            </li>
          </ul>
          <p className="dash-page__muted">
            Roughly 20–40 seconds per direction — hang tight.
          </p>
        </div>
      </div>
    );
  }

  // ── Direction picker ───────────────────────────────────────────────────────
  if (phase.kind === 'pick' || phase.kind === 'applying') {
    const { directions } = phase;
    const applyingIndex = phase.kind === 'applying' ? phase.index : null;
    return (
      <div className="create-wizard create-wizard--wide">
        {header}
        <h2 className="dash-page__title">Pick a direction</h2>
        <p className="dash-page__muted">
          {directions.length > 1
            ? 'Each direction has a different page structure, not just different words.'
            : 'Your generated home page — apply it, or go back and regenerate.'}
        </p>
        {error && <p className="dash-page__error">{error}</p>}
        {phase.critiqueSkipped === 'not_entitled' && (
          <p className="dash-page__muted">AI critique is a Design Powerpack feature — upgrade to score directions.</p>
        )}

        <div className="create-wizard__cards">
          {directions.map((d, i) => (
            <div key={d.index} className={`create-wizard__card${d.valid ? '' : ' create-wizard__card--invalid'}`}>
              <div className="create-wizard__preview-wrap">
                {d.previewHtml ? (
                  <iframe title={`Direction ${i + 1} preview`} sandbox="" srcDoc={d.previewHtml} />
                ) : (
                  <p className="dash-page__muted">No preview available</p>
                )}
                <button
                  type="button"
                  className="create-wizard__expand"
                  title="Expand preview"
                  onClick={() => setExpanded(d)}
                >
                  ⛶
                </button>
              </div>
              <div className="create-wizard__card-meta">
                <strong>{d.scaffoldName}</strong>
                <p className="dash-page__muted">{d.directive}</p>
                {d.critique && (
                  <div className="create-wizard__critique">
                    <span
                      className={`create-wizard__slop create-wizard__slop--${d.critique.slopScore <= 3 ? 'good' : d.critique.slopScore <= 6 ? 'mid' : 'bad'}`}
                    >
                      AI-slop score {d.critique.slopScore}/10
                    </span>{' '}
                    <span className="dash-page__muted">(lower is better)</span>
                    <p>{d.critique.verdict}</p>
                    {d.critique.issues.length > 0 && (
                      <details>
                        <summary>{d.critique.issues.length} issue{d.critique.issues.length > 1 ? 's' : ''}</summary>
                        <ul>
                          {d.critique.issues.map((issue, j) => (
                            <li key={j}>{issue}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
                {!d.valid && (
                  <p className="dash-page__error">
                    This direction failed validation and can't be applied{d.errors.length ? ` (${d.errors[0]})` : ''}.
                  </p>
                )}
                <button
                  type="button"
                  disabled={!d.valid || applyingIndex !== null}
                  onClick={() => void apply(directions, i, phase.critiqueSkipped)}
                >
                  {applyingIndex === i ? 'Applying…' : 'Use this direction'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="create-wizard__nav">
          <button
            type="button"
            className="secondary"
            disabled={applyingIndex !== null}
            onClick={() => {
              setPhase({ kind: 'intake' });
              setStep(STEP_COUNT - 1);
            }}
          >
            ← Back to setup
          </button>
        </div>

        {expanded && (
          <div className="create-wizard__modal-backdrop" onClick={() => setExpanded(null)}>
            <div className="create-wizard__modal" onClick={(e) => e.stopPropagation()}>
              <div className="create-wizard__modal-bar">
                <strong>{expanded.scaffoldName}</strong> — {expanded.directive}
                <div className="spacer" />
                <button type="button" className="secondary" onClick={() => setExpanded(null)}>
                  Close
                </button>
              </div>
              <iframe title="Direction preview" sandbox="" srcDoc={expanded.previewHtml ?? ''} />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Intake steps ───────────────────────────────────────────────────────────
  const next = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  const back = step > 0 ? () => setStep((s) => s - 1) : undefined;

  return (
    <div className="create-wizard">
      {header}
      {error && <p className="dash-page__error">{error}</p>}

      {step === 0 && (
        <WizardStep
          title="Name & what you do"
          subtitle="This grounds the design and every line of generated copy."
          stepIndex={0}
          stepCount={STEP_COUNT}
          onNext={next}
          nextDisabled={!brandName.trim()}
          nextHint="brand name is required"
        >
          <TextField label="Brand name *" value={brandName} onChange={setBrandName} />
          <TextAreaField
            label="What do you do? (one line)"
            value={description}
            onChange={setDescription}
            rows={2}
            placeholder="e.g. We design and install drought-tolerant gardens for Bay Area homes"
          />
          <div>
            <span className="dash-page__muted">Industry</span>
            <PillToggleGroup
              options={INDUSTRY_SUGGESTIONS}
              selected={industry ? [industry] : []}
              onToggle={(s) => setIndustry(industry === s ? '' : s)}
            />
          </div>
          <TextField label="…or type your own industry" value={industry} onChange={setIndustry} />
          {/* Chunk 11 template-gallery exit — deferred */}
        </WizardStep>
      )}

      {step === 1 && (
        <WizardStep
          title="Who is it for?"
          subtitle="The audience shapes tone, reading level, and what the page leads with."
          stepIndex={1}
          stepCount={STEP_COUNT}
          onBack={back}
          onNext={next}
        >
          <div>
            <span className="dash-page__muted">Pick any that fit</span>
            <PillToggleGroup
              options={AUDIENCE_SUGGESTIONS}
              selected={audienceChips}
              onToggle={(a) => toggleChip(a, audienceChips, setAudienceChips)}
            />
          </div>
          <TextField
            label="…or describe them"
            value={audienceText}
            onChange={setAudienceText}
          />
        </WizardStep>
      )}

      {step === 2 && (
        <WizardStep
          title="Brand personality"
          subtitle="Pick 2–4 words that should come through in the design."
          stepIndex={2}
          stepCount={STEP_COUNT}
          onBack={back}
          onNext={next}
          nextDisabled={personality.length < 2 || personality.length > 4}
          nextHint="pick 2–4"
        >
          <PillToggleGroup
            options={PERSONALITY_OPTIONS}
            selected={personality}
            onToggle={(p) => toggleChip(p, personality, setPersonality)}
          />
        </WizardStep>
      )}

      {step === 3 && (
        <WizardStep
          title="Mood & colors"
          subtitle="Optional — skip and the AI decides from your personality picks."
          stepIndex={3}
          stepCount={STEP_COUNT}
          onBack={back}
          onNext={next}
          onSkip={next}
        >
          <div>
            <span className="dash-page__muted">Visual mood</span>
            <PillToggleGroup
              options={MOOD_OPTIONS}
              selected={moodKeywords}
              onToggle={(m) => toggleChip(m, moodKeywords, setMoodKeywords)}
            />
          </div>
          <TextField label="Color preferences" value={colorPreferences} onChange={setColorPreferences} />
        </WizardStep>
      )}

      {step === 4 && (
        <WizardStep
          title="References & assets"
          subtitle="Optional — point at brands you like, or pull colors and fonts straight from an existing site."
          stepIndex={4}
          stepCount={STEP_COUNT}
          onBack={back}
          onNext={next}
          onSkip={next}
        >
          <div className="panel create-wizard__extract">
            <span className="dash-page__muted">Already have a website? Extract its brand.</span>
            <div className="create-wizard__extract-row">
              <input
                type="url"
                value={extractUrl}
                onChange={(e) => setExtractUrl(e.target.value)}
                placeholder="https://your-current-site.com"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void extractBrand();
                }}
              />
              <button
                type="button"
                className="secondary"
                disabled={!extractUrl.trim() || extracting}
                onClick={() => void extractBrand()}
              >
                {extracting ? 'Extracting…' : 'Extract brand'}
              </button>
            </div>

            {extractDraft && (
              <div className="create-wizard__extract-preview">
                <div className="create-wizard__swatches">
                  {Object.entries(extractDraft.colors).map(([name, hex]) =>
                    hex ? <span key={name} className="create-wizard__swatch" title={`${name}: ${hex}`} style={{ background: hex }} /> : null
                  )}
                </div>
                {(extractDraft.typography.headingFont || extractDraft.typography.bodyFont) && (
                  <p className="dash-page__muted">
                    {[extractDraft.typography.headingFont, extractDraft.typography.bodyFont].filter(Boolean).join(' · ')}
                  </p>
                )}
                {extractDraft.logoUrl && !logoBroken && (
                  <img
                    className="create-wizard__logo"
                    src={extractDraft.logoUrl}
                    alt="Extracted logo"
                    onError={() => setLogoBroken(true)}
                  />
                )}
                <div className="create-wizard__extract-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setExtracted(extractDraft);
                      setExtractDraft(null);
                    }}
                  >
                    Use this brand
                  </button>
                  <button type="button" className="secondary" onClick={() => setExtractDraft(null)}>
                    Discard
                  </button>
                </div>
              </div>
            )}
            {extracted && !extractDraft && (
              <p className="create-wizard__extract-accepted">
                ✓ Brand from {extracted.sourceUrl} will steer the design.{' '}
                <button type="button" className="secondary" onClick={() => setExtracted(null)}>
                  Remove
                </button>
              </p>
            )}
          </div>

          <TextAreaField
            label="Sites you like the look of (one URL per line)"
            value={referenceUrls}
            onChange={setReferenceUrls}
            rows={3}
            placeholder={'https://stripe.com\nhttps://linear.app'}
          />
          <TextAreaField
            label="Existing brand notes or guidelines"
            value={existingBrandNotes}
            onChange={setExistingBrandNotes}
            rows={3}
            placeholder="Paste any brand guide text, copy guidelines, or design principles…"
          />
        </WizardStep>
      )}

      {step === 5 && (
        <WizardStep
          title="How many directions?"
          subtitle="Each direction is a structurally different take on your home page."
          stepIndex={5}
          stepCount={STEP_COUNT}
          onBack={back}
          onNext={() => void generate()}
          nextLabel="Generate my site"
        >
          <div className="create-wizard__count-row">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                className={`create-wizard__count${count === n ? ' create-wizard__count--active' : ''}`}
                onClick={() => setCount(n)}
              >
                <strong>{n}</strong>
                <span>{n === 1 ? 'quickest' : n === 2 ? 'a choice' : 'full spread'}</span>
              </button>
            ))}
          </div>
          <p className="dash-page__muted">
            Roughly 20–40 seconds per direction — {count} direction{count > 1 ? 's' : ''} ≈{' '}
            {count * 20}–{count * 40}s.
          </p>
          {powerpack && (
            <label className="create-wizard__critique-optin">
              <input
                type="checkbox"
                checked={critiqueOptIn}
                onChange={(e) => setCritiqueOptIn(e.target.checked)}
              />
              Score each direction with an AI design critique (Design Powerpack)
            </label>
          )}
          {emailSystem && (
            <>
              <label className="create-wizard__signup-optin">
                <input
                  type="checkbox"
                  checked={signupOptIn}
                  onChange={(e) => setSignupOptIn(e.target.checked)}
                />
                Add a newsletter signup section
              </label>
              <p className="dash-page__muted">
                Collects subscribers on sites connected to WordPress (FreshPress Connector) once email is set up
                in Site Settings → Email. Static and Vercel publishes don't wire the form yet.
              </p>
            </>
          )}
          {/* Chunk 12 competitor-research step slot — deferred */}
        </WizardStep>
      )}
    </div>
  );
}
