import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth';
import { getBrandLogoKey } from '@/lib/data/branding-settings';
import { getHealthScoresVisible } from '@/lib/data/scoring-settings';
import { getCurrentUser } from '@/lib/server-auth';

import '@/styles/theme.css';

export const metadata: Metadata = {
  title: 'GA App',
  description: 'Grace & Associates — internal meeting-intelligence platform.',
};

// Correct mobile scaling — required for the responsive shell to size to the
// device viewport rather than a desktop-width fallback.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/*
 * No-flash theme init. Runs synchronously in <head> before first paint: applies
 * the saved theme (localStorage) or the OS preference so `data-theme` is already
 * on <html> when the CSS resolves — no light→dark flip on load. The in-app toggle
 * (next to the notification bell) owns the value afterwards.
 */
const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}d.setAttribute('data-theme',t);}catch(e){}})();`;

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<React.JSX.Element> {
  // A settings-read blip must never 500 the whole app — fail OPEN to visible (the
  // current behavior), matching the missing-value default. A logo-read blip falls
  // back to null → the nav's default text treatment.
  const [user, healthScoresVisible, brandLogoKey] = await Promise.all([
    getCurrentUser(),
    getHealthScoresVisible().catch(() => true),
    getBrandLogoKey().catch(() => null),
  ]);
  return (
    // `suppressHydrationWarning`: the init script sets `data-theme` on <html>
    // before React hydrates, so the server/client attribute differs by design.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      {/* `overflow-x-hidden` is the global guard against horizontal body scroll;
          `min-w-0` lets flex descendants shrink so wide content scrolls inside its
          own container rather than pushing the shell wider. */}
      <body className="min-w-0 overflow-x-hidden">
        <AuthProvider
          initialUser={user}
          healthScoresVisible={healthScoresVisible}
          brandLogoKey={brandLogoKey}
        >
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
