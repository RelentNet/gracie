import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthProvider } from '@/lib/auth';
import { getCurrentUser } from '@/lib/server-auth';

import '@/styles/theme.css';

export const metadata: Metadata = {
  title: 'GA App',
  description: 'Grace & Associates — internal meeting-intelligence platform.',
};

export default async function RootLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<React.JSX.Element> {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        <AuthProvider initialUser={user}>{children}</AuthProvider>
      </body>
    </html>
  );
}
