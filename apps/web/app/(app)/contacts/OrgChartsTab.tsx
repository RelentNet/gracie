'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import type { Client, OfficeWithHolder, OrgChart } from '@gracie/shared';

import { apiClient } from '@/lib/api-client';
import { TYPE } from '@/lib/typography';
import { ClientAvatar } from '@/components/ClientAvatar';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';

import { OrgTypeBadge } from './shared';
import { OrgChartTree } from './OrgChartTree';
import { OfficeFormModal } from './OfficeFormModal';
import { SetHolderModal } from './SetHolderModal';

/**
 * Org Charts tab (phase `CO`, docs/plan/contacts-org-charts.md §5).
 *
 * Pick an org from the shared roster, then fetch and render its reports-to office
 * tree (`GET /api/clients/:id/org-chart`). Each node shows its current holder or a
 * VACANT affordance; a vacant KEY office is amber-flagged — the whole point of the
 * feature ("we're missing the VA CIO"). Editors get add/edit/delete office plus
 * fill/vacate holder actions (all delegated to {@link OrgChartTree} and the two
 * modals here); viewers see a read-only chart. Any mutation bumps `reloadKey`, which
 * re-fetches the chart so counts and the tree stay in sync.
 */
export function OrgChartsTab({
  orgs,
  canEdit,
}: {
  readonly orgs: readonly Client[];
  readonly canEdit: boolean;
}): React.JSX.Element {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [chart, setChart] = useState<OrgChart | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Per-office busy id (disables that node's actions during a delete/vacate).
  const [busyOfficeId, setBusyOfficeId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Office create/edit modal state.
  const [officeModalOpen, setOfficeModalOpen] = useState(false);
  const [officeEditing, setOfficeEditing] = useState<OfficeWithHolder | null>(null);
  const [officeParentId, setOfficeParentId] = useState<string | null>(null);

  // Set-holder modal state.
  const [holderModalOpen, setHolderModalOpen] = useState(false);
  const [holderOffice, setHolderOffice] = useState<OfficeWithHolder | null>(null);

  const reload = useCallback((): void => setReloadKey((k) => k + 1), []);

  // Default the picker to the first org (and keep it valid as `orgs` loads/changes).
  useEffect(() => {
    const first = orgs[0];
    if (first === undefined) return;
    setSelectedOrgId((prev) =>
      prev !== null && orgs.some((o) => o.id === prev) ? prev : first.id,
    );
  }, [orgs]);

  // Fetch the selected org's chart (re-runs on org change and after any mutation).
  useEffect(() => {
    if (selectedOrgId === null) return;
    let active = true;
    setChart(null);
    setChartError(null);
    setActionError(null);
    apiClient
      .get<{ chart: OrgChart }>(`/api/clients/${selectedOrgId}/org-chart`)
      .then((d) => {
        if (active) setChart(d.chart);
      })
      .catch((e: unknown) => {
        if (active) setChartError(e instanceof Error ? e.message : 'Failed to load org chart');
      });
    return (): void => {
      active = false;
    };
  }, [selectedOrgId, reloadKey]);

  const selectedOrg = useMemo<Client | null>(
    () => orgs.find((o) => o.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId],
  );

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ value: o.id, label: o.name })),
    [orgs],
  );

  const summary = useMemo<string>(() => {
    if (chart === null) return 'Loading offices…';
    const total = chart.offices.length;
    const vacant = chart.offices.filter((o) => o.holder === null).length;
    const key = chart.offices.filter((o) => o.isKey).length;
    return `${total} ${total === 1 ? 'office' : 'offices'} · ${vacant} vacant · ${key} key`;
  }, [chart]);

  // --- Editor mutations ------------------------------------------------------------

  const openAddTopLevel = useCallback((): void => {
    setOfficeEditing(null);
    setOfficeParentId(null);
    setOfficeModalOpen(true);
  }, []);

  const handleAddChild = useCallback((parentOfficeId: string): void => {
    setOfficeEditing(null);
    setOfficeParentId(parentOfficeId);
    setOfficeModalOpen(true);
  }, []);

  const handleEditOffice = useCallback((office: OfficeWithHolder): void => {
    setOfficeEditing(office);
    setOfficeParentId(null);
    setOfficeModalOpen(true);
  }, []);

  const handleSetHolder = useCallback((office: OfficeWithHolder): void => {
    setHolderOffice(office);
    setHolderModalOpen(true);
  }, []);

  const handleDelete = useCallback(
    (office: OfficeWithHolder): void => {
      if (selectedOrgId === null) return;
      const ok = window.confirm(
        `Delete the office “${office.title}”? Its child offices move up to the top level and its current holder becomes a freeform role.`,
      );
      if (!ok) return;
      setBusyOfficeId(office.id);
      setActionError(null);
      apiClient
        .del<{ ok: true }>(`/api/clients/${selectedOrgId}/offices/${office.id}`)
        .then(() => reload())
        .catch((e: unknown) =>
          setActionError(e instanceof Error ? e.message : 'Failed to delete office'),
        )
        .finally(() => setBusyOfficeId(null));
    },
    [selectedOrgId, reload],
  );

  const handleVacate = useCallback(
    (office: OfficeWithHolder): void => {
      if (selectedOrgId === null) return;
      const who = office.holder?.contactName ?? 'the current holder';
      const ok = window.confirm(`Vacate “${office.title}”? This ends ${who}'s tenure in this office.`);
      if (!ok) return;
      setBusyOfficeId(office.id);
      setActionError(null);
      apiClient
        .del<{ ok: true }>(`/api/clients/${selectedOrgId}/offices/${office.id}/holder`)
        .then(() => reload())
        .catch((e: unknown) =>
          setActionError(e instanceof Error ? e.message : 'Failed to vacate office'),
        )
        .finally(() => setBusyOfficeId(null));
    },
    [selectedOrgId, reload],
  );

  // --- Render ----------------------------------------------------------------------

  if (orgs.length === 0) {
    return (
      <EmptyState
        title="No organizations yet"
        description="Add a client, prospect, lead, or partner to start building its org chart."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div style={{ maxWidth: '22rem' }}>
        <SelectField
          label="Organization"
          value={selectedOrgId ?? ''}
          onChange={(value): void => setSelectedOrgId(value)}
          options={orgOptions}
        />
      </div>

      {selectedOrg !== null ? (
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <ClientAvatar initials={selectedOrg.initials} size="md" />
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2">
                <span style={TYPE.sectionHeader}>{selectedOrg.name}</span>
                <OrgTypeBadge type={selectedOrg.type} />
              </span>
              <span style={{ ...TYPE.secondary, color: 'var(--text-secondary)' }}>{summary}</span>
            </div>
          </div>

          {canEdit ? (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={14} aria-hidden="true" />}
                onClick={openAddTopLevel}
              >
                Add office
              </Button>
              {selectedOrgId !== null ? (
                <a
                  href={`/api/clients/${selectedOrgId}/contacts/export`}
                  download
                  className="inline-flex items-center justify-center gap-2 rounded-lg border shadow-sm transition-shadow hover:shadow-md"
                  style={{
                    backgroundColor: '#ffffff',
                    color: 'var(--text-primary)',
                    borderColor: 'var(--border-subtle)',
                    padding: '0.25rem 0.625rem',
                    ...TYPE.bodyStrong,
                  }}
                >
                  <Download size={14} aria-hidden="true" />
                  Export CSV
                </a>
              ) : null}
            </div>
          ) : null}
        </header>
      ) : null}

      {actionError !== null ? (
        <p role="alert" style={{ ...TYPE.secondary, color: 'var(--color-red-600)' }}>
          {actionError}
        </p>
      ) : null}

      {chartError !== null ? (
        <ErrorState
          title="Couldn’t load org chart"
          description={chartError}
          action={
            <Button variant="secondary" onClick={reload}>
              Retry
            </Button>
          }
        />
      ) : chart === null ? (
        <LoadingState label="Loading org chart…" />
      ) : chart.roots.length === 0 ? (
        <EmptyState
          title="No offices yet"
          description={
            canEdit
              ? 'Add the top office (e.g. CEO or Agency Head) to start the org chart.'
              : 'This organization doesn’t have any offices modeled yet.'
          }
          action={
            canEdit ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={14} aria-hidden="true" />}
                onClick={openAddTopLevel}
              >
                Add office
              </Button>
            ) : undefined
          }
        />
      ) : (
        <OrgChartTree
          roots={chart.roots}
          canEdit={canEdit}
          busyOfficeId={busyOfficeId}
          onAddChild={handleAddChild}
          onEditOffice={handleEditOffice}
          onSetHolder={handleSetHolder}
          onDelete={handleDelete}
          onVacate={handleVacate}
        />
      )}

      {selectedOrgId !== null ? (
        <OfficeFormModal
          isOpen={officeModalOpen}
          onClose={(): void => setOfficeModalOpen(false)}
          clientId={selectedOrgId}
          offices={chart?.offices ?? []}
          office={officeEditing}
          defaultParentId={officeParentId}
          onSaved={reload}
        />
      ) : null}

      {selectedOrgId !== null && holderOffice !== null ? (
        <SetHolderModal
          isOpen={holderModalOpen}
          onClose={(): void => setHolderModalOpen(false)}
          clientId={selectedOrgId}
          officeId={holderOffice.id}
          officeTitle={holderOffice.title}
          currentHolderName={holderOffice.holder?.contactName ?? null}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}
