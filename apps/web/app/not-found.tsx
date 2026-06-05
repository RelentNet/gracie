import Link from 'next/link';

import { TYPE } from '@/lib/typography';

export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
      <h1 style={TYPE.pageTitle}>Page not found</h1>
      <p style={{ ...TYPE.body, color: 'var(--text-secondary)' }}>
        The page you are looking for does not exist or has moved.
      </p>
      <Link
        href="/dashboard"
        className="rounded-lg px-4 py-2"
        style={{
          backgroundColor: 'var(--color-blue-500)',
          color: '#ffffff',
          fontSize: '0.875rem',
          fontWeight: 600,
        }}
      >
        Back to Overview
      </Link>
    </main>
  );
}
