import type {
  IntegrationKey,
  NotificationType,
} from '../constants/enums.js';
import type {
  ISODate,
  ISOTimestamp,
  Timestamps,
  UUID,
} from './common.js';

/** `settings` table — key/value global config (docs/04). */
export interface Setting {
  readonly key: string;
  readonly value: unknown;
  readonly updatedByUserId: UUID | null;
  readonly updatedAt: ISOTimestamp;
}

/** `knowledge_base_documents` table (docs/04, Module 9). */
export interface KnowledgeBaseDocument {
  readonly id: UUID;
  readonly title: string;
  readonly description: string | null;
  readonly topicTags: readonly string[];
  readonly r2Key: string;
  readonly fileName: string;
  readonly fileSize: number | null;
  readonly uploadedByUserId: UUID | null;
  readonly expirationDate: ISODate | null;
  readonly isAiActive: boolean;
  readonly createdAt: ISOTimestamp;
}

/** `daily_syncs` table (docs/04, Module 8). Generated 6:00 AM ET. */
export interface DailySync {
  readonly id: UUID;
  readonly syncDate: ISODate;
  readonly content: unknown;
  readonly generatedAt: ISOTimestamp | null;
  readonly deliveredAt: ISOTimestamp | null;
  readonly meetingIdsIncluded: readonly UUID[];
  readonly createdAt: ISOTimestamp;
}

/** `pre_meeting_briefs` table (docs/04). */
export interface PreMeetingBrief {
  readonly id: UUID;
  readonly meetingId: UUID;
  readonly content: string;
  readonly r2Key: string | null;
  readonly generatedAt: ISOTimestamp | null;
  readonly deliveredAt: ISOTimestamp | null;
  readonly deliveredToUserIds: readonly UUID[];
  readonly createdAt: ISOTimestamp;
}

/** `notifications` table — in-app primary, Resend secondary. */
export interface Notification {
  readonly id: UUID;
  readonly userId: UUID;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string | null;
  readonly link: string | null;
  readonly readAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
}

/**
 * `ai_providers` table (docs/04, D11). The model-selection record. Secret key is
 * encrypted at rest and NEVER returned raw to the client — represented here as
 * a presence flag only.
 */
export interface AiProvider extends Timestamps {
  readonly id: UUID;
  readonly providerKey: string;
  readonly displayName: string;
  readonly isApiKeySet: boolean;
  readonly isEnabled: boolean;
  readonly availableModels: readonly string[];
}

/**
 * `integration_credentials` table (docs/04) — universal credential store behind
 * Admin → API Settings. The raw secret is never exposed; only `isSet` and last
 * test status reach the client.
 */
export interface IntegrationCredential extends Timestamps {
  readonly id: UUID;
  readonly service: IntegrationKey;
  readonly label: string;
  /** Non-secret config (region, bucket, endpoint, ...). */
  readonly config: Readonly<Record<string, unknown>>;
  readonly isSet: boolean;
  readonly lastTestedAt: ISOTimestamp | null;
  readonly lastTestOk: boolean | null;
  readonly updatedByUserId: UUID | null;
}
