'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Light/dark theme toggle — lives in the app-shell top bar next to the
 * notification bell. The saved choice is applied before first paint by the inline
 * script in the root layout (no flash); this button just flips + persists it.
 *
 * Persisted to `localStorage.theme`; the value drives `data-theme` on <html>,
 * which the token layer (styles/theme.css) reads to override the OS preference in
 * both directions.
 */
type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeToggle(): React.JSX.Element {
  // `mounted` gates icon rendering to after hydration — the theme is only known
  // client-side, so rendering a fixed icon on the server would mismatch.
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(currentTheme());
    setMounted(true);
  }, []);

  const toggle = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private mode / storage disabled — the toggle still applies for this view.
    }
    setTheme(next);
  };

  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={isDark}
      title="Toggle light / dark theme"
      className="relative flex size-9 items-center justify-center rounded-lg transition-colors"
      style={{ color: 'var(--text-secondary)' }}
    >
      {mounted ? (
        isDark ? (
          <Moon aria-hidden="true" size={20} />
        ) : (
          <Sun aria-hidden="true" size={20} />
        )
      ) : (
        // Neutral placeholder pre-hydration — no icon flip, no layout shift.
        <span aria-hidden="true" style={{ width: 20, height: 20 }} />
      )}
    </button>
  );
}
