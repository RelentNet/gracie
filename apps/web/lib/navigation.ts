import {
  LayoutDashboard,
  Calendar,
  MessageSquare,
  ListTodo,
  FolderOpen,
  BookOpen,
  Users,
  Contact,
  Zap,
  GitBranch,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Permission } from '@gracie/shared';

/**
 * Sidebar navigation (docs/08 §6). The 11 primary items in order. `requires` is
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
   * targets that are not app-router pages (e.g. raw-HTML route handlers) so
   * `<Link>` prefetch/RSC navigation is bypassed.
   */
  readonly external?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Overview', href: '/dashboard', Icon: LayoutDashboard },
  { label: 'Calendar', href: '/calendar', Icon: Calendar },
  // Assistant (Module 14) — general AI chat, all roles (docs/08 §M14).
  { label: 'Assistant', href: '/assistant', Icon: MessageSquare },
  { label: 'Task Board', href: '/tasks', Icon: ListTodo },
  { label: 'Documents', href: '/documents', Icon: FolderOpen },
  { label: 'Knowledge Base', href: '/knowledge-base', Icon: BookOpen },
  { label: 'Clients', href: '/clients', Icon: Users },
  // Contacts & Org Charts (phase CO) — people, per-org office hierarchy, suggestions.
  { label: 'Contacts', href: '/contacts', Icon: Contact, requires: 'contacts.view' },
  // Automations (P8) — manage Gracie's recurring reports/tasks; all roles view,
  // editors manage. Created via the Assistant's propose→confirm flow.
  { label: 'Automations', href: '/automations', Icon: Zap, requires: 'automations.view' },
  { label: 'Pipeline', href: '/pipeline', Icon: GitBranch },
  // Settings is Admin-only (docs/08 §6, D14): gated by settings.access. The build
  // roadmap now lives as an admin-only tab inside Settings (not the sidebar).
  { label: 'Settings', href: '/settings', Icon: Settings, requires: 'settings.access' },
] as const;
