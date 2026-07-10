'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Calendar, Check, Mail, Sparkles, X } from 'lucide-react';
import type { Client, ContactSuggestionView } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { ClientAvatar } from '@/components/ClientAvatar';

import { contactInitials } from './shared';
import { AcceptSuggestionModal } from './AcceptSuggestionModal';

/**
 * Suggestions inbox tab (phase `CO`, docs/plan/contacts-org-charts.md §5).
 *
 * An editor-only triage queue of people who showed up as meeting attendees (and, later,
 * a web scan) but aren't Contacts yet. Each row can be Accepted — turning it into a real
 * contact via {@link AcceptSuggestionModal} — or Dismissed so it never resurfaces. Both
 * actions optimistically drop the row from the local list on success.
 */
interface SuggestionsResponse {
  readonly suggestions: readonly ContactSuggestionView[];
}

interface RowError {
  readonly id: string;
  readonly message: string;
}

export function SuggestionsTab({
  orgs,
  canEdit,
}: {
  readonly orgs: readonly Client[];
  readonly canEdit: boolean;
}): React.JSX.Element {
  const [suggestions, setSuggestions] = useState<readonly ContactSuggestionView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  /** Id of the suggestion whose Dismiss is in flight (disables that row's controls). */
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError | null>(null);
  /** The suggestion whose Accept modal is open, or null. */
  const [accepting, setAccepting] = useState<ContactSuggestionView | null>(null);

  useEffect(() => {
    let active = true;
    setSuggestions(null);
    setLoadError(null);
    apiClient
      .get<SuggestionsResponse>('/api/contact-suggestions')
      .then((d) => {
        if (active) setSuggestions(d.suggestions);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load suggestions');
      });
    return (): void => {
      active = false;
    };
  }, [reloadKey]);

  const removeSuggestion = useCallback((id: string): void => {
    setSuggestions((prev) => (prev === null ? prev : prev.filter((s) => s.id !== id)));
  }, []);

  const dismiss = useCallback(
    (id: string): void => {
      setDismissingId(id);
      setRowError(null);
      apiClient
        .post<{ ok: true }>(`/api/contact-suggestions/${id}/dismiss`)
        .then(() => removeSuggestion(id))
        .catch((e: unknown) =>
          setRowError({ id, message: e instanceof Error ? e.message : 'Failed to dismiss' }),
        )
        .finally(() => setDismissingId(null));
    },
    [removeSuggestion],
  );

  if (loadError !== null) {
    return (
      <ErrorState
        title="Couldn’t load suggestions"
        description={loadError}
        action={
          <Button variant="secondary" onClick={(): void => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
        }
      />
    );
  }

  if (suggestions === null) {
    return <LoadingState label="Loading suggestions…" />;
  }

  if (suggestions.length === 0) {
    return (
      <EmptyState
        title="No pending suggestions"
        description="People pulled from your meeting attendees (and, later, an automated web scan) show up here for you to add as contacts. There’s nothing waiting right now."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-2">
        <Sparkles size={16} aria-hidden="true" style={{ color: 'var(--color-blue-500)', marginTop: 2 }} />
        <div className="flex flex-col gap-1">
          <h2 style={TYPE.sectionHeader}>Suggested contacts</h2>
          <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
            People from your meeting attendees who aren’t in Contacts yet. Accept to add them (and
            optionally affiliate them to an org), or dismiss the ones you don’t need.
          </p>
        </div>
      </header>

      <ul className="flex flex-col gap-3">
        {suggestions.map((s) => {
          const name = s.suggestedName ?? s.suggestedEmail ?? 'Unknown person';
          const busy = dismissingId === s.id;
          const err = rowError !== null && rowError.id === s.id ? rowError.message : null;
          return (
            <li key={s.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <ClientAvatar initials={contactInitials(name)} size="md" />
                    <div className="flex min-w-0 flex-col gap-1">
                      <span style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>{name}</span>

                      {s.suggestedEmail !== null ? (
                        <span
                          className="inline-flex items-center gap-1.5 font-data"
                          style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
                        >
                          <Mail size={14} aria-hidden="true" />
                          {s.suggestedEmail}
                        </span>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2">
                        {s.orgName !== null ? (
                          <Badge
                            bg="var(--color-blue-100)"
                            fg="var(--color-blue-700)"
                            icon={<Building2 size={14} aria-hidden="true" />}
                          >
                            {s.orgName}
                          </Badge>
                        ) : (
                          <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                            {s.suggestedDomain !== null ? `${s.suggestedDomain} · ` : ''}no org yet
                          </span>
                        )}
                      </div>

                      {s.meetingTitle !== null ? (
                        <span
                          className="inline-flex items-center gap-1.5"
                          style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}
                        >
                          <Calendar size={14} aria-hidden="true" />
                          from: {s.meetingTitle}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Check size={14} aria-hidden="true" />}
                        onClick={(): void => setAccepting(s)}
                        disabled={busy}
                        style={{
                          backgroundColor: 'var(--color-emerald-500)',
                          borderColor: 'var(--color-emerald-500)',
                        }}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<X size={14} aria-hidden="true" />}
                        onClick={(): void => dismiss(s.id)}
                        disabled={busy}
                        aria-label={`Dismiss ${name}`}
                        style={{ color: 'var(--color-red-600)' }}
                      >
                        {busy ? 'Dismissing…' : 'Dismiss'}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {err !== null ? (
                  <p
                    role="alert"
                    className="mt-2"
                    style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}
                  >
                    {err}
                  </p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>

      {accepting !== null ? (
        <AcceptSuggestionModal
          isOpen
          onClose={(): void => setAccepting(null)}
          suggestion={accepting}
          orgs={orgs}
          onAccepted={(): void => removeSuggestion(accepting.id)}
        />
      ) : null}
    </div>
  );
}
