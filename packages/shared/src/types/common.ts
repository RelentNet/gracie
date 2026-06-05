/** UUID primary key (gen_random_uuid()). String at the type level. */
export type UUID = string;

/** ISO-8601 timestamp string (timestamptz). Rendered in Eastern time by the UI. */
export type ISOTimestamp = string;

/** ISO date (YYYY-MM-DD) for date columns. */
export type ISODate = string;

/** Columns every mutable table carries via the updated_at trigger (docs/04). */
export interface Timestamps {
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}
