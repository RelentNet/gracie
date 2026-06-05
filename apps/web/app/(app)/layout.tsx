import type { ReactNode } from 'react';

import { Sidebar } from '@/components/Sidebar';

/**
 * Authenticated app shell (docs/03 §3). Sidebar + main content region. Role
 * filtering for nav lives in the Sidebar; the same role data gates page-level
 * content. Phase 1B: a server-side auth guard wraps this layout to redirect
 * unauthenticated users to /login.
 */
export default function AppLayout({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
