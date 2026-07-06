'use client';

/**
 * Users panel (Settings → Users, docs/02 D14 `users.manage`). Admin-only surface
 * to manage who is an admin / standard / viewer from inside Gracie — the "admin
 * group, inside the app". Also offboards (deactivates) / reactivates accounts.
 *
 * Approach B: role is authoritative in Gracie's DB, so a change takes effect on
 * the target's next request — no re-login. Self role-changes and deactivations
 * are confirmed; the API blocks removing the last active admin.
 */
import { useCallback, useEffect, useState } from 'react';

import { ROLE_BADGES, ROLES } from '@gracie/shared';
import type { Role } from '@gracie/shared';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ClientAvatar } from '@/components/ClientAvatar';
import { TYPE } from '@/lib/typography';

interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly initials: string;
  readonly role: Role;
  readonly calendarConnected: boolean;
  readonly deactivated: boolean;
  readonly lastActiveAt: string | null;
}

interface RowState {
  /** The role currently selected in the row's <select> (may differ from saved). */
  readonly pendingRole: Role;
  readonly busy: boolean;
}

const GRID_COLUMNS = 'minmax(0, 2fr) minmax(0, 1.3fr) auto auto';

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `Request failed: ${res.status}`);
  }
  return body;
}

/** Role pill via the shared ROLE_BADGES palette (`standard` intentionally bare). */
function RoleBadge({ role }: { readonly role: Role }): React.JSX.Element {
  const badge = ROLE_BADGES[role];
  if (badge.token === null) {
    return <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{badge.label}</span>;
  }
  const fg = role === 'admin' ? '#ffffff' : 'var(--text-primary)';
  return (
    <Badge bg={`var(${badge.token})`} fg={fg}>
      {badge.label}
    </Badge>
  );
}

