/**
 * Permission matrix (docs/02 D14) as a typed data structure.
 *
 * Source of truth for BOTH server-side enforcement (API middleware — primary)
 * and UI visibility filtering. Restricted content must be COMPLETELY HIDDEN for
 * unauthorized roles (omitted from the response/DOM), not merely disabled.
 *
 * Phase 1B: API middleware will consume `can()` to gate every route. The web
 * mock auth (apps/web/lib/auth.ts) consumes it now to demonstrate role-based
 * nav/tab filtering.
 */
import type { Role } from './roles.js';

/** Every gated capability in the system (one row of the D14 matrix). */
export const PERMISSIONS = [
  // --- read (all roles) ---
  'client.view',
  'document.view',
  'document.download',
  'task.view',
  'pipeline.view',
  'dailySync.view',
  'brief.view',
  'knowledgeBase.view',
  'ai.chat',
  'notes.read',
  'task.completeOwn',
  'contacts.view',
  'automations.view',
  // --- editor (admin + standard) ---
  'file.upload',
  'contacts.edit',
  'folder.manage',
  'file.move',
  'file.deleteOwn',
  'task.edit',
  'notes.add',
  'task.updateAny',
  'automations.edit',
  // --- admin only ---
  'folder.viewRestricted',
  'finance.view',
  'file.deleteAny',
  'folder.delete',
  'settings.access',
  'users.manage',
  'pipeline.triggerManual',
  'pipeline.viewErrors',
  'calendar.configure',
  'automations.externalSend',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Which roles hold each permission. Derived directly from the D14 table.
 * `true` = granted.
 */
export const PERMISSION_MATRIX: Readonly<
  Record<Permission, Readonly<Record<Role, boolean>>>
> = {
  // read — granted to all three roles
  'client.view': { admin: true, standard: true, viewer: true },
  'document.view': { admin: true, standard: true, viewer: true },
  'document.download': { admin: true, standard: true, viewer: true },
  'task.view': { admin: true, standard: true, viewer: true },
  'pipeline.view': { admin: true, standard: true, viewer: true },
  'dailySync.view': { admin: true, standard: true, viewer: true },
  'brief.view': { admin: true, standard: true, viewer: true },
  'knowledgeBase.view': { admin: true, standard: true, viewer: true },
  'ai.chat': { admin: true, standard: true, viewer: true },
  'notes.read': { admin: true, standard: true, viewer: true },
  'task.completeOwn': { admin: true, standard: true, viewer: true },
  // Contacts & Org Charts (phase CO): read = all roles; edit = editor tier.
  'contacts.view': { admin: true, standard: true, viewer: true },
  // Automations (P8): view = all roles (viewer read-only); the row-scope (own vs all)
  // is enforced in the data layer, not here.
  'automations.view': { admin: true, standard: true, viewer: true },

  // editor — admin + standard
  'file.upload': { admin: true, standard: true, viewer: false },
  'contacts.edit': { admin: true, standard: true, viewer: false },
  'folder.manage': { admin: true, standard: true, viewer: false },
  'file.move': { admin: true, standard: true, viewer: false },
  'file.deleteOwn': { admin: true, standard: true, viewer: false },
  'task.edit': { admin: true, standard: true, viewer: false },
  'notes.add': { admin: true, standard: true, viewer: false },
  'task.updateAny': { admin: true, standard: true, viewer: false },
  // Automations (P8): create/manage own automations (Confirm/run-now/pause/delete).
  'automations.edit': { admin: true, standard: true, viewer: false },

  // admin only
  'folder.viewRestricted': { admin: true, standard: false, viewer: false },
  'finance.view': { admin: true, standard: false, viewer: false },
  'file.deleteAny': { admin: true, standard: false, viewer: false },
  'folder.delete': { admin: true, standard: false, viewer: false },
  'settings.access': { admin: true, standard: false, viewer: false },
  'users.manage': { admin: true, standard: false, viewer: false },
  'pipeline.triggerManual': { admin: true, standard: false, viewer: false },
  'pipeline.viewErrors': { admin: true, standard: false, viewer: false },
  'calendar.configure': { admin: true, standard: false, viewer: false },
  // Automations (P8): the customer-contact exception — approve an EXTERNAL send.
  'automations.externalSend': { admin: true, standard: false, viewer: false },
} as const;

/** Returns true if `role` holds `permission`. */
export function can(role: Role, permission: Permission): boolean {
  return PERMISSION_MATRIX[permission][role];
}
