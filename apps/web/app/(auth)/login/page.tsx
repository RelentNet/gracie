import Link from 'next/link';

import { TYPE } from '@/lib/typography';

/**
 * Login (Module 10, docs/08 §8). Centered card, GA wordmark, "Sign in with
 * Microsoft", dark navy gradient.
 *
 * Phase 1B: the button initiates the Logto → Microsoft Entra sign-in flow
 * (docs/07 §5). In Phase 1A it links into the app shell so the scaffold is
 * navigable without auth wired.
 */
export default function LoginPage(): React.JSX.Element {
  return (
    <main
      className="flex min-h-dvh items-center justify-center p-6"
      style={{
        background:
          'linear-gradient(160deg, var(--color-navy-900) 0%, var(--color-navy-800) 100%)',
      }}
    >
      <div
        className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg bg-white p-8 shadow-xl"
      >
        <span style={{ ...TYPE.sectionHeaderLg }}>GA App</span>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)', textAlign: 'center' }}>
          Grace &amp; Associates internal platform. Sign in with your Microsoft account to continue.
        </p>
        {/* Phase 1B: replace href with the Logto sign-in route. */}
        <Link
          href="/dashboard"
          className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5"
          style={{
            backgroundColor: 'var(--color-blue-500)',
            color: '#ffffff',
            fontSize: '0.9375rem',
            fontWeight: 600,
          }}
        >
          Sign in with Microsoft
        </Link>
      </div>
    </main>
  );
}
