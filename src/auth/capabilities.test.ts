import { describe, it, expect } from 'vitest';
import { canActorPublish, isWorkspaceAdminRole } from './middleware.js';
import type { AuthContext } from './types.js';

const admin = (canPublish?: boolean): AuthContext => ({ role: 'admin', canPublish });
const client = (): AuthContext => ({ role: 'client', siteId: 's1' });

describe('canActorPublish', () => {
  it('allows a workspace user whose canPublish is true', () => {
    expect(canActorPublish(admin(true))).toBe(true);
  });

  it('blocks a workspace user whose canPublish is false', () => {
    expect(canActorPublish(admin(false))).toBe(false);
  });

  it('allows break-glass admins with undefined canPublish (master key / legacy session)', () => {
    expect(canActorPublish(admin(undefined))).toBe(true);
  });

  it('allows a client only when the site opts in via clientCanPublish', () => {
    expect(canActorPublish(client(), { clientCanPublish: true })).toBe(true);
  });

  it('blocks a client when clientCanPublish is false', () => {
    expect(canActorPublish(client(), { clientCanPublish: false })).toBe(false);
  });

  it('blocks a client when the site is missing or has no flag', () => {
    expect(canActorPublish(client(), null)).toBe(false);
    expect(canActorPublish(client(), undefined)).toBe(false);
    expect(canActorPublish(client(), {})).toBe(false);
  });

  it('blocks when there is no auth context', () => {
    expect(canActorPublish(undefined)).toBe(false);
  });
});

describe('isWorkspaceAdminRole', () => {
  it('allows owners and admins', () => {
    expect(isWorkspaceAdminRole('owner')).toBe(true);
    expect(isWorkspaceAdminRole('admin')).toBe(true);
  });

  it('blocks the save-only member role', () => {
    expect(isWorkspaceAdminRole('member')).toBe(false);
  });

  it('allows break-glass sessions with no workspace role (master key)', () => {
    expect(isWorkspaceAdminRole(undefined)).toBe(true);
  });
});
