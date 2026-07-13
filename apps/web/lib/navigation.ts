import {
  LayoutDashboard,
  Users,
  Contact,
  GitBranch,
  FolderOpen,
  ListTodo,
  Calendar,
  Sunrise,
  BookOpen,
  MessageSquare,
  Zap,
  Map,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Permission } from '@gracie/shared';

/**
 * Sidebar navigation (docs/08 §6). The 9 primary items in order. `requires` is
 * the D14 permission gating each item; when present, the item is HIDDEN (not
 * disabled) for roles lacking it — mirroring the server-side omission.
 */
export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly Icon: LucideIcon;
  /** Permission required to see this item; undefined = visible to all roles. */
  readonly requires?: Permission;
  /**
   * Open in a new tab via a plain anchor instead of client-side routing. Set for
   * targets that are not app-router pages (e.g. /roadmap is a raw-HTML route
   * handler) so `<Link>` prefetch/RSC navigation is bypassed.
   */
  readonly external?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Overview', href: '/dashboard', Icon: LayoutDashboard },
  { label: 'Clients', href: '/clients', Icon: Users },
  // Contacts & Org Charts (phase CO) — people, per-org office hierarchy, suggestions.
  { label: 'Contacts', href: '/contacts', Icon: Contact, requires: 'contacts.view' },
  { label: 'Pipeline', href: '/pipeline', Icon: GitBranch },
  { label: 'Documents', href: '/documents', Icon: FolderOpen },
  { label: 'Task Board', href: '/tasks', Icon: ListTodo },
  { label: 'Calendar', href: '/calendar', Icon: Calendar },
  { label: 'Daily Sync', href: '/daily-sync', Icon: Sunrise },
  { label: 'Knowledge Base', href: '/knowledge-base', Icon: BookOpen },
  // Assistant (Module 14) — general AI chat, all roles (docs/08 §M14).
  { label: 'Assistant', href: '/assistant', Icon: MessageSquare },
  // Automations (P8) — manage Gracie's recurring reports/tasks; all roles view,
  // editors manage. Created via the Assistant's propose→confirm flow.
  { label: 'Automations', href: '/automations', Icon: Zap, requires: 'automations.view' },
  // Roadmap — the self-contained build-roadmap document (raw-HTML route handler),
  // visible to all authenticated roles; opens in a new tab (external).
  { label: 'Roadmap', href: '/roadmap', Icon: Map, external: true },
  // Settings is Admin-only (docs/08 §6, D14): gated by settings.access.
  { label: 'Settings', href: '/settings', Icon: Settings, requires: 'settings.access' },
] as const;
