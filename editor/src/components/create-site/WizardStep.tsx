/**
 * Chunk 9 / Amendment D — one wizard screen: a single title, one control
 * cluster (children), progress dots, and Back/Next/Skip. Purely presentational;
 * CreateSiteFlow owns all state and step order.
 */

interface Props {
  title: string;
  subtitle?: string;
  stepIndex: number;
  stepCount: number;
  children: React.ReactNode;
  onBack?: () => void;
  onNext: () => void;
  /** Present on optional steps (everything after personality). */
  onSkip?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  /** Hint shown next to a disabled Next (e.g. "pick 2–4"). */
  nextHint?: string;
}

export default function WizardStep({
  title,
  subtitle,
  stepIndex,
  stepCount,
  children,
  onBack,
  onNext,
  onSkip,
  nextLabel = 'Next',
  nextDisabled = false,
  nextHint,
}: Props) {
  return (
    <div className="create-wizard__step">
      <div className="create-wizard__dots" aria-label={`Step ${stepIndex + 1} of ${stepCount}`}>
        {Array.from({ length: stepCount }, (_, i) => (
          <span
            key={i}
            className={`create-wizard__dot${i === stepIndex ? ' create-wizard__dot--active' : ''}${i < stepIndex ? ' create-wizard__dot--done' : ''}`}
          />
        ))}
      </div>

      <h2 className="dash-page__title">{title}</h2>
      {subtitle && <p className="dash-page__muted">{subtitle}</p>}

      <div className="create-wizard__body">{children}</div>

      <div className="create-wizard__nav">
        {onBack && (
          <button type="button" className="secondary" onClick={onBack}>
            ← Back
          </button>
        )}
        <div className="spacer" />
        {nextHint && nextDisabled && <span className="create-wizard__hint">{nextHint}</span>}
        {onSkip && (
          <button type="button" className="secondary" onClick={onSkip}>
            Skip
          </button>
        )}
        <button type="button" onClick={onNext} disabled={nextDisabled}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
