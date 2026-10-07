import type { EmailFormat, EmailTemplate } from '../../api';

interface Props {
  formats: EmailFormat[];
  templates: EmailTemplate[];
  formatId: string;
  onFormatIdChange: (id: string) => void;
  templateId: string;
  onTemplateIdChange: (id: string) => void;
  includeBrand: boolean;
  onIncludeBrandChange: (value: boolean) => void;
  includeSignature: boolean;
  onIncludeSignatureChange: (value: boolean) => void;
}

export default function BrandComposeControls({
  formats,
  templates,
  formatId,
  onFormatIdChange,
  templateId,
  onTemplateIdChange,
  includeBrand,
  onIncludeBrandChange,
  includeSignature,
  onIncludeSignatureChange,
}: Props) {
  return (
    <>
      <label>
        <span className="field-label">Format</span>
        <select value={formatId} onChange={(e) => onFormatIdChange(e.target.value)}>
          {formats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="field-label">Template</span>
        <select value={templateId} onChange={(e) => onTemplateIdChange(e.target.value)}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      <label className="humanize-panel__review-opt" style={{ marginTop: '0.75rem' }}>
        <input type="checkbox" checked={includeBrand} onChange={(e) => onIncludeBrandChange(e.target.checked)} />
        Include Brand
      </label>
      <label className="humanize-panel__review-opt">
        <input
          type="checkbox"
          checked={includeSignature}
          onChange={(e) => onIncludeSignatureChange(e.target.checked)}
        />
        Include Signature
      </label>
    </>
  );
}
