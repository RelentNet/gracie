'use client';

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
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
 * Top-bar version link ("v0.4.2 · Alpha", beside the theme toggle and
 * notifications) → What's New. Shows a dot until this
 * browser has opened What's New for the current release, so staff notice when
 * something changed. Per-browser (localStorage) on purpose — a convenience, not a
 * record.
 */
export function VersionBadge(): React.JSX.Element {
  const { pathname } = useLocation();
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
      to="/whats-new"
      title={unseen ? `${label} — see what’s new` : label}
      aria-label={unseen ? `${label}, new updates` : `${label}, what’s new`}
      aria-current={pathname === '/whats-new' ? 'page' : undefined}
      className="flex h-9 items-center gap-1.5 rounded-lg px-2 transition-colors"
      style={{ ...TYPE.secondary, color: 'var(--text-secondary)', fontWeight: 500 }}
    >
      <span className="relative shrink-0">
        <Sparkles aria-hidden="true" size={18} />
        {unseen ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 size-2 rounded-full"
            style={{ backgroundColor: 'var(--brand)' }}
          />
        ) : null}
      </span>
      {/* Version always visible; the stage label drops on narrow screens. */}
      <span className="whitespace-nowrap">
        v{version}
        <span className="hidden sm:inline"> · {stage}</span>
      </span>
    </Link>
  );
}
