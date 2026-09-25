import { createContext, useContext } from 'react';

/**
 * What Next's `router.refresh()` did, for the SPA: `refresh()` re-fetches the app
 * bootstrap (user + firm-wide settings the nav reads) and bumps `version`. A page
 * whose data should reload on refresh lists `version` in its fetch effect's deps.
 * Client state is kept — nothing remounts.
 */
export interface RefreshValue {
  readonly refresh: () => void;
  readonly version: number;
}

export const RefreshContext = createContext<RefreshValue>({ refresh: () => {}, version: 0 });

export function useRefresh(): RefreshValue {
  return useContext(RefreshContext);
}
