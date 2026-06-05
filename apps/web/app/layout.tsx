import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth';

import '@/styles/theme.css';

export const metadata: Metadata = {
  title: 'GA App',
  description: 'Grace & Associates — internal meeting-intelligence platform.',
};

export default function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
