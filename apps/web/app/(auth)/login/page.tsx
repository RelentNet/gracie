import { useSearchParams } from 'react-router';

import { TYPE } from '@/lib/typography';

/**
 * Login (Module 10, docs/08 §8). Centered card, product name, one sign-in button,
 * over the themed gradient ground (inherited from <body>, so it flips light/dark
 * like the rest of the app).
 *
 * The button starts the Logto sign-in; which methods appear (email + password,
 * Google, Microsoft…) is Logto's sign-in experience, not this page's. The name is
 * the tab title, which index.html sets from the last known brand before paint —
 * this page is outside the signed-in bootstrap, so it has no other source.
 */
export default function LoginPage(): React.JSX.Element {
  // Set by /sign-in and /callback when Logto fails (the cause is in the server log).
  const [params] = useSearchParams();
  const failed = params.get('error') === 'sign_in_failed';
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg bg-white p-8 shadow-xl">
        <span style={{ ...TYPE.sectionHeaderLg }}>{document.title}</span>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)', textAlign: 'center' }}>
          Sign in to continue.
        </p>
        {failed ? (
          <p
            role="alert"
            style={{ ...TYPE.secondary, color: 'var(--color-red-500)', textAlign: 'center' }}
          >
            Sign-in didn&rsquo;t complete. Try again — if it keeps failing, an admin can check the
            server log.
          </p>
        ) : null}
        {/* A plain <a>: /sign-in is a server route (redirects to Logto). */}
        <a
          href="/sign-in"
          className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5"
          style={{
            backgroundColor: 'var(--color-blue-500)',
            color: '#ffffff',
            fontSize: '0.9375rem',
            fontWeight: 600,
          }}
        >
          Sign in
        </a>
      </div>
    </main>
  );
}
