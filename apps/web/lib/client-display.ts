/**
 * Presentation helpers for the client-profile and file-browser UI (Phase 2).
 * Pure functions mapping domain values → display tokens/labels. No data access
 * here — callers pass values from the mock selectors (Phase 1B-safe).
 */
import type {
  ClientCadence,
  DocumentPillType,
  DocumentStatus,
  DocumentType,
  FeeTier,
  RelationshipTrend,
  TaskStatus,
} from '@gracie/shared';

// --- Relationship health ---------------------------------------------------

/** Health-score color band (docs/08 M2): >90 emerald, 70–90 amber, <70 red. */
export function healthColor(score: number | null): string {
  if (score === null) return 'var(--text-secondary)';
  if (score > 90) return 'var(--color-emerald-600)';
  if (score >= 70) return 'var(--color-amber-600)';
  return 'var(--color-red-600)';
}

export function healthLabel(score: number | null): string {
  if (score === null) return 'Not scored';
  if (score > 90) return 'Strong';
  if (score >= 70) return 'Steady';
  return 'At risk';
}

// --- Fee tier (ADMIN-ONLY display) -----------------------------------------

interface FeeTierDisplay {
  readonly label: string;
  readonly color: string;
  /** Emoji used as the colored dot per docs/08 M2 / task spec. */
  readonly dot: string;
}

const FEE_TIER_DISPLAY: Readonly<Record<FeeTier, FeeTierDisplay>> = {
  high: { label: 'High', color: 'var(--color-emerald-600)', dot: '🟢' },
  mid: { label: 'Mid', color: 'var(--color-amber-600)', dot: '🟡' },
  low: { label: 'Standard', color: 'var(--color-blue-700)', dot: '🔵' },
};

export function feeTierDisplay(tier: FeeTier | null): FeeTierDisplay | null {
  if (tier === null) return null;
  return FEE_TIER_DISPLAY[tier];
}

// --- Cadence ---------------------------------------------------------------

const CADENCE_LABELS: Readonly<Record<ClientCadence, string>> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  qbr: 'Quarterly (QBR)',
  ad_hoc: 'Ad hoc',
};

export function cadenceLabel(cadence: ClientCadence): string {
  return CADENCE_LABELS[cadence];
}

// --- Relationship trend ----------------------------------------------------

interface TrendDisplay {
  readonly label: string;
  readonly color: string;
  /** 'up' | 'flat' | 'down' for arrow selection. */
  readonly direction: 'up' | 'flat' | 'down';
}

const TREND_DISPLAY: Readonly<Record<RelationshipTrend, TrendDisplay>> = {
  improving: { label: 'Improving', color: 'var(--color-emerald-600)', direction: 'up' },
  stable: { label: 'Stable', color: 'var(--color-slate-600)', direction: 'flat' },
  declining: { label: 'Declining', color: 'var(--color-red-600)', direction: 'down' },
};

export function trendDisplay(trend: RelationshipTrend | null): TrendDisplay | null {
  if (trend === null) return null;
  return TREND_DISPLAY[trend];
}

// --- Document type → pill --------------------------------------------------

/** Map the broad DB `document_type` to the 5 DocumentPill categories (docs/08 §5). */
export function documentPillType(type: DocumentType): DocumentPillType | null {
  switch (type) {
    case 'post_meeting_analysis':
      return 'analysis';
    case 'internal_memo':
      return 'memo';
    case 'client_summary':
    case 'pre_meeting_brief':
    case 'daily_sync':
      return 'summary';
    case 'task_checklist':
      return 'checklist';
    case 'internal_email_draft':
    case 'client_email_draft':
      return 'email';
    case 'upload':
    case 'other':
      return null;
  }
}

// --- Document status badge (file browser) ----------------------------------

interface DocStatusBadge {
  readonly label: string;
  readonly bg: string;
  readonly fg: string;
}

const DOC_STATUS_BADGE: Readonly<Record<DocumentStatus, DocStatusBadge>> = {
  ready: { label: 'Ready', bg: 'var(--color-emerald-100)', fg: 'var(--color-emerald-600)' },
  needs_review: {
    label: 'Requires Review',
    bg: 'var(--color-amber-100)',
    fg: 'var(--color-amber-600)',
  },
  delivered: { label: 'Delivered', bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' },
  archived: { label: 'Archived', bg: 'var(--color-slate-100)', fg: 'var(--color-slate-600)' },
};

export function docStatusBadge(status: DocumentStatus): DocStatusBadge {
  return DOC_STATUS_BADGE[status];
}

// --- File source/type badge (Meeting / Upload / Auto) ----------------------

interface SourceBadge {
  readonly label: string;
  readonly bg: string;
  readonly fg: string;
}

const SOURCE_BADGE: Readonly<Record<'meeting' | 'upload' | 'auto', SourceBadge>> = {
  meeting: { label: 'Meeting', bg: 'var(--color-blue-100)', fg: 'var(--color-blue-700)' },
  upload: { label: 'Upload', bg: '#ede9fe', fg: '#6d28d9' },
  auto: { label: 'Auto', bg: 'var(--color-emerald-100)', fg: 'var(--color-emerald-600)' },
};

export function sourceBadge(source: 'meeting' | 'upload' | 'auto'): SourceBadge {
  return SOURCE_BADGE[source];
}

// --- Task status / priority ------------------------------------------------

const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  open: 'Open',
  in_progress: 'In Progress',
  complete: 'Complete',
};

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

interface PriorityBadge {
  readonly label: string;
  readonly bg: string;
  readonly fg: string;
}

/** Priority badge (docs/08 §5): HIGH red · MEDIUM amber · LOW blue. */
export function priorityBadge(hasPriorityFlag: boolean): PriorityBadge {
  return hasPriorityFlag
    ? { label: 'HIGH', bg: 'var(--color-red-100)', fg: 'var(--color-red-600)' }
    : { label: 'MEDIUM', bg: 'var(--color-amber-100)', fg: 'var(--color-amber-600)' };
}

// --- File size -------------------------------------------------------------

/** Human-readable file size. `null` → em dash. */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

// --- Money -----------------------------------------------------------------

/** Format a contract value as USD. `null` → em dash. */
export function formatUsd(amount: number | null): string {
  if (amount === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}
