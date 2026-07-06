/**
 * Row mappers — convert raw Supabase rows (snake_case) to the camelCase domain
 * types in `@gracie/shared`. One place to keep the DB↔domain boundary explicit.
 *
 * Admin-only fields (feeTier, contractValue) are mapped here as-is; the API
 * layer is responsible for OMITTING them for non-admin roles before the row
 * reaches the client (docs/02 §D14).
 */
import type { Database } from '@gracie/db';
import type { Client } from '@gracie/shared';

type ClientRow = Database['public']['Tables']['clients']['Row'];

export function mapClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    initials: row.initials,
    contractNumber: row.contract_number,
    primaryContact: row.primary_contact,
    primaryContactEmail: row.primary_contact_email,
    cadence: row.cadence,
    feeTier: row.fee_tier,
    contractValue: row.contract_value,
    billingCadence: row.billing_cadence,
    description: row.description,
    relationshipHealth: row.relationship_health,
    relationshipTrend: row.relationship_trend,
    lastMeetingAt: row.last_meeting_at,
    driveFolderUrl: row.drive_folder_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
