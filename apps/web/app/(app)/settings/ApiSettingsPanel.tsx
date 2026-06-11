'use client';

/**
 * API Settings panel (docs/05 API Settings, docs/08 §M12). Admin-only surface to
 * manage third-party integration keys at runtime — so a self-hosted/resold
 * instance sets its own keys with no code/env changes. Keys are write-only:
 * stored encrypted, never returned to the client; this UI shows status only.
 */
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { TYPE } from '@/lib/typography';

interface IntegrationStatus {
  readonly service: string;
  readonly label: string;
  readonly isSet: boolean;
  readonly lastTestedAt: string | null;
  readonly lastTestOk: boolean | null;
}

interface RowState {
  readonly secret: string;
  readonly busy: boolean;
  readonly message: string | null;
  readonly ok: boolean | null;
}

const EMPTY_ROW: RowState = { secret: '', busy: false, message: null, ok: null };

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `Request failed: ${res.status}`);
  }
  return body;
}

export function ApiSettingsPanel(): React.JSX.Element {
  const [items, setItems] = useState<readonly IntegrationStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const data = (await api('/api/settings/integrations')) as { integrations: IntegrationStatus[] };
      setItems(data.integrations);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load integrations.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rowFor = (service: string): RowState => rows[service] ?? EMPTY_ROW;
  const patchRow = (service: string, patch: Partial<RowState>): void => {
    setRows((prev) => ({ ...prev, [service]: { ...(prev[service] ?? EMPTY_ROW), ...patch } }));
  };

  async function save(service: string): Promise<void> {
    const secret = rowFor(service).secret.trim();
    if (secret === '') {
      patchRow(service, { message: 'Enter a key first.', ok: false });
      return;
    }
    patchRow(service, { busy: true, message: null });
    try {
      await api(`/api/settings/integrations/${service}`, {
        method: 'PUT',
        body: JSON.stringify({ secret }),
      });
      patchRow(service, { busy: false, secret: '', message: 'Saved.', ok: true });
      await load();
    } catch (error) {
      patchRow(service, {
        busy: false,
        message: error instanceof Error ? error.message : 'Save failed.',
        ok: false,
      });
    }
  }

  async function remove(service: string): Promise<void> {
    patchRow(service, { busy: true, message: null });
    try {
      await api(`/api/settings/integrations/${service}`, { method: 'DELETE' });
      patchRow(service, { busy: false, message: 'Removed (falls back to env var).', ok: true });
      await load();
    } catch (error) {
      patchRow(service, {
        busy: false,
        message: error instanceof Error ? error.message : 'Remove failed.',
        ok: false,
      });
    }
  }

  async function test(service: string): Promise<void> {
    patchRow(service, { busy: true, message: null });
    try {
      const result = (await api(`/api/settings/integrations/${service}/test`, {
        method: 'POST',
      })) as { ok: boolean; message: string };
      patchRow(service, { busy: false, message: result.message, ok: result.ok });
      await load();
    } catch (error) {
      patchRow(service, {
        busy: false,
        message: error instanceof Error ? error.message : 'Test failed.',
        ok: false,
      });
    }
  }

  if (loadError !== null) {
    return <ErrorState title="Could not load API settings" description={loadError} />;
  }
  if (items === null) {
    return <LoadingState label="Loading integrations…" />;
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const row = rowFor(item.service);
        return (
          <Card key={item.service}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span style={TYPE.bodyStrong}>{item.label}</span>
                  {item.isSet ? (
                    <Badge bg="#e7f6ec" fg="#166534">
                      Configured
                    </Badge>
                  ) : (
                    <Badge bg="var(--color-slate-100)" fg="var(--text-secondary)">
                      Not set
                    </Badge>
                  )}
                  {item.lastTestOk === true ? (
                    <Badge bg="#e7f6ec" fg="#166534">
                      Tested OK
                    </Badge>
                  ) : item.lastTestOk === false ? (
                    <Badge bg="#fdecea" fg="var(--color-red-500)">
                      Test failed
                    </Badge>
                  ) : null}
                </div>
                <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{item.service}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={item.isSet ? 'Enter a new key to replace' : 'Paste API key'}
                  value={row.secret}
                  disabled={row.busy}
                  onChange={(e) => {
                    patchRow(item.service, { secret: e.target.value });
                  }}
                  className="flex-1 rounded-lg border px-3 py-2"
                  style={{ borderColor: 'var(--border-subtle)', ...TYPE.body }}
                />
                <Button
                  variant="primary"
                  size="sm"
                  disabled={row.busy}
                  onClick={() => {
                    void save(item.service);
                  }}
                >
                  Save
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={row.busy || !item.isSet}
                  onClick={() => {
                    void test(item.service);
                  }}
                >
                  Test
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={row.busy || !item.isSet}
                  onClick={() => {
                    void remove(item.service);
                  }}
                >
                  Remove
                </Button>
              </div>

              {row.message !== null ? (
                <span
                  style={{
                    ...TYPE.secondary,
                    color: row.ok === false ? 'var(--color-red-500)' : 'var(--text-secondary)',
                  }}
                >
                  {row.message}
                </span>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
