'use client';

import { useState } from 'react';
import { ROLES, type Role } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * Change who can see a folder, or a single file.
 *
 * FOLDERS get a straight role list. FILES additionally get an inherit/override
 * choice: by default a file has no permissions of its own and follows its folder;
 * choosing "Only specific roles" writes an override that can lock it down further.
 *
 * Two rules the UI has to make legible rather than merely enforce:
 *  - ADMIN CANNOT BE UNCHECKED. Admins hold `folder.viewRestricted`, so the server
 *    grants them access whatever the stored list says. Offering the checkbox would be
 *    offering a lie.
 *  - A FOLDER IS A CEILING. An override can only narrow access, never widen it past
 *    what the containing folder already allows — stated inline so nobody expects a
 *    file override to expose something out of a restricted folder.
 */
export interface PermissionsTarget {
  readonly kind: 'folder' | 'file';
  readonly id: string;
  readonly name: string;
  readonly visibility: 'all' | 'restricted' | null;
  readonly allowedRoles: readonly Role[] | null;
  /** Files only: what the file inherits today, for the "Inherit" option's summary. */
  readonly inheritedFrom?: { readonly name: string; readonly summary: string } | null;
}

export interface PermissionsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly target: PermissionsTarget;
  readonly isAdmin: boolean;
}

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: 'Admin',
  standard: 'Standard',
  viewer: 'Viewer',
};

/** Human summary of a rule, e.g. "Everyone" or "Admin, Standard". */
export function describeAccess(
  visibility: 'all' | 'restricted' | null,
  allowedRoles: readonly Role[] | null,
): string {
  if (visibility !== 'restricted') return 'Everyone';
  const roles = allowedRoles ?? [];
  const named = ROLES.filter((r) => roles.includes(r) || r === 'admin').map((r) => ROLE_LABELS[r]);
  return named.join(', ');
}

export function PermissionsModal({
  isOpen,
  onClose,
  onSaved,
  target,
  isAdmin,
}: PermissionsModalProps): React.JSX.Element {
  const isFile = target.kind === 'file';
  const [inherit, setInherit] = useState(isFile && target.visibility === null);
  const [restricted, setRestricted] = useState(target.visibility === 'restricted');
  // Only meaningful once `restricted` is on. Seeded from the stored list when the item
  // is already restricted; otherwise admin-only, so switching restriction ON starts
  // from the tightest state rather than from "restricted to everyone", which is what
  // carrying the unrestricted default `{admin,standard,viewer}` across would produce.
  const [roles, setRoles] = useState<readonly Role[]>(
    target.visibility === 'restricted' ? (target.allowedRoles ?? ['admin']) : ['admin'],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(role: Role): void {
    if (role === 'admin') return; // never removable
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const path = isFile ? `/api/documents/${target.id}` : `/api/folders/${target.id}`;
      const body =
        isFile && inherit
          ? { visibility: null }
          : {
              visibility: restricted ? 'restricted' : 'all',
              allowedRoles: restricted ? [...new Set([...roles, 'admin' as Role])] : [...ROLES],
            };
      await apiClient.patch(path, body);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save permissions.');
    } finally {
      setSubmitting(false);
    }
  }

  const rolePickerDisabled = (isFile && inherit) || !restricted;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Permissions — ${target.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={(): void => void submit()} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save permissions'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isFile ? (
          <fieldset className="flex flex-col gap-2">
            <legend style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>
              This file&rsquo;s access
            </legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="inherit"
                checked={inherit}
                onChange={(): void => setInherit(true)}
                className="mt-1"
              />
              <span style={TYPE.body}>
                Inherit from{' '}
                <strong>{target.inheritedFrom?.name ?? 'its folder'}</strong>
                {target.inheritedFrom !== null && target.inheritedFrom !== undefined ? (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {' '}
                    — {target.inheritedFrom.summary}
                  </span>
                ) : null}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="inherit"
                checked={!inherit}
                onChange={(): void => {
                  setInherit(false);
                  setRestricted(true);
                }}
                className="mt-1"
              />
              <span style={TYPE.body}>Override for this file</span>
            </label>
          </fieldset>
        ) : null}

        {!isFile || !inherit ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={restricted}
              disabled={!isAdmin}
              onChange={(event): void => setRestricted(event.target.checked)}
            />
            <span style={TYPE.body}>Restrict to specific roles</span>
          </label>
        ) : null}

        {!rolePickerDisabled ? (
          <fieldset className="flex flex-col gap-2">
            <legend style={{ ...TYPE.label, color: 'var(--text-secondary)' }}>Who can see it</legend>
            {ROLES.map((role) => (
              <label key={role} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={role === 'admin' || roles.includes(role)}
                  disabled={role === 'admin' || !isAdmin}
                  onChange={(): void => toggleRole(role)}
                />
                <span style={TYPE.body}>
                  {ROLE_LABELS[role]}
                  {role === 'admin' ? (
                    <span style={{ color: 'var(--text-secondary)' }}> — always has access</span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {isFile ? (
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            An override can only narrow access. A file cannot be made more visible than the folder
            it lives in.
          </p>
        ) : null}
        {!isAdmin ? (
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            Only admins can change restricted access.
          </p>
        ) : null}
        {error !== null ? (
          <span role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
            {error}
          </span>
        ) : null}
      </div>
    </Modal>
  );
}
