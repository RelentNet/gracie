'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles } from 'lucide-react';

import { CURRENT_RELEASE } from '@/lib/changelog';
import { TYPE } from '@/lib/typography';

/** localStorage key for the last release this browser has opened What's New for. */
const SEEN_KEY = 'ga_seen_version';

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(version: string): void {
  try {
    window.localStorage.setItem(SEEN_KEY, version);
  } catch {
    // Storage blocked (private mode etc.) — the dot just keeps showing.
  }
}

/**
 * Sidebar version link ("v0.4.0 · Alpha") → What's New. Shows a dot until this
 * browser has opened What's New for the current release, so staff notice when
 * something changed. Per-browser (localStorage) on purpose — a convenience, not a
 * record.
 */
export function VersionBadge({
  collapsed,
  className,
}: {
  readonly collapsed: boolean;
  readonly className?: string;
}): React.JSX.Element {
  const pathname = usePathname();
  const { version, stage } = CURRENT_RELEASE;
  // Start "seen" so SSR and first paint match; the effect reveals the dot if needed.
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    if (pathname === '/whats-new') {
      writeSeen(version);
      setUnseen(false);
    } else {
      setUnseen(readSeen() !== version);
    }
  }, [pathname, version]);

  const label = `v${version} · ${stage}`;
  return (
    <Link
      href="/whats-new"
      title={unseen ? `${label} — see what’s new` : label}
      aria-label={unseen ? `${label}, new updates` : `${label}, what’s new`}
      aria-current={pathname === '/whats-new' ? 'page' : undefined}
      className={`relative flex items-center gap-2 rounded-lg px-3 py-1 ${collapsed ? 'md:justify-center' : ''} ${className ?? ''}`}
      style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
    >
      <span className="relative shrink-0">
        <Sparkles aria-hidden="true" size={14} />
        {unseen ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 size-2 rounded-full"
            style={{ backgroundColor: 'var(--brand)' }}
          />
        ) : null}
      </span>
      <span className={collapsed ? 'md:hidden' : undefined}>{label}</span>
    </Link>
  );
}
