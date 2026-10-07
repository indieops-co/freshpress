import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type PublishRecord, type SiteVersion } from '../api';
import { useDashboard } from '../context/DashboardContext';

interface Props {
  siteId: string;
  siteDomain?: string;
}

function publishStatus(record: PublishRecord): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (record.deploymentUrl) return { label: 'Deployed', tone: 'ok' };
  return { label: 'Local snapshot', tone: 'muted' };
}

type RollbackResolveResult =
  | { ok: true; version: SiteVersion }
  | { ok: false; error: string };

/** Match server-side resolveRollbackVersionId for UI enablement and messaging. */
function resolveRollbackVersion(record: PublishRecord, versions: SiteVersion[]): RollbackResolveResult {
  if (record.prePublishVersionId) {
    const linked = versions.find((v) => v.id === record.prePublishVersionId);
    if (!linked) {
      return { ok: false, error: 'Linked content snapshot not found for this publish' };
    }
    if (linked.publishId && linked.publishId !== record.id) {
      return { ok: false, error: 'Publish and content snapshot link mismatch' };
    }
    return { ok: true, version: linked };
  }

  const byPublishId = versions.find((v) => v.publishId === record.id);
  if (byPublishId) return { ok: true, version: byPublishId };

  const byLabel = versions.find((v) => v.label === `Pre-publish ${record.id}`);
  if (byLabel) return { ok: true, version: byLabel };

  return { ok: false, error: 'No linked content snapshot for this publish' };
}

