import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth';
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
  const user = await getCurrentUser();
  return (
    <html lang="en">
      {/* `overflow-x-hidden` is the global guard against horizontal body scroll;
          `min-w-0` lets flex descendants shrink so wide content scrolls inside its
          own container rather than pushing the shell wider. */}
      <body className="min-w-0 overflow-x-hidden">
        <AuthProvider initialUser={user}>{children}</AuthProvider>
      </body>
    </html>
  );
}
