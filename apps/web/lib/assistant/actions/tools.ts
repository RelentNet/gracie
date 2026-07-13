/**
 * Agentic WRITE tools for the Assistant (P8 §5). SERVER-ONLY. The Assistant's FIRST
 * actions — but strictly PROPOSE-only:
 *
 *  - `create_automation` VALIDATES against the v1 catalog + PERSISTS a
 *    `pending_confirmation` automation owned by the caller, and returns a proposal.
 *    It enables/runs NOTHING — activation is a separate, gated Confirm route.
 *  - `request_advanced_automation` records an out-of-catalog ask in the admin inbox
 *    and notifies admins — the graceful capability boundary.
 *
 * The catalog BOUNDS the agent: `create_automation`'s JSON-Schema `type` enum only
 * accepts built actions, so the LLM cannot request an unbuilt one. The caller
 * identity (`ownerUserId`) is the FIXED turn identity, NEVER taken from tool args.
 * Every proposal created this turn is pushed to a caller-supplied sink so the chat
 * route can surface it as a confirm card.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import type { Json } from '@gracie/db';
import {
  AUTOMATION_TYPES,
  describeSchedule,
  isAutomationType,
  parseSchedule,
  type AITool,
  type AutomationSchedule,
  type AutomationType,
} from '@gracie/shared';

import type { AutomationProposal } from './proposal.js';
import { AUTOMATION_TYPE_LABELS, recipientsSummary } from '../../automations-shared.js';
import {
  createPendingAutomation,
  createAutomationRequest,
  getAutomationsMinIntervalMinutes,
} from '../../data/automations.js';
import { getClient, listClients } from '../../data/clients.js';

/** The fixed turn identity — never derived from tool arguments. */
export interface ActionContext {
  readonly ownerUserId: string;
}

// --- defensive arg parsing ----------------------------------------------------

function parseArgs(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

function toolError(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a client by uuid or name (exact → substring → initials), across all types. */
async function resolveClient(nameOrId: string): Promise<{ id: string; name: string } | null> {
  if (UUID_RE.test(nameOrId)) {
    const byId = await getClient(nameOrId);
    if (byId !== null) return { id: byId.id, name: byId.name };
  }
  const all = await listClients(['client', 'prospect', 'lead', 'partner', 'internal']);
  const lower = nameOrId.trim().toLowerCase();
  const found =
    all.find((c) => c.name.toLowerCase() === lower) ??
    all.find((c) => c.name.toLowerCase().includes(lower)) ??
    all.find((c) => c.initials.toLowerCase() === lower) ??
    null;
  return found === null ? null : { id: found.id, name: found.name };
}

// --- tool specs ---------------------------------------------------------------

const CREATE_AUTOMATION_SPEC: AITool = {
  name: 'create_automation',
  description:
    'PROPOSE a new automation — a recurring report/task Gracie runs on a schedule, OR an event trigger that runs before each of your meetings. This does NOT run or activate anything; it creates a proposal the user must explicitly Confirm. Use ONLY for the supported types below. If the user wants something outside this catalog, call request_advanced_automation instead. Never claim an automation is active or scheduled — only that you have drafted it for confirmation.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: [...AUTOMATION_TYPES],
        description:
          'client_report (per-client summary), portfolio_digest (all clients + at-risk), activity_digest (yesterday/today rollup), reminder (a nudge to internal users), meeting_brief (a pre-meeting brief delivered before each matching meeting — use with schedule.kind=event), client_send (email a message to an EXTERNAL client — requires admin approval).',
      },
      title: { type: 'string', description: 'A short title, e.g. "Weekly Acme report" or "Client meeting briefs".' },
      schedule: {
        type: 'object',
        description:
          'When it runs. Use kind=daily/weekly for a recurring time, kind=interval for "every N hours" (hourly is the shortest — never sub-hourly), kind=once for a one-off, or kind=event for meeting_brief (run before each meeting).',
        properties: {
          kind: { type: 'string', enum: ['once', 'interval', 'daily', 'weekly', 'event'] },
          runAt: { type: 'string', description: 'ISO instant (kind=once).' },
          everyMinutes: {
            type: 'number',
            description: 'Minutes between runs (kind=interval). Hourly (60) is the shortest allowed — no sub-hourly.',
          },
          hourEt: { type: 'number', description: 'Hour 0–23 Eastern (kind=daily/weekly).' },
          minuteEt: { type: 'number', description: 'Minute 0–59 (optional).' },
          weekday: { type: 'number', description: '0=Sunday … 6=Saturday (kind=weekly).' },
          event: {
            type: 'string',
            enum: ['before_meeting'],
            description: 'The trigger event (kind=event). Only before_meeting is supported.',
          },
          leadMinutes: {
            type: 'number',
            description: 'How many minutes before each meeting to run, e.g. 15 (kind=event). Max 1440.',
          },
          filters: {
            type: 'object',
            description: 'Which meetings trigger it (kind=event). Briefs already target client meetings only.',
            properties: {
              meetingsILead: { type: 'boolean', description: 'Only meetings the user leads.' },
              clientMeetingsOnly: { type: 'boolean', description: 'Only client meetings (the default for briefs).' },
            },
            additionalProperties: false,
          },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      clientName: {
        type: 'string',
        description:
          'Client name — required for client_report and client_send; optional for meeting_brief to limit briefs to one client’s meetings.',
      },
      window: { type: 'string', enum: ['yesterday', 'today', 'both'], description: 'activity_digest window (default both).' },
      message: { type: 'string', description: 'The reminder text (required for reminder).' },
      subject: { type: 'string', description: 'Email subject (required for client_send).' },
      body: { type: 'string', description: 'Email body (required for client_send).' },
      recipientEmails: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional internal (@graceandassociates.com) addresses to also receive it. Optional; defaults to you.',
      },
      externalEmails: {
        type: 'array',
        items: { type: 'string' },
        description: 'EXTERNAL client email addresses — ONLY for client_send, and only when the user explicitly asked to email the client. Requires admin approval to send.',
      },
    },
    required: ['type', 'title', 'schedule'],
    additionalProperties: false,
  },
};

