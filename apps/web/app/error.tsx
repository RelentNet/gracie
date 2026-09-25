'use client';

import { useEffect } from 'react';
import { useRouteError } from 'react-router';

import { ErrorState } from '@/components/ui/StateViews';

/**
 * Root error boundary (the router's errorElement). Catches render/runtime errors and
 * offers a recovery action. Logs with context for debugging (global standard).
 */
export default function RootError(): React.JSX.Element {
  const error = useRouteError();
  useEffect(() => {
    console.error('Unhandled UI error:', error);
  }, [error]);

  return (
    <div className="p-8">
      <ErrorState
        title="Something went wrong"
        description="An unexpected error occurred while rendering this view. You can try again."
        action={
          <button
            type="button"
            onClick={(): void => window.location.reload()}
            className="rounded-lg px-4 py-2"
            style={{
              backgroundColor: 'var(--color-blue-500)',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        }
      />
    </div>
  );
}
