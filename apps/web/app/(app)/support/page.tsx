'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { FormError, TextAreaField } from '@/components/ui/Field';
import { PageContainer } from '@/components/ui/PageContainer';
import { EmptyState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { CURRENT_RELEASE } from '@/lib/changelog';
import { formatDateTime } from '@/lib/format';
import {
  browserName,
  describeScreen,
  SUPPORT_CATEGORIES,
  SUPPORT_MESSAGE_MAX,
  supportCategoryLabel,
  type SupportCategory,
  type SupportRequestView,
} from '@/lib/support';
import { TYPE } from '@/lib/typography';

/** Context captured from the browser at submit time (shown to the user first). */
interface Context {
  readonly pageUrl: string;
  readonly appVersion: string;
  readonly browser: string;
  readonly screen: string;
}

function captureContext(fromPath: string | null): Context {
  return {
    pageUrl: fromPath ?? '(not recorded)',
    appVersion: `v${CURRENT_RELEASE.version}`,
    browser: `${browserName(navigator.userAgent)} — ${navigator.userAgent}`,
    screen: describeScreen({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    }),
  };
}

/**
 * Support — any signed-in user can tell the team something's wrong, that Gracie
 * couldn't do something, or share an idea. Works in every browser (BugHerd needs a
 * Chrome/Edge extension). The page they came from, the Gracie version, browser and
 * screen/zoom are attached automatically; admins work requests in Settings → Support.
 */
export default function SupportPage(): React.JSX.Element {
  // Read `?from=` after mount (no useSearchParams → no Suspense requirement at build).
  const [fromPath, setFromPath] = useState<string | null>(null);
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from');
    setFromPath(from !== null && from.startsWith('/') && !from.startsWith('//') ? from : null);
  }, []);

  const [category, setCategory] = useState<SupportCategory>('problem');
  const [message, setMessage] = useState('');
  const [context, setContext] = useState<Context | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<readonly SupportRequestView[] | null>(null);

  useEffect(() => setContext(captureContext(fromPath)), [fromPath]);

  const loadMine = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ requests: SupportRequestView[] }>('/api/support');
      setMine(res.requests);
    } catch {
      setMine([]);
    }
  }, []);
  useEffect(() => void loadMine(), [loadMine]);

  const submit = async (): Promise<void> => {
    if (message.trim() === '' || context === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/api/support', { category, message, ...context });
      setSent(true);
      setMessage('');
      void loadMine();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer width="md" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 style={TYPE.pageTitle}>Support</h1>
        <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
          Something not working, or Gracie couldn’t do what you asked? Tell us here — the team sees it right away.
        </p>
      </header>

      <Card className="flex flex-col gap-4 p-6">
        {sent ? (
          <div className="flex flex-col items-start gap-3" role="status">
            <div className="flex items-center gap-2" style={{ color: 'var(--color-emerald-500)' }}>
              <CheckCircle2 aria-hidden="true" size={20} />
              <span style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>Thanks — we’ve got it.</span>
            </div>
            <p style={{ ...TYPE.body, color: 'var(--text-secondary)' }}>
              The team has been notified. You can track it under “Your requests” below.
            </p>
            <Button variant="secondary" onClick={(): void => setSent(false)}>
              Send another
            </Button>
          </div>
        ) : (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1" style={{ ...TYPE.bodyStrong, color: 'var(--text-primary)' }}>
                What kind of help do you need?
              </legend>
              {SUPPORT_CATEGORIES.map((c) => (
                <label key={c.value} className="flex cursor-pointer items-center gap-2" style={TYPE.body}>
                  <input
                    type="radio"
                    name="support-category"
                    value={c.value}
                    checked={category === c.value}
                    onChange={(): void => setCategory(c.value)}
                  />
                  {c.label}
                </label>
              ))}
            </fieldset>

            <TextAreaField
              id="support-message"
              label="What happened?"
              value={message}
              onChange={(v): void => setMessage(v.slice(0, SUPPORT_MESSAGE_MAX))}
              rows={6}
              placeholder="e.g. I clicked Upload on the IBM folder and nothing happened."
            />

            {context !== null ? (
              <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
                We’ll also include: page <strong>{context.pageUrl}</strong> · Gracie {context.appVersion} ·{' '}
                {context.browser.split(' — ')[0]} · {context.screen}
              </p>
            ) : null}

            <FormError message={error} />
            <div className="flex justify-end">
              <Button onClick={(): void => void submit()} disabled={submitting || message.trim() === ''}>
                {submitting ? 'Sending…' : 'Send to the team'}
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-6">
        <CardHeader title="Your requests" />
        {mine === null ? (
          <LoadingState />
        ) : mine.length === 0 ? (
          <EmptyState title="Nothing yet" description="Requests you send will show up here with their status." />
        ) : (
          <ul className="flex flex-col gap-3">
            {mine.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 border-b pb-3 last:border-b-0" style={{ borderColor: 'var(--hair)' }}>
                <div className="flex flex-wrap items-center gap-2" style={TYPE.secondary}>
                  <span
                    className="rounded-md px-1.5"
                    style={{
                      backgroundColor: r.status === 'done' ? 'var(--color-emerald-500)' : 'var(--brand-soft)',
                      color: r.status === 'done' ? '#ffffff' : 'var(--text-primary)',
                      fontWeight: 600,
                    }}
                  >
                    {r.status === 'done' ? 'Resolved' : 'Open'}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {supportCategoryLabel(r.category)} · {formatDateTime(r.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap" style={{ ...TYPE.body, color: 'var(--text-primary)' }}>
                  {r.message}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageContainer>
  );
}
