/**
 * Shared multi-select pill toggles (Chunk 9), used by the create-site wizard
 * (CreateSiteFlow) for personality/mood/audience/industry chips. The option
 * lists live here too — one source for every intake surface.
 */

export const PERSONALITY_OPTIONS = [
  'modern', 'minimal', 'bold', 'playful', 'professional', 'elegant',
  'technical', 'friendly', 'luxurious', 'editorial', 'energetic', 'warm',
];

export const MOOD_OPTIONS = [
  'dark', 'light', 'vibrant', 'muted', 'cinematic', 'clean',
  'futuristic', 'organic', 'corporate', 'creative',
];

export function toggleChip(value: string, list: string[], setter: (v: string[]) => void) {
  setter(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
}

interface Props {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}

export default function PillToggleGroup({ options, selected, onToggle }: Props) {
  return (
    <div className="pill-toggle-group">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={`pill-toggle${selected.includes(option) ? ' pill-toggle--active' : ''}`}
          onClick={() => onToggle(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