export function UsersPanel(): React.JSX.Element {
  const [users, setUsers] = useState<readonly UserRow[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({});
  const [notice, setNotice] = useState<{ readonly text: string; readonly ok: boolean } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const data = (await api('/api/settings/users')) as {
        users: UserRow[];
        currentUserId: string | null;
      };
      setUsers(data.users);
      setCurrentUserId(data.currentUserId);
      const next: Record<string, RowState> = {};
      for (const u of data.users) next[u.id] = { pendingRole: u.role, busy: false };
      setRows(next);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load users.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchRow = (id: string, patch: Partial<RowState>): void => {
    setRows((prev) => {
      const cur = prev[id];
      if (cur === undefined) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };

  async function saveRole(u: UserRow): Promise<void> {
    const row = rows[u.id];
    if (row === undefined || row.pendingRole === u.role) return;
    const nextRole = row.pendingRole;

    if (currentUserId !== null && u.id === currentUserId) {
      const warn =
        nextRole === 'admin'
          ? 'Change your own role to Admin?'
          : "Change your OWN role away from Admin? You'll immediately lose access to Settings and user management on your next request. Continue?";
      if (!window.confirm(warn)) return;
    }

    setNotice(null);
    patchRow(u.id, { busy: true });
    try {
      await api(`/api/settings/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      setNotice({ text: `${u.name} is now ${ROLE_BADGES[nextRole].label}.`, ok: true });
      await load();
    } catch (error) {
      patchRow(u.id, { busy: false });
      setNotice({ text: error instanceof Error ? error.message : 'Update failed.', ok: false });
    }
  }

  async function toggleActive(u: UserRow): Promise<void> {
    const deactivate = !u.deactivated;
    const isSelf = currentUserId !== null && u.id === currentUserId;
    const prompt = deactivate
      ? `Deactivate ${isSelf ? 'your own account' : u.name}? They lose access until reactivated.`
      : `Reactivate ${u.name}?`;
    if (!window.confirm(prompt)) return;

    setNotice(null);
    patchRow(u.id, { busy: true });
    try {
      await api(`/api/settings/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ deactivated: deactivate }),
      });
      setNotice({ text: `${u.name} ${deactivate ? 'deactivated' : 'reactivated'}.`, ok: true });
      await load();
    } catch (error) {
      patchRow(u.id, { busy: false });
      setNotice({ text: error instanceof Error ? error.message : 'Update failed.', ok: false });
    }
  }

  if (loadError !== null) {
    return <ErrorState title="Could not load users" description={loadError} />;
  }
  if (users === null) {
    return <LoadingState label="Loading users…" />;
  }
  if (users.length === 0) {
    return (
      <EmptyState
        title="No users yet"
        description="Users appear here after they first sign in to Gracie."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notice !== null ? (
        <div
          role="status"
          className="rounded-lg border px-4 py-2"
          style={{
            borderColor: notice.ok ? 'var(--border-subtle)' : 'var(--color-red-500)',
            ...TYPE.secondary,
            color: notice.ok ? 'var(--text-secondary)' : 'var(--color-red-500)',
          }}
        >
          {notice.text}
        </div>
      ) : null}

      <Card className="p-0">
        {/* Header */}
        <div
          className="grid items-center gap-3 px-4 py-2"
          style={{
            gridTemplateColumns: GRID_COLUMNS,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>User</span>
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Role</span>
          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>Status</span>
          <span className="sr-only">Actions</span>
        </div>

        {users.map((u, index) => {
          const row = rows[u.id] ?? { pendingRole: u.role, busy: false };
          const dirty = row.pendingRole !== u.role;
          const isSelf = currentUserId !== null && u.id === currentUserId;
          return (
            <div
              key={u.id}
              className="grid items-center gap-3 px-4 py-3"
              style={{
                gridTemplateColumns: GRID_COLUMNS,
                borderTop: index === 0 ? undefined : '1px solid var(--border-subtle)',
                opacity: u.deactivated ? 0.55 : 1,
              }}
            >
              {/* User */}
              <div className="flex min-w-0 items-center gap-3">
                <ClientAvatar initials={u.initials} size="sm" color="var(--color-blue-700)" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate" style={TYPE.bodyStrong}>
                    {u.name}
                    {isSelf ? (
                      <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}> (you)</span>
                    ) : null}
                  </span>
                  <span
                    className="truncate"
                    style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
                  >
                    {u.email}
                  </span>
                </div>
              </div>

              {/* Role select */}
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`role-${u.id}`}>
                  Role for {u.name}
                </label>
                <select
                  id={`role-${u.id}`}
                  value={row.pendingRole}
                  disabled={row.busy}
                  onChange={(e) => {
                    patchRow(u.id, { pendingRole: e.target.value as Role });
                  }}
                  className="rounded-lg border px-2 py-1"
                  style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_BADGES[r].label}
                    </option>
                  ))}
                </select>
                {dirty ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={row.busy}
                    onClick={() => {
                      void saveRole(u);
                    }}
                  >
                    Save
                  </Button>
                ) : null}
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                {u.deactivated ? (
                  <Badge bg="var(--color-slate-100)" fg="var(--text-secondary)">
                    Deactivated
                  </Badge>
                ) : (
                  <RoleBadge role={u.role} />
                )}
                <span
                  className="inline-flex items-center gap-1"
                  title="Calendar connection"
                  aria-label={u.calendarConnected ? 'Calendar connected' : 'Calendar not connected'}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: u.calendarConnected
                        ? 'var(--color-emerald-500)'
                        : 'var(--color-slate-500)',
                    }}
                  />
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end">
                <Button
                  variant={u.deactivated ? 'secondary' : 'danger'}
                  size="sm"
                  disabled={row.busy}
                  onClick={() => {
                    void toggleActive(u);
                  }}
                >
                  {u.deactivated ? 'Reactivate' : 'Deactivate'}
                </Button>
              </div>
            </div>
          );
        })}
      </Card>

      <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        Role changes take effect on the user&rsquo;s next action — no sign-out required.
      </p>
    </div>
  );
}
