'use client';

/**
 * Auth context (client). Hydrated from the server-resolved identity passed as
 * `initialUser` (lib/server-auth.ts → root layout). Falls back to the mock user
 * when none is provided so client-only previews still render. `useAuth`,
 * `hasRole`, `can`, and `canEdit` keep stable signatures — call sites unchanged.
 * See docs/07 §5 (Logto) and docs/02 D4.
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { can } from '@gracie/shared';
import type { Permission, Role } from '@gracie/shared';

import { MOCK_USER, type AuthUser } from './auth-shared';
import { DEFAULT_BRAND_PRESET_ID, resolveBrandPreset } from './brand-presets';

/** Product name when nothing is configured — the default preset's own name. */
const DEFAULT_PRODUCT_NAME = resolveBrandPreset(null).productName;

export type { AuthUser };

export interface AuthContextValue {
  readonly user: AuthUser;
  /** True if the current user holds one of the given roles. */
  hasRole(...roles: readonly Role[]): boolean;
  /** True if the current user holds the given permission (D14 matrix). */
  can(permission: Permission): boolean;
  /** Convenience: editors (admin/standard) may mutate content. */
  canEdit(): boolean;
  /**
   * Firm-wide DISPLAY toggle for relationship-health scores (Settings → Scoring).
   * Not user-scoped — hydrated from `settings.client_health_scores_visible` in the
   * root layout so every client component gates on it without its own fetch.
   */
  readonly healthScoresVisible: boolean;
  /**
   * Firm-wide toggle: reveal the cross-client Task Board to ALL users. False (the
   * default) keeps the board admin-only; admins see it either way. Hydrated from
   * `settings.task_board_visible_to_all` in the root layout so the Sidebar + /tasks
   * page gate on it without their own fetch (same pattern as `healthScoresVisible`).
   */
  readonly taskBoardVisibleToAll: boolean;
  /**
   * MinIO object key of the configured nav brand logo, or null when none is set.
   * Hydrated from `settings.brand_logo_key` in the root layout (same pattern as
   * `healthScoresVisible`) so the Sidebar renders the logo without its own fetch
   * and never flashes a broken image. Doubles as the `<img src>` cache-buster.
   */
  readonly brandLogoKey: string | null;
  /**
   * MinIO object key of the OPTIONAL dark-theme nav logo, or null when unset.
   * Hydrated from `settings.brand_logo_dark_key`. When null the Sidebar reuses
   * `brandLogoKey` in dark mode (unchanged single-logo behavior).
   */
  readonly brandLogoDarkKey: string | null;
  /**
   * Configured product name (Settings → Company → Branding) — what the app calls
   * itself in the nav, in copy, and as the meeting bot's display name. Hydrated in
   * the root layout from the active brand preset plus an optional name override,
   * same pattern as `brandLogoKey`, so no component fetches it.
   */
  readonly productName: string;
  /** Active brand preset id — lets a panel show which identity is selected. */
  readonly brandPresetId: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser = MOCK_USER,
  healthScoresVisible = true,
  taskBoardVisibleToAll = false,
  brandLogoKey = null,
  brandLogoDarkKey = null,
  productName = DEFAULT_PRODUCT_NAME,
  brandPresetId = DEFAULT_BRAND_PRESET_ID,
}: {
  readonly children: ReactNode;
  readonly initialUser?: AuthUser;
  readonly healthScoresVisible?: boolean;
  readonly taskBoardVisibleToAll?: boolean;
  readonly brandLogoKey?: string | null;
  readonly brandLogoDarkKey?: string | null;
  readonly productName?: string;
  readonly brandPresetId?: string;
}): React.JSX.Element {
  const value = useMemo<AuthContextValue>(() => {
    const user = initialUser;
    return {
      user,
      hasRole: (...roles: readonly Role[]): boolean => roles.includes(user.role),
      can: (permission: Permission): boolean => can(user.role, permission),
      canEdit: (): boolean => user.role === 'admin' || user.role === 'standard',
      healthScoresVisible,
      taskBoardVisibleToAll,
      brandLogoKey,
      brandLogoDarkKey,
      productName,
      brandPresetId,
    };
  }, [
    initialUser,
    healthScoresVisible,
    taskBoardVisibleToAll,
    brandLogoKey,
    brandLogoDarkKey,
    productName,
    brandPresetId,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}
