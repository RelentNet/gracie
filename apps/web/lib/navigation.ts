import {
  LayoutDashboard,
  Users,
  GitBranch,
  FolderOpen,
  ListTodo,
  Calendar,
  Sunrise,
  BookOpen,
  MessageSquare,
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
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Overview', href: '/dashboard', Icon: LayoutDashboard },
  { label: 'Clients', href: '/clients', Icon: Users },
  { label: 'Pipeline', href: '/pipeline', Icon: GitBranch },
  { label: 'Documents', href: '/documents', Icon: FolderOpen },
  { label: 'Task Board', href: '/tasks', Icon: ListTodo },
  { label: 'Calendar', href: '/calendar', Icon: Calendar },
  { label: 'Daily Sync', href: '/daily-sync', Icon: Sunrise },
  { label: 'Knowledge Base', href: '/knowledge-base', Icon: BookOpen },
  // Assistant (Module 14) — general AI chat, all roles (docs/08 §M14).
  { label: 'Assistant', href: '/assistant', Icon: MessageSquare },
  // Settings is Admin-only (docs/08 §6, D14): gated by settings.access.
  { label: 'Settings', href: '/settings', Icon: Settings, requires: 'settings.access' },
] as const;