export default function SnapshotsPage({ siteId, siteDomain }: Props) {
  const { setActiveSiteSection } = useDashboard();
  const [publishes, setPublishes] = useState<PublishRecord[]>([]);
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    return Promise.all([api.listPublishes(siteId), api.listVersions(siteId)])
      .then(([p, v]) => {
        setPublishes(p);
        setVersions(v);
        setError('');
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [siteId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const manualVersions = useMemo(
    () => versions.filter((v) => !v.publishId && !v.label.startsWith('Pre-publish ')),
    [versions]
  );

  async function restoreContentVersion(version: SiteVersion) {
    if (
      !confirm(
        `Restore content from "${version.label}"?\n\nCurrent unsaved edits will be replaced. This restores page content only — not theme or code.`
      )
    ) {
      return;
    }
    setError('');
    setStatus('');
    setRestoringId(version.id);
    try {
      await api.restoreVersion(siteId, version.id);
      setStatus(`Content restored from "${version.label}"`);
      setTimeout(() => setStatus(''), 3000);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  }

  async function rollbackPublish(record: PublishRecord) {
    const resolved = resolveRollbackVersion(record, versions);
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    if (
      !confirm(
        `Rollback content to the snapshot saved before "${record.label}"?\n\nCurrent unsaved edits will be replaced. Re-publish from the Editor if you need to update the live site.`
      )
    ) {
      return;
    }
    setError('');
    setStatus('');
    setRestoringId(resolved.version.id);
    try {
      const result = await api.rollbackPublish(siteId, record.id);
      setStatus(`Content restored from publish snapshot (${result.versionId})`);
      setTimeout(() => setStatus(''), 3000);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed');
    } finally {
      setRestoringId(null);
    }
  }

  if (loading) return <p className="dash-page__muted">Loading snapshots…</p>;

  return (
    <div className="dash-page">
      <h2 className="dash-page__title">Snapshots</h2>
      <p className="dash-page__lead">Every publish is saved as an immutable snapshot.</p>
      <p className="dash-page__muted">
        Rollback restores content, not code. Use the Editor to publish again after restoring.
      </p>

      {error && <div className="error-banner">{error}</div>}
      {status && <p className="status-ok">{status}</p>}

      <div className="panel snapshots-summary">
        <dl className="settings-dl">
          <dt>Publish snapshots</dt>
          <dd>{publishes.length}</dd>
          <dt>Content versions</dt>
          <dd>{versions.length}</dd>
          <dt>Latest publish</dt>
          <dd>
            {publishes[0]
              ? `${publishes[0].label} (${new Date(publishes[0].createdAt).toLocaleString()})`
              : '—'}
          </dd>
        </dl>
      </div>

      {publishes.length === 0 ? (
        <div className="panel dash-placeholder snapshots-empty" style={{ marginTop: '1rem' }}>
          <p>No publish snapshots yet.</p>
          <p className="hint">
            Open{' '}
            <button type="button" className="link-button" onClick={() => setActiveSiteSection('editor')}>
              Editor
            </button>{' '}
            and publish to create your first immutable snapshot.
          </p>
        </div>
      ) : (
        <div className="panel snapshots-table-wrap" style={{ marginTop: '1rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>Publish history</h3>
          <div className="snapshots-table-scroll">
            <table className="snapshots-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Published by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {publishes.map((record) => {
                  const statusInfo = publishStatus(record);
                  const rollback = resolveRollbackVersion(record, versions);
                  const target = record.deploymentUrl ?? siteDomain ?? '—';
                  return (
                    <tr key={record.id}>
                      <td>{new Date(record.createdAt).toLocaleString()}</td>
                      <td>
                        <div>{record.label}</div>
                        <div className="hint">{record.pageCount} page{record.pageCount === 1 ? '' : 's'}</div>
                      </td>
                      <td>
                        <span className={`snapshots-status snapshots-status--${statusInfo.tone}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td>
                        {record.deploymentUrl ? (
                          <a href={record.deploymentUrl} target="_blank" rel="noreferrer">
                            {target}
                          </a>
                        ) : (
                          target
                        )}
                      </td>
                      <td className="snapshots-table__muted">—</td>
                      <td>
                        <div className="snapshots-actions">
                          <button
                            type="button"
                            className="secondary snapshots-action-btn"
                            disabled
                            title="Compare snapshot to current content — coming soon"
                          >
                            Compare to current
                          </button>
                          <button
                            type="button"
                            className="secondary snapshots-action-btn"
                            disabled={!rollback.ok || restoringId !== null}
                            title={rollback.ok ? 'Restore page content from the linked pre-publish snapshot' : rollback.error}
                            onClick={() => void rollbackPublish(record)}
                          >
                            {restoringId === (rollback.ok ? rollback.version.id : null)
                              ? 'Restoring…'
                              : 'Rollback content'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ margin: '0.75rem 0 0' }}>
            Rollback validates the linked pre-publish content snapshot before restoring. Re-publish from the Editor
            after restoring if you need to update the live site.
          </p>
        </div>
      )}

      <div className="panel" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Content versions</h3>
        <p className="dash-page__muted" style={{ marginTop: 0 }}>
          Manual snapshots from the Editor. Pre-publish saves linked to publishes appear only in the table above.
        </p>
        {manualVersions.length === 0 ? (
          <p className="hint">No manual content versions yet. Use Snapshot in the Editor to save one.</p>
        ) : (
          <ul className="slot-list">
            {manualVersions.map((v) => (
              <li key={v.id} className="slot-item snapshots-version-row">
                <div>
                  <strong>{v.label}</strong>
                  <div className="tag">{new Date(v.createdAt).toLocaleString()}</div>
                </div>
                <div className="snapshots-actions">
                  <button type="button" className="secondary snapshots-action-btn" disabled title="Coming soon">
                    Compare to current
                  </button>
                  <button
                    type="button"
                    className="secondary snapshots-action-btn"
                    disabled={restoringId !== null}
                    onClick={() => void restoreContentVersion(v)}
                  >
                    {restoringId === v.id ? 'Restoring…' : 'Restore content'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel snapshots-future" style={{ marginTop: '1rem' }}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Coming later</h3>
        <ul className="media-future__list">
          <li>Side-by-side snapshot compare</li>
          <li>One-click re-deploy of a past publish bundle</li>
          <li>Published-by audit trail</li>
          <li>Rollback preview before apply</li>
        </ul>
      </div>
    </div>
  );
}
