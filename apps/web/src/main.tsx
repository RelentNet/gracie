/**
 * The app entry. Pages still live under `app/` in their old folders; the route table
 * below maps URLs to them (it was implicit in Next's file-system routing).
 */
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useNavigate } from 'react-router';

import AppLayout from '@/app/(app)/layout';
import AssistantPage from '@/app/(app)/assistant/page';
import AutomationsPage from '@/app/(app)/automations/page';
import CalendarPage from '@/app/(app)/calendar/page';
import ClientDocumentsPage from '@/app/(app)/clients/[clientId]/documents/page';
import ClientFinancePage from '@/app/(app)/clients/[clientId]/finance/page';
import ClientIntelligencePage from '@/app/(app)/clients/[clientId]/intelligence/page';
import ClientDetailLayout from '@/app/(app)/clients/[clientId]/layout';
import ClientMeetingsPage from '@/app/(app)/clients/[clientId]/meetings/page';
import ClientNotesPage from '@/app/(app)/clients/[clientId]/notes/page';
import ClientOperationsPage from '@/app/(app)/clients/[clientId]/operations/page';
import ClientOverviewPage from '@/app/(app)/clients/[clientId]/overview/page';
import ClientStrategyPage from '@/app/(app)/clients/[clientId]/strategy/page';
import ClientsPage from '@/app/(app)/clients/page';
import ContactsPage from '@/app/(app)/contacts/page';
import DailySyncPage from '@/app/(app)/daily-sync/page';
import DashboardPage from '@/app/(app)/dashboard/page';
import DocumentsPage from '@/app/(app)/documents/page';
import HomePage from '@/app/(app)/home/page';
import KnowledgeBasePage from '@/app/(app)/knowledge-base/page';
import MeetingOccurrencePage from '@/app/(app)/meetings/[id]/page';
import MySettingsPage from '@/app/(app)/my-settings/page';
import PipelinePage from '@/app/(app)/pipeline/page';
import SettingsPage from '@/app/(app)/settings/page';
import SupportPage from '@/app/(app)/support/page';
import TasksPage from '@/app/(app)/tasks/page';
import UploadPage from '@/app/(app)/upload/page';
import WhatsNewPage from '@/app/(app)/whats-new/page';
import LoginPage from '@/app/(auth)/login/page';
import RootError from '@/app/error';
import RootLoading from '@/app/loading';
import NotFound from '@/app/not-found';
import { PostHogProvider } from '@/components/analytics/PostHogProvider';
import { AuthProvider, type AuthUser } from '@/lib/auth';
import { RefreshContext } from '@/lib/refresh';

import '@/styles/theme.css';

/** GET /api/bootstrap — what the Next root layout used to resolve on every page load. */
interface Bootstrap {
  readonly user: AuthUser;
  readonly healthScoresVisible: boolean;
  readonly taskBoardVisibleToAll: boolean;
  readonly brandLogoKey: string | null;
  readonly brandLogoDarkKey: string | null;
}

/**
 * Loads the bootstrap, then renders the signed-in app. A 401 (Logto configured, no
 * valid session) goes to /login — the old app-shell guard. Nothing under here
 * renders before the server has said who the user is.
 */
function SignedInRoot(): React.JSX.Element {
  const navigate = useNavigate();
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/bootstrap');
      if (res.status === 401) {
        void navigate('/login', { replace: true });
        return;
      }
      if (!res.ok) throw new Error(`bootstrap: ${res.status}`);
      setBoot((await res.json()) as Bootstrap);
    } catch (error) {
      console.error('Could not load the app bootstrap:', error);
      setFailed(true);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback((): void => {
    void load();
    setVersion((v) => v + 1);
  }, [load]);
  const refreshValue = useMemo(() => ({ refresh, version }), [refresh, version]);

  if (boot === null) {
    if (failed) throw new Error('The app could not start: the server did not respond.');
    return <RootLoading />;
  }
  const { user } = boot;
  return (
    // Product analytics: no-ops outside a production build with NEXT_PUBLIC_POSTHOG_KEY.
    <PostHogProvider user={{ id: user.id, email: user.email, name: user.name, role: user.role }}>
      <AuthProvider
        initialUser={user}
        healthScoresVisible={boot.healthScoresVisible}
        taskBoardVisibleToAll={boot.taskBoardVisibleToAll}
        brandLogoKey={boot.brandLogoKey}
        brandLogoDarkKey={boot.brandLogoDarkKey}
      >
        <RefreshContext.Provider value={refreshValue}>
          <Outlet />
        </RefreshContext.Provider>
      </AuthProvider>
    </PostHogProvider>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RootError /> },
  {
    element: <SignedInRoot />,
    errorElement: <RootError />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      {
        element: <AppLayout />,
        children: [
          { path: 'home', element: <HomePage /> },
          { path: 'assistant', element: <AssistantPage /> },
          { path: 'automations', element: <AutomationsPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          { path: 'clients', element: <ClientsPage /> },
          {
            path: 'clients/:clientId',
            element: <ClientDetailLayout />,
            children: [
              { index: true, element: <Navigate to="overview" replace /> },
              { path: 'overview', element: <ClientOverviewPage /> },
              { path: 'operations', element: <ClientOperationsPage /> },
              { path: 'strategy', element: <ClientStrategyPage /> },
              { path: 'finance', element: <ClientFinancePage /> },
              { path: 'meetings', element: <ClientMeetingsPage /> },
              { path: 'notes', element: <ClientNotesPage /> },
              { path: 'documents', element: <ClientDocumentsPage /> },
              { path: 'intelligence', element: <ClientIntelligencePage /> },
            ],
          },
          { path: 'contacts', element: <ContactsPage /> },
          { path: 'daily-sync', element: <DailySyncPage /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'documents', element: <DocumentsPage /> },
          { path: 'knowledge-base', element: <KnowledgeBasePage /> },
          { path: 'meetings/:id', element: <MeetingOccurrencePage /> },
          { path: 'my-settings', element: <MySettingsPage /> },
          { path: 'pipeline', element: <PipelinePage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'support', element: <SupportPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'upload', element: <UploadPage /> },
          { path: 'whats-new', element: <WhatsNewPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
