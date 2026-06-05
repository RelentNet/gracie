/**
 * User roles (mirrors `user_role` enum in docs/04-database-schema.sql).
 * Three roles drive every permission decision (D14).
 */
export const ROLES = ['admin', 'standard', 'viewer'] as const;

export type Role = (typeof ROLES)[number];

/**
 * Role display badge styling per docs/08 §6/§7.
 * - Admin → navy badge
 * - Viewer → amber badge
 * - Standard → no badge
 */
export interface RoleBadge {
  readonly label: string;
  /** CSS custom-property token name for the badge background, or null = no badge. */
  readonly token: string | null;
}

export const ROLE_BADGES: Readonly<Record<Role, RoleBadge>> = {
  admin: { label: 'Admin', token: '--color-navy-700' },
  standard: { label: 'Standard', token: null },
  viewer: { label: 'Viewer', token: '--color-amber-500' },
} as const;

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
