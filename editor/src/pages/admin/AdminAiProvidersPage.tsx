import { useEffect, useState } from 'react';
import { api } from '../../api';
export default function AdminAiProvidersPage() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.getIntegrations>> | null>(null);
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [defaultProvider, setDefaultProvider] = useState<'openrouter' | 'anthropic' | ''>('');
  const [defaultModel, setDefaultModel] = useState('');
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getIntegrations()
      .then((s) => {
        setStatus(s);
        setDefaultProvider(s.defaultAiProvider ?? '');
        setDefaultModel(s.defaultAiModel ?? '');
      })
      .catch((e) => setError(e.message));
  }, []);

  async function loadModels() {
    setError('');
    try {
      const res = await api.listOpenRouterModels();
      setModels(res.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const patch: Parameters<typeof api.updateIntegrations>[0] = {
        defaultAiProvider: defaultProvider || null,
        defaultAiModel: defaultModel || null,
      };
      if (openrouterKey) patch.openrouter_api_key = openrouterKey;
      if (anthropicKey) patch.anthropic_api_key = anthropicKey;

      const next = await api.updateIntegrations(patch);
      setStatus(next);
      setOpenrouterKey('');
      setAnthropicKey('');
      setMessage('AI provider settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(key: 'openrouter_api_key' | 'anthropic_api_key') {
    setSaving(true);
    setError('');
    try {
      const next = await api.updateIntegrations({ [key]: null });
      setStatus(next);
      setMessage('Key removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {error && <p className="dash-page__error">{error}</p>}
      {message && <p className="dash-page__success">{message}</p>}

      <form className="admin-form" onSubmit={save}>
        <fieldset className="admin-form__section">
          <legend>OpenRouter</legend>
          <p className="dash-page__muted">
            Status: {status?.openrouter ? '✓ configured' : 'not set'}
            {status?.openrouter && (
              <button type="button" className="secondary admin-form__clear" onClick={() => clearKey('openrouter_api_key')}>
                Remove
              </button>
            )}
          </p>
          <label>
            OpenRouter API key
            <input
              type="password"
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
              placeholder={status?.openrouter ? '••••••••' : 'sk-or-...'}
              autoComplete="off"
            />
          </label>
          {status?.openrouter && (
            <button type="button" className="secondary" onClick={() => void loadModels()}>
              Load model list
            </button>
          )}
        </fieldset>

        <fieldset className="admin-form__section">
          <legend>Anthropic (direct)</legend>
          <p className="dash-page__muted">
            Status: {status?.anthropic ? '✓ configured' : 'not set'}
            {status?.anthropic && (
              <button type="button" className="secondary admin-form__clear" onClick={() => clearKey('anthropic_api_key')}>
                Remove
              </button>
            )}
          </p>
          <label>
            Anthropic API key
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              placeholder={status?.anthropic ? '••••••••' : 'sk-ant-...'}
              autoComplete="off"
            />
          </label>
        </fieldset>

        <fieldset className="admin-form__section">
          <legend>Defaults</legend>
          <label>
            Preferred provider
            <select
              value={defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value as 'openrouter' | 'anthropic' | '')}
            >
              <option value="">Auto (Anthropic first, then OpenRouter)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label>
            Default model
            <input
              list="openrouter-models"
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              placeholder="anthropic/claude-sonnet-4 or claude-sonnet-4-20250514"
            />
            <datalist id="openrouter-models">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </datalist>
          </label>
        </fieldset>

        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save AI settings'}
        </button>
      </form>
    </>
  );
}
