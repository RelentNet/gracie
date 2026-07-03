/**
 * Upload subtypes — the "document type" choices in the Upload modal (docs/08 §8).
 *
 * A subtype is NOT the DB `document_type` enum; it selects the DESTINATION folder
 * for a manual upload (the drive-feel filing rule, docs/plan p2fix §2):
 *   - Proposal / Capability Deck / Email Thread → a subfolder under `Uploads`
 *   - Transcript                                → the Admin-only `Transcripts` folder
 *   - Other                                     → the `Uploads` root
 *
 * Client-safe (no `server-only`): imported by the modal (labels + `restricted`
 * gate) AND the upload API (`segment`/`displayName` to build the folder path).
 * `segment` is appended to `clients/<slug>/` server-side to form the folder path.
 */
export interface UploadSubtype {
  readonly value: 'proposal' | 'capability_deck' | 'email_thread' | 'transcript' | 'other';
  readonly label: string;
  /** Path segment under `clients/<slug>/` for this subtype's folder. */
  readonly segment: string;
  /** Folder display name (find-or-created on first upload of this subtype). */
  readonly displayName: string;
  /** Restricted destination (Transcripts) — Admin-only, hidden from other roles. */
  readonly restricted: boolean;
}

export const UPLOAD_SUBTYPES: readonly UploadSubtype[] = [
  {
    value: 'proposal',
    label: 'Proposal',
    segment: 'uploads/proposals',
    displayName: 'Proposals',
    restricted: false,
  },
  {
    value: 'capability_deck',
    label: 'Capability Deck',
    segment: 'uploads/capability-decks',
    displayName: 'Capability Decks',
    restricted: false,
  },
  {
    value: 'email_thread',
    label: 'Email Thread',
    segment: 'uploads/email-threads',
    displayName: 'Email Threads',
    restricted: false,
  },
  {
    value: 'transcript',
    label: 'Transcript',
    segment: 'transcripts',
    displayName: 'Transcripts',
    restricted: true,
  },
  { value: 'other', label: 'Other', segment: 'uploads', displayName: 'Uploads', restricted: false },
];

export type UploadSubtypeValue = UploadSubtype['value'];

const DEFAULT_SUBTYPE = UPLOAD_SUBTYPES[UPLOAD_SUBTYPES.length - 1] as UploadSubtype; // 'other'

/** Resolve a subtype by value, falling back to `Other` for unknown input. */
export function resolveSubtype(value: string | null | undefined): UploadSubtype {
  return UPLOAD_SUBTYPES.find((s) => s.value === value) ?? DEFAULT_SUBTYPE;
}