const REQUEST_ADVANCED_SPEC: AITool = {
  name: 'request_advanced_automation',
  description:
    'Flag an automation request that is OUTSIDE the supported catalog (something create_automation can\'t express) for a human admin to review. Use this instead of forcing an unsupported request into create_automation. Returns a friendly confirmation that it was flagged.',
  parameters: {
    type: 'object',
    properties: {
      intent: { type: 'string', description: 'A clear, self-contained description of what the user wants automated.' },
    },
    required: ['intent'],
    additionalProperties: false,
  },
};

/** The action tool specs advertised to the model. */
export const ACTION_TOOLS: readonly AITool[] = [CREATE_AUTOMATION_SPEC, REQUEST_ADVANCED_SPEC];

/** Fast membership test so the chat route can route names to this executor. */
export const ACTION_TOOL_NAMES: ReadonlySet<string> = new Set(ACTION_TOOLS.map((t) => t.name));

// --- executor -----------------------------------------------------------------

/** Build the params/recipients for a validated create_automation call, or an error. */
async function buildAutomation(
  type: AutomationType,
  args: Record<string, unknown>,
): Promise<
  | { params: Json; recipients: Json; hasExternal: boolean }
  | { error: string }
> {
  const recipientEmails = asStringArray(args.recipientEmails);
  const externalEmails = asStringArray(args.externalEmails);

  // Only client_send may carry external recipients — everything else drops them.
  const baseRecipients = { emails: recipientEmails };

  switch (type) {
    case 'client_report': {
      const clientName = asString(args.clientName);
      if (clientName === undefined) return { error: 'client_report needs a clientName' };
      const client = await resolveClient(clientName);
      if (client === null) return { error: `couldn't find a client matching "${clientName}"` };
      return {
        params: { clientId: client.id, clientName: client.name } as Json,
        recipients: baseRecipients as Json,
        hasExternal: false,
      };
    }
    case 'portfolio_digest':
      return { params: {} as Json, recipients: baseRecipients as Json, hasExternal: false };
    case 'activity_digest': {
      const window = asString(args.window);
      const w = window === 'yesterday' || window === 'today' || window === 'both' ? window : 'both';
      return { params: { window: w } as Json, recipients: baseRecipients as Json, hasExternal: false };
    }
    case 'reminder': {
      const message = asString(args.message);
      if (message === undefined) return { error: 'reminder needs a message' };
      return { params: { message } as Json, recipients: baseRecipients as Json, hasExternal: false };
    }
    case 'meeting_brief':
      // The target meeting + client filter live on the event schedule (enriched in the
      // create branch); params carry only delivery knobs. Internal-only — never external.
      return { params: {} as Json, recipients: baseRecipients as Json, hasExternal: false };
    case 'client_send': {
      const subject = asString(args.subject);
      const body = asString(args.body);
      if (subject === undefined || body === undefined) return { error: 'client_send needs a subject and body' };
      if (externalEmails.length === 0) {
        return { error: 'client_send needs at least one external client email address' };
      }
      const clientName = asString(args.clientName);
      const client = clientName !== undefined ? await resolveClient(clientName) : null;
      return {
        params: {
          subject,
          body,
          ...(client !== null ? { clientId: client.id, clientName: client.name } : {}),
        } as Json,
        recipients: { emails: recipientEmails, externalEmails } as Json,
        hasExternal: true,
      };
    }
  }
}

