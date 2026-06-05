import { redirect } from 'next/navigation';

/**
 * Root entry. Phase 1A: redirect into the authenticated app shell. Phase 1B:
 * an unauthenticated visitor will be redirected to /login by Logto middleware
 * instead.
 */
export default function RootPage(): never {
  redirect('/dashboard');
}
