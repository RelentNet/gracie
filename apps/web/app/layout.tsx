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
    <html lang="en">
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
