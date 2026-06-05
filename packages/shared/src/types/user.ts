import type { Role } from '../constants/roles.js';
import type { ISOTimestamp, Timestamps, UUID } from './common.js';

/**
 * `users` table (docs/04). Synced from Logto on first login. No Microsoft
 * tokens — calendar access is app-level/group-scoped (D5); "calendar connected"
 * == membership in the access group.
 */
export interface User extends Timestamps {
  readonly id: UUID;
  readonly logtoId: string;
  readonly email: string;
  readonly name: string;
  readonly initials: string;
  readonly role: Role;
  readonly isCalendarConnected: boolean;
  readonly lastActiveAt: ISOTimestamp | null;
}
