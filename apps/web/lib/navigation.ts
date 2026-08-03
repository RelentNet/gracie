import {
  LayoutDashboard,
  Calendar,
  MessageSquare,
  ListTodo,
  FolderOpen,
  BookOpen,
  Users,
  Contact,
  Sunrise,
  Zap,
  GitBranch,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Permission } from '@gracie/shared';

/**
 * Sidebar navigation (docs/08 §6). `requires` is the D14 permission gating each
 * item; when present, the item is HIDDEN (not disabled) for roles lacking it —
 * mirroring the server-side omission.
 */
export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly Icon: LucideIcon;
  /** Permission required to see this item; undefined = visible to all roles. */
  readonly requires?: Permission;
  /**
   * Open in a new tab via a plain anchor instead of client-side routing. Set for
   * targets that are not app-router pages (e.g. raw-HTML route handlers) so
   * `<Link>` prefetch/RSC navigation is bypassed.
   */
  readonly external?: boolean;
}

/**
 * A labeled cluster of nav items. `header` (small-caps section label) is omitted
 * for the unlabeled top and bottom groups, which render as plain item clusters.
 * Groups are separated by a thin rule; a header is hidden when every item in its
 * group is gated away for the current role (see {@link Sidebar}).
 */
export interface NavGroup {
  readonly header?: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    items: [
      { label: 'Overview', href: '/dashboard', Icon: LayoutDashboard },
      // Assistant (Module 14) — general AI chat, all roles (docs/08 §M14).
      { label: 'Assistant', href: '/assistant', Icon: MessageSquare },
    ],
  },
  {
    header: 'Clients',
    items: [
      { label: 'Clients', href: '/clients', Icon: Users },
      // Contacts & Org Charts (phase CO) — people, per-org office hierarchy, suggestions.
      { label: 'Contacts', href: '/contacts', Icon: Contact, requires: 'contacts.view' },
    ],
  },
  {
    header: 'Planning',
    items: [
      { label: 'Calendar', href: '/calendar', Icon: Calendar },
      { label: 'Daily Sync', href: '/daily-sync', Icon: Sunrise },
      { label: 'Task Board', href: '/tasks', Icon: ListTodo },
    ],
  },
  {
    header: 'Library',
    items: [
      { label: 'Documents', href: '/documents', Icon: FolderOpen },
      { label: 'Knowledge Base', href: '/knowledge-base', Icon: BookOpen },
    ],
  },
  {
    items: [
      // Automations (P8) — manage Gracie's recurring reports/tasks; all roles view,
      // editors manage. Created via the Assistant's propose→confirm flow.
      { label: 'Automations', href: '/automations', Icon: Zap, requires: 'automations.view' },
      // Pipeline is admin-only at the route level, but the link stays visible to
      // all roles by request (no `requires` gate).
      { label: 'Pipeline', href: '/pipeline', Icon: GitBranch },
      // Settings is Admin-only (docs/08 §6, D14): gated by settings.access. The build
      // roadmap now lives as an admin-only tab inside Settings (not the sidebar).
      { label: 'Settings', href: '/settings', Icon: Settings, requires: 'settings.access' },
    ],
  },
] as const;