/**
 * Execute one agentic action. Never throws — every failure returns a JSON error
 * string so the tool loop keeps going and the model can explain gracefully. A
 * successful `create_automation` PERSISTS a pending automation and pushes its
 * proposal to `sink` (the chat route reads it to render the confirm card).
 */
export async function executeAssistantAction(
  name: string,
  rawArgs: string,
  ctx: ActionContext,
  sink: AutomationProposal[],
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = parseArgs(rawArgs);
  } catch {
    return toolError('invalid tool arguments (not valid JSON)');
  }

  try {
    if (name === 'request_advanced_automation') {
      const intent = asString(args.intent);
      if (intent === undefined) return toolError('intent is required');
      await createAutomationRequest({ requestedByUserId: ctx.ownerUserId, intent });
      await notifyAdminsOfRequest(intent);
      return JSON.stringify({
        ok: true,
        message: "I've flagged this for your admin to set up — it's outside what I can create directly yet.",
      });
    }

    if (name === 'create_automation') {
      const typeArg = args.type;
      if (!isAutomationType(typeArg)) return toolError('unsupported automation type — use request_advanced_automation');
      const title = asString(args.title);
      if (title === undefined) return toolError('title is required');

      // The tunable interval floor (default hourly) — enforced only at creation.
      const minInterval = await getAutomationsMinIntervalMinutes();
      const parsedSchedule = parseSchedule(args.schedule, minInterval);
      if (!('schedule' in parsedSchedule)) return toolError(parsedSchedule.error);
      const schedule = parsedSchedule.schedule;

      // Event triggers are only for meeting_brief, and meeting_brief is only for events.
      const isEvent = schedule.kind === 'event';
      if (isEvent !== (typeArg === 'meeting_brief')) {
        return toolError(
          typeArg === 'meeting_brief'
            ? 'meeting_brief needs schedule.kind="event" (event before_meeting with leadMinutes)'
            : 'schedule.kind="event" is only valid for the meeting_brief type',
        );
      }

      const built = await buildAutomation(typeArg, args);
      if ('error' in built) return toolError(built.error);

      // For a client-scoped meeting_brief, resolve the client and stamp it onto the
      // event schedule filters (never trust a client id/name straight from the model).
      let finalSchedule: AutomationSchedule = schedule;
      if (typeArg === 'meeting_brief' && schedule.kind === 'event') {
        const clientName = asString(args.clientName);
        if (clientName !== undefined) {
          const client = await resolveClient(clientName);
          if (client === null) return toolError(`couldn't find a client matching "${clientName}"`);
          finalSchedule = {
            ...schedule,
            filters: { ...schedule.filters, clientId: client.id },
            clientName: client.name,
          };
        }
      }

      const created = await createPendingAutomation({
        ownerUserId: ctx.ownerUserId,
        title,
        intent: title,
        type: typeArg,
        params: built.params,
        schedule: finalSchedule as unknown as Json,
        recipients: built.recipients,
        hasExternalRecipient: built.hasExternal,
      });

      const proposal: AutomationProposal = {
        kind: 'automation_proposal',
        automationId: created.id,
        title,
        type: typeArg,
        typeLabel: AUTOMATION_TYPE_LABELS[typeArg],
        scheduleLabel: describeSchedule(finalSchedule),
        recipientsSummary: recipientsSummary(built.recipients),
        external: built.hasExternal,
      };
      sink.push(proposal);

      return JSON.stringify({
        ok: true,
        status: 'pending_confirmation',
        proposal,
        note: 'Drafted only — the user must Confirm before it runs. Do not claim it is active.',
      });
    }

    return toolError(`unknown action: ${name}`);
  } catch (error) {
    console.error(`assistant action ${name} failed:`, error);
    return toolError('action failed');
  }
}

/** Best-effort in-app notification to active admins about a new advanced request. */
async function notifyAdminsOfRequest(intent: string): Promise<void> {
  try {
    const db = getServerClient();
    const { data } = await db.from('users').select('id').eq('role', 'admin').is('deactivated_at', null);
    const adminIds = (data ?? []).map((u) => u.id);
    if (adminIds.length === 0) return;
    const clamped = intent.length > 200 ? `${intent.slice(0, 199)}…` : intent;
    await db.from('notifications').insert(
      adminIds.map((userId) => ({
        user_id: userId,
        type: 'automation' as const,
        title: 'New advanced automation request',
        body: clamped,
        link: '/automations',
      })),
    );
  } catch (error) {
    // Non-fatal: the request row is the source of truth; the notification is a nicety.
    console.error('notifyAdminsOfRequest failed:', error);
  }
}
