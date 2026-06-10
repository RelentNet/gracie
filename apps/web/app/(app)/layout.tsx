import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getLogtoContext } from '@logto/next/server-actions';

import { Sidebar } from '@/components/Sidebar';
import { isLogtoConfigured, logtoConfig } from '@/lib/logto';

/**
 * Authenticated app shell (docs/03 §3). Sidebar + main content region. Role
 * filtering for nav lives in the Sidebar; the same role data gates page-level
 * content. When Logto is configured, unauthenticated visitors are redirected to
 * /login here (server-side guard). Until then the scaffold renders the mock user.
 */
export default async function AppLayout({
  children,
}: {
  readonly children: ReactNode;
}): Promise<React.JSX.Element> {
  if (isLogtoConfigured()) {
    const { isAuthenticated } = await getLogtoContext(logtoConfig);
    if (!isAuthenticated) redirect('/login');
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
