import { Router } from 'express';
import { getWorkspaceUsersStore } from '../storage/workspace-users.js';
import { requireWorkspaceAdmin, hashPassword } from '../auth/middleware.js';
import { routeParam } from '../util/params.js';
import { WorkspaceUserRoleSchema, type WorkspaceUser, type WorkspaceUserRole } from '../auth/types.js';

const router = Router();

/** Public shape for a team member — never leaks the password hash. */
function sanitize(u: WorkspaceUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    permissions: u.permissions,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function parseRole(value: unknown): WorkspaceUserRole | null {
  const parsed = WorkspaceUserRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// All team-management routes require an owner/admin workspace role (not just any session),
// so a save-only member cannot invite users or grant themselves publish rights.
const guards = [requireWorkspaceAdmin] as const;

router.get('/team/members', ...guards, async (_req, res) => {
  const store = await getWorkspaceUsersStore();
  const users = await store.listUsers();
  res.json(users.map(sanitize));
});

router.post('/team/members', ...guards, async (req, res) => {
  try {
    const { email, displayName, password, role, canPublish } = req.body as {
      email?: string;
      displayName?: string;
      password?: string;
      role?: string;
      canPublish?: boolean;
    };
    if (!email?.trim() || !displayName?.trim() || !password) {
      res.status(400).json({ error: 'email, displayName, and password are required' });
      return;
    }

    const store = await getWorkspaceUsersStore();
    const workspace = await store.getWorkspace();
    if (!workspace) {
      res.status(500).json({ error: 'Workspace not found' });
      return;
    }
    if (await store.getUserByEmail(email)) {
      res.status(409).json({ error: 'A user with that email already exists' });
      return;
    }

    const memberRole = parseRole(role) ?? 'member';
    // Members default to save-only; owners/admins default to publish. Owners always publish.
    const canPub =
      memberRole === 'owner'
        ? true
        : typeof canPublish === 'boolean'
          ? canPublish
          : memberRole !== 'member';

    const user = await store.createUser({
      workspaceId: workspace.id,
      email: email.trim(),
      displayName: displayName.trim(),
      passwordHash: hashPassword(password),
      role: memberRole,
      permissions: { canPublish: canPub },
    });
    res.status(201).json(sanitize(user));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create member' });
  }
});

router.patch('/team/members/:id', ...guards, async (req, res) => {
  try {
    const store = await getWorkspaceUsersStore();
    const user = await store.getUserById(routeParam(req.params.id));
    if (!user) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const { role, canPublish, displayName } = req.body as {
      role?: string;
      canPublish?: boolean;
      displayName?: string;
    };

    const nextRole = role !== undefined ? parseRole(role) ?? user.role : user.role;

    // Never leave the workspace without an owner.
    if (user.role === 'owner' && nextRole !== 'owner') {
      const owners = (await store.listUsers()).filter((u) => u.role === 'owner');
      if (owners.length <= 1) {
        res.status(400).json({ error: 'Cannot change the role of the last owner' });
        return;
      }
    }

    const nextCanPublish =
      nextRole === 'owner'
        ? true
        : typeof canPublish === 'boolean'
          ? canPublish
          : user.permissions.canPublish;

    const updated = await store.saveUser({
      ...user,
      role: nextRole,
      displayName: displayName?.trim() || user.displayName,
      permissions: { canPublish: nextCanPublish },
    });
    res.json(sanitize(updated));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update member' });
  }
});

router.delete('/team/members/:id', ...guards, async (req, res) => {
  try {
    const store = await getWorkspaceUsersStore();
    const user = await store.getUserById(routeParam(req.params.id));
    if (!user) {
      res.status(204).send();
      return;
    }
    if (user.role === 'owner') {
      const owners = (await store.listUsers()).filter((u) => u.role === 'owner');
      if (owners.length <= 1) {
        res.status(400).json({ error: 'Cannot delete the last owner' });
        return;
      }
    }
    await store.deleteUser(user.id);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete member' });
  }
});

export default router;
