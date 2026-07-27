'use client';

/**
 * Generation Prompts (Settings → Generation Prompts, PE). Admin-only. Edits the six
 * post-meeting document prompts Gracie uses to generate notes. Each textarea is
 * prefilled with the EFFECTIVE prompt (override if set, else the shared default);
 * "Reset to default" restores that doc's default text, and Save stores only the docs
 * that actually differ from their default.
 *
 * The Task Checklist prompt carries a warning: its JSON response shape must stay
 * intact or task extraction breaks. Editing is allowed (Reset is the escape hatch).
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';

interface GenerationPromptDoc {
  readonly type: string;
  readonly label: string;
  readonly order: number;
  readonly defaultPrompt: string;
  readonly effectivePrompt: string;
  readonly isOverridden: boolean;
  readonly requiresJsonShape: boolean;
}
interface DocsResponse {
  readonly docs: readonly GenerationPromptDoc[];
}

const inputClass = 'w-full rounded-lg border bg-white px-3 py-2';
const inputStyle = { borderColor: 'var(--border-subtle)', ...TYPE.body } as const;

export function GenerationPromptsPanel(): React.JSX.Element {
  const [docs, setDocs] = useState<GenerationPromptDoc[]>([]);
  // Editable text per doc type (keyed by type).
  const [text, setText] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);

  const hydrate = useCallback((list: readonly GenerationPromptDoc[]): void => {
    setDocs([...list]);
    setText(Object.fromEntries(list.map((d) => [d.type, d.effectivePrompt])));
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    apiClient
      .get<DocsResponse>('/api/settings/generation-prompts')
      .then((d) => {
        if (active) hydrate(d.docs);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(e instanceof Error ? e.message : 'Failed to load generation prompts');
      });
    return (): void => {
      active = false;
    };
  }, [hydrate]);

  const resetOne = (doc: GenerationPromptDoc): void => {
    setText((prev) => ({ ...prev, [doc.type]: doc.defaultPrompt }));
    setNote(null);
  };

  const save = useCallback((): void => {
    setSaving(true);
    setNote(null);
    // Send every doc's current text; the server drops blanks + defaults, so this
    // both applies edits and clears docs the user reset back to default.
    const overrides = Object.fromEntries(docs.map((d) => [d.type, text[d.type] ?? '']));
    apiClient
      .patch<DocsResponse>('/api/settings/generation-prompts', { overrides })
      .then((d) => {
        hydrate(d.docs);
        setNote({ text: 'Saved.', ok: true });
      })
      .catch((e: unknown) => setNote({ text: e instanceof Error ? e.message : 'Save failed.', ok: false }))
      .finally(() => setSaving(false));
  }, [docs, text, hydrate]);

  if (loadError !== null) return <ErrorState title="Couldn’t load generation prompts" description={loadError} />;
  if (!loaded) return <LoadingState label="Loading generation prompts…" />;

  return (
    <div className="flex flex-col gap-6">
      <p style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>
        These are the instructions Gracie follows to write each document after a meeting. Edit any of
        them to change tone or content — changes apply to the next meeting processed, no deploy needed.
      </p>

      {docs.map((doc) => {
        const current = text[doc.type] ?? '';
        const isDefault = current.trim() === doc.defaultPrompt.trim();
        return (
          <div key={doc.type} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span style={{ ...TYPE.bodyStrong }}>
                {doc.order}. {doc.label}
                {!isDefault ? (
                  <span style={{ ...TYPE.label, color: 'var(--text-secondary)', marginLeft: 8 }}>
                    (customized)
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={(): void => resetOne(doc)}
                disabled={saving || isDefault}
                aria-label={`Reset ${doc.label} to default`}
                className="inline-flex items-center gap-1"
                style={{
                  ...TYPE.label,
                  color: isDefault ? 'var(--text-secondary)' : 'var(--color-blue-700)',
                  opacity: isDefault ? 0.6 : 1,
                  cursor: saving || isDefault ? 'default' : 'pointer',
                }}
              >
                <RotateCcw size={12} aria-hidden="true" />
                Reset to default
              </button>
            </div>

            {doc.requiresJsonShape ? (
              <span
                className="inline-flex items-start gap-1.5 rounded-md px-2 py-1"
                style={{ ...TYPE.label, color: 'var(--color-amber-600)', backgroundColor: 'var(--color-amber-100)' }}
              >
                <AlertTriangle size={13} aria-hidden="true" style={{ marginTop: 1, flexShrink: 0 }} />
                Keep the exact JSON response shape — task extraction parses this output. If it breaks,
                use Reset to default.
              </span>
            ) : null}

            <textarea
              className={inputClass}
              style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
              value={current}
              maxLength={20000}
              disabled={saving}
              onChange={(e): void => setText((prev) => ({ ...prev, [doc.type]: e.target.value }))}
              aria-label={`${doc.label} prompt`}
            />
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {note !== null ? (
          <span
            role={note.ok ? undefined : 'alert'}
            style={{ ...TYPE.secondary, color: note.ok ? 'var(--text-secondary)' : 'var(--color-red-600)' }}
          >
            {note.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
