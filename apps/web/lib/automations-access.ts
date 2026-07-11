/**
 * Shared authorization gate for MUTATING automation routes (P8). Centralises the
 * "editor tier + owner-or-admin" check so run/confirm/cancel/pause/delete can't
 * diverge. A non-owner non-admin gets 404 (not 403) so a standard user can't probe
 * which automation ids exist — mirroring the assistant-chat ownership approach.
 */
import 'server-only';

import type { Database } from '@gracie/db';

import { isAdmin, isEditor, type RequestUser } from './api-auth';
import { getAutomationRow } from './data/automations';

type AutomationRow = Database['public']['Tables']['automations']['Row'];

export type AutomationGate =
  | { readonly ok: true; readonly row: AutomationRow }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly status: number };

/** Load an automation and gate a mutating action: editor tier + owner-or-admin. */
export async function gateAutomationMutation(user: RequestUser, id: string): Promise<AutomationGate> {
  if (!isEditor(user)) {
    return { ok: false, code: 'forbidden', message: 'Editor role required', status: 403 };
  }
  const row = await getAutomationRow(id);
  if (row === null || (row.owner_user_id !== user.userId && !isAdmin(user))) {
    return { ok: false, code: 'not_found', message: 'Automation not found', status: 404 };
  }
  return { ok: true, row };
}
