'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  CalendarX,
  CheckSquare,
  Clock,
  FileText,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { TYPE } from '@/lib/typography';
import { formatDateTime } from '@/lib/format';

/**
 * Notification bell + inbox dropdown (P7 §5). Lives in the app-shell top bar.
 * Fetches the CURRENT user's notifications from `/api/notifications` (caller-scoped
 * server-side), shows an unread badge, and on open marks everything read
 * (`PATCH /api/notifications/read { all: true }`) — items keep a "new" accent for
 * the current view. Clicking an item navigates to its link. Polls the unread count
 * every 60s. Loading / error / empty states are all handled.
 */

/** A notification as returned by the API (client-side view). */
interface NotificationView {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

interface NotificationsResponse {
  readonly notifications: NotificationView[];
  readonly unreadCount: number;
}

const POLL_MS = 60_000;

/** Per-type icon (falls back to the bell). */
const TYPE_ICON: Record<string, LucideIcon> = {
  pipeline_failed: AlertTriangle,
  needs_attention: AlertTriangle,
  calendar_disconnect: CalendarX,
  kb_expiring: Clock,
  documents_ready: FileText,
  task_assigned: CheckSquare,
  automation: Zap,
};

export function NotificationBell(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Ids that were unread at the moment the panel opened — kept accented for this view. */
  const newIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (): Promise<NotificationsResponse | null> => {
    const res = await fetch('/api/notifications', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load notifications (${res.status})`);
    return (await res.json()) as NotificationsResponse;
  }, []);

  // Poll the unread count while mounted (cheap: the same endpoint returns it).
  useEffect(() => {
    let active = true;
    const tick = async (): Promise<void> => {
      try {
        const data = await load();
        if (active && data !== null && !open) setUnreadCount(data.unreadCount);
      } catch {
        // Silent — the badge simply won't update this tick.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load, open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (containerRef.current !== null && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPanel = useCallback(async (): Promise<void> => {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const data = await load();
      if (data === null) return;
      setItems(data.notifications);
      newIdsRef.current = new Set(data.notifications.filter((n) => n.readAt === null).map((n) => n.id));
      // Mark-read on open: clear the badge; items keep their "new" accent for this view.
      if (data.unreadCount > 0) {
        setUnreadCount(0);
        await fetch('/api/notifications/read', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true }),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, [load]);

  const toggle = useCallback((): void => {
    if (open) setOpen(false);
    else void openPanel();
  }, [open, openPanel]);

  const onItemClick = useCallback(
    (item: NotificationView): void => {
      setOpen(false);
      if (item.link !== null && item.link !== '') router.push(item.link);
    },
    [router],
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex size-9 items-center justify-center rounded-lg transition-colors"
        style={{ color: 'var(--text-secondary)' }}
      >
        <Bell aria-hidden="true" size={20} />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1"
            style={{
              backgroundColor: 'var(--color-red-500)',
              color: '#ffffff',
              fontSize: '0.625rem',
              fontWeight: 700,
              height: '1rem',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 flex max-h-[28rem] w-80 flex-col overflow-hidden rounded-xl border bg-white shadow-lg"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <span style={{ ...TYPE.bodyStrong }}>Notifications</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6" style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                Loading…
              </p>
            ) : error !== null ? (
              <p role="alert" className="px-4 py-6" style={{ ...TYPE.secondary, color: 'var(--color-red-500)' }}>
                {error}
              </p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p style={{ ...TYPE.bodyStrong }}>You&rsquo;re all caught up</p>
                <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                  New alerts and updates will appear here.
                </p>
              </div>
            ) : (
              <ul>
                {items.map((item) => {
                  const Icon = TYPE_ICON[item.type] ?? Bell;
                  const isNew = newIdsRef.current.has(item.id);
                  const clickable = item.link !== null && item.link !== '';
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={(): void => onItemClick(item)}
                        disabled={!clickable}
                        className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors"
                        style={{
                          borderColor: 'var(--border-subtle)',
                          backgroundColor: isNew ? 'var(--color-blue-50, #eff6ff)' : 'transparent',
                          cursor: clickable ? 'pointer' : 'default',
                        }}
                      >
                        <Icon
                          aria-hidden="true"
                          size={16}
                          style={{ marginTop: '0.15rem', color: 'var(--text-secondary)', flexShrink: 0 }}
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span style={{ ...TYPE.bodyStrong }} className="truncate">
                            {item.title}
                          </span>
                          {item.body !== null ? (
                            <span
                              className="line-clamp-2"
                              style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
                            >
                              {item.body}
                            </span>
                          ) : null}
                          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                            {formatDateTime(item.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
