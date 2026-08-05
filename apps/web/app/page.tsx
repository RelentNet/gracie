import { redirect } from 'next/navigation';

/**
 * Root entry. Redirects into the authenticated app shell landing (/home — the
 * assistant + command-center tiles). An unauthenticated visitor is bounced to
 * /login by the app-layout guard.
 */
export default function RootPage(): never {
  redirect('/home');
}
