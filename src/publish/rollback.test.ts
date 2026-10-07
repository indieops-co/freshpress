import { describe, it, expect } from 'vitest';
import { resolveRollbackVersionId } from './index.js';

describe('resolveRollbackVersionId', () => {
  it('uses prePublishVersionId when links match', () => {
    const result = resolveRollbackVersionId(
      { id: 'pub1', prePublishVersionId: 'ver1' },
      [{ id: 'ver1', label: 'Pre-publish pub1', publishId: 'pub1' }]
    );
    expect(result).toEqual({ ok: true, versionId: 'ver1' });
  });

  it('rejects when manifest version id points at missing version', () => {
    const result = resolveRollbackVersionId(
      { id: 'pub1', prePublishVersionId: 'ver-missing' },
      [{ id: 'ver1', label: 'Pre-publish pub1', publishId: 'pub1' }]
    );
    expect(result).toEqual({ ok: false, error: 'Linked content snapshot not found for this publish' });
  });

  it('rejects when publishId on version does not match publish record', () => {
    const result = resolveRollbackVersionId(
      { id: 'pub1', prePublishVersionId: 'ver1' },
      [{ id: 'ver1', label: 'Pre-publish pub1', publishId: 'pub-other' }]
    );
    expect(result).toEqual({ ok: false, error: 'Publish and content snapshot link mismatch' });
  });

  it('falls back to version.publishId for legacy records', () => {
    const result = resolveRollbackVersionId(
      { id: 'pub1' },
      [{ id: 'ver1', label: 'Pre-publish pub1', publishId: 'pub1' }]
    );
    expect(result).toEqual({ ok: true, versionId: 'ver1' });
  });

  it('falls back to legacy label when no ids are stored', () => {
    const result = resolveRollbackVersionId(
      { id: 'pub1' },
      [{ id: 'ver1', label: 'Pre-publish pub1' }]
    );
    expect(result).toEqual({ ok: true, versionId: 'ver1' });
  });
});
