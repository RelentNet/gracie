/**
 * Structured read tools for the company-aware Assistant (P6B.1). SERVER-ONLY.
 * §B of the brief.
 *
 * Every tool is:
 *  - READ-ONLY — a SELECT (or a role-gated retrieval). Nothing here writes, changes
 *    settings, dispatches a bot, or mutates any row.
 *  - TYPED — arguments are a fixed JSON-Schema object; the raw model output is
 *    parsed + coerced here (never trusted structurally, never turned into SQL).
 *  - ROLE-GATED — client financials are redacted via the central access module, and
 *    the search tools run through the same transcript + restricted-folder gates the
 *    Intelligence chat uses. The caller identity is fixed for the turn and is NEVER
 *    taken from tool arguments.
 *
 * HARD OFF-LIMITS (not reachable from any tool): `settings`, `integration_credentials`,
 * and other users' Assistant data. No tool queries those tables.
 */
import 'server-only';

import { getServerClient } from '@gracie/db';
import {
  CLIENT_TYPES,
  TASK_STATUSES,
  type AITool,
  type Client,
  type ClientType,
} from '@gracie/shared';

import { redactClientForCaller, type CompanyCaller } from './access.js';
import { retrieveCompanyDocuments, retrieveKnowledgeBase } from './retrieval.js';
import { getClient, listClients } from '../../data/clients.js';
import { listTasks } from '../../data/tasks.js';
import { getKnowledgeBaseDocument, listKnowledgeBaseDocuments } from '../../data/knowledge-base.js';

/** Max characters of KB document text returned by `get_knowledge_base_document`. */
const MAX_DOC_TEXT_CHARS = 12_000;

// --- argument coercion (never trust the model's JSON structurally) -----------

function parseArgs(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function ok(data: unknown): string {
  return JSON.stringify(data);
}

function toolError(message: string): string {
  return JSON.stringify({ error: message });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- shared helpers -----------------------------------------------------------

const ALL_PARTY_TYPES: readonly ClientType[] = CLIENT_TYPES;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map of clientId → display name across ALL party types (for labelling rows). */
async function loadClientNameMap(): Promise<Map<string, string>> {
  const clients = await listClients(ALL_PARTY_TYPES);
  return new Map(clients.map((c) => [c.id, c.name]));
}

/** Resolve a client by uuid or (exact→substring→initials) name, across all types. */
async function resolveClient(nameOrId: string): Promise<Client | null> {
  if (UUID_RE.test(nameOrId)) {
    const byId = await getClient(nameOrId);
    if (byId !== null) return byId;
  }
  const all = await listClients(ALL_PARTY_TYPES);
  const lower = nameOrId.trim().toLowerCase();
  return (
    all.find((c) => c.name.toLowerCase() === lower) ??
    all.find((c) => c.name.toLowerCase().includes(lower)) ??
    all.find((c) => c.initials.toLowerCase() === lower) ??
    null
  );
}

/** Compact, redaction-safe client view. `feeTier`/`contractValue` are already null for non-admins. */
function clientSummary(client: Client): Record<string, unknown> {
  return {
    id: client.id,
    name: client.name,
    type: client.type,
    cadence: client.cadence,
    description: client.description,
    relationshipHealth: client.relationshipHealth,
    relationshipTrend: client.relationshipTrend,
    lastMeetingAt: client.lastMeetingAt,
    primaryContact: client.primaryContact,
    feeTier: client.feeTier,
    contractValue: client.contractValue,
  };
}

/** Whole days a task is overdue (0 when not overdue / no due date / complete). */
function daysOverdue(dueDate: string | null, status: string, today: string): number {
  if (dueDate === null || status === 'complete' || dueDate >= today) return 0;
  const ms = Date.parse(today) - Date.parse(dueDate);
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

// --- tool registry ------------------------------------------------------------

interface CompanyTool {
  readonly spec: AITool;
  readonly run: (args: Record<string, unknown>, caller: CompanyCaller) => Promise<string>;
}

const TOOLS: Record<string, CompanyTool> = {
  count_clients: {
    spec: {
      name: 'count_clients',
      description:
        'Count the firm\'s real clients (party type "client"; excludes leads, prospects, partners, and the internal workspace). Use for "how many clients do we have".',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    run: async () => {
      const clients = await listClients(['client']);
      return ok({ count: clients.length });
    },
  },

  list_clients: {
    spec: {
      name: 'list_clients',
      description:
        'List clients/parties with a short profile (name, cadence, relationship health/trend, description). Financials (fee tier, contract value) are included ONLY for admins; they are null for everyone else. Defaults to real clients.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [...CLIENT_TYPES],
            description: 'Party type to list. Defaults to "client".',
          },
          limit: { type: 'number', description: 'Max rows (default 50, max 200).' },
        },
        additionalProperties: false,
      },
    },
    run: async (args, caller) => {
      const limit = clampLimit(asNumber(args.limit), 50, 200);
      const typeArg = asString(args.type);
      const types: readonly ClientType[] =
        typeArg !== undefined && (CLIENT_TYPES as readonly string[]).includes(typeArg)
          ? [typeArg as ClientType]
          : ['client'];
      const clients = await listClients(types);
      const rows = clients
        .slice(0, limit)
        .map((c) => clientSummary(redactClientForCaller(c, caller)));
      return ok({ count: clients.length, clients: rows });
    },
  },

  get_client: {
    spec: {
      name: 'get_client',
      description:
        'Get one client/party by name or id: profile, cadence, relationship health/trend, description. Financials are admin-only (null otherwise).',
      parameters: {
        type: 'object',
        properties: {
          nameOrId: { type: 'string', description: 'Client name (or part of it) or id.' },
        },
        required: ['nameOrId'],
        additionalProperties: false,
      },
    },
    run: async (args, caller) => {
      const nameOrId = asString(args.nameOrId);
      if (nameOrId === undefined) return toolError('nameOrId is required');
      const client = await resolveClient(nameOrId);
      if (client === null) return ok({ found: false });
      return ok({ found: true, client: clientSummary(redactClientForCaller(client, caller)) });
    },
  },

  list_tasks: {
    spec: {
      name: 'list_tasks',
      description:
        'List (non-archived) tasks, optionally filtered by status, overdue-only, or client. Each row has description, status, due date, days overdue, priority, and client name.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: [...TASK_STATUSES], description: 'Filter by task status.' },
          overdue: { type: 'boolean', description: 'If true, only tasks past their due date and not complete.' },
          clientNameOrId: { type: 'string', description: 'Restrict to one client (name or id).' },
          limit: { type: 'number', description: 'Max rows (default 50, max 200).' },
        },
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const limit = clampLimit(asNumber(args.limit), 50, 200);
      const status = asString(args.status);
      const overdue = asBool(args.overdue);
      const clientFilter = asString(args.clientNameOrId);
      const today = todayIso();

      let tasks = await listTasks();
      if (status !== undefined && (TASK_STATUSES as readonly string[]).includes(status)) {
        tasks = tasks.filter((t) => t.status === status);
      }
      if (overdue === true) {
        tasks = tasks.filter(
          (t) => t.dueDate !== null && t.dueDate < today && t.status !== 'complete',
        );
      }
      if (clientFilter !== undefined) {
        const target = await resolveClient(clientFilter);
        tasks = target === null ? [] : tasks.filter((t) => t.clientId === target.id);
      }

      const nameMap = await loadClientNameMap();
      const rows = tasks.slice(0, limit).map((t) => ({
        description: t.description,
        status: t.status,
        dueDate: t.dueDate,
        daysOverdue: daysOverdue(t.dueDate, t.status, today),
        priority: t.hasPriorityFlag,
        client: nameMap.get(t.clientId) ?? null,
      }));
      return ok({ count: tasks.length, tasks: rows });
    },
  },

  list_meetings: {
    spec: {
      name: 'list_meetings',
      description:
        'List meetings (title, date/time, duration, type, pipeline status, client). Filter by upcoming/past/all and optionally by client. Meeting TRANSCRIPTS are never returned here.',
      parameters: {
        type: 'object',
        properties: {
          when: { type: 'string', enum: ['upcoming', 'past', 'all'], description: 'Default "upcoming".' },
          clientNameOrId: { type: 'string', description: 'Restrict to one client (name or id).' },
          limit: { type: 'number', description: 'Max rows (default 25, max 100).' },
        },
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const limit = clampLimit(asNumber(args.limit), 25, 100);
      const when = asString(args.when) ?? 'upcoming';
      const clientFilter = asString(args.clientNameOrId);
      const nowIso = new Date().toISOString();
      const db = getServerClient();

      let query = db
        .from('meetings')
        .select('id, title, date_time, client_id, meeting_type, pipeline_status, duration_minutes');
      if (clientFilter !== undefined) {
        const target = await resolveClient(clientFilter);
        if (target === null) return ok({ count: 0, meetings: [] });
        query = query.eq('client_id', target.id);
      }
      if (when === 'upcoming') query = query.gte('date_time', nowIso);
      else if (when === 'past') query = query.lt('date_time', nowIso);

      const ascending = when === 'upcoming';
      const { data, error } = await query.order('date_time', { ascending }).limit(limit);
      if (error !== null) return toolError(`list_meetings: ${error.message}`);

      const nameMap = await loadClientNameMap();
      const rows = (data ?? []).map((m) => ({
        title: m.title,
        dateTime: m.date_time,
        durationMinutes: m.duration_minutes,
        meetingType: m.meeting_type,
        status: m.pipeline_status,
        client: m.client_id !== null ? (nameMap.get(m.client_id) ?? null) : null,
      }));
      return ok({ count: rows.length, meetings: rows });
    },
  },

  list_knowledge_base: {
    spec: {
      name: 'list_knowledge_base',
      description:
        'List firm-wide Knowledge Base documents, newest first (so "the latest memo" resolves by upload date). Returns id, title, description, tags, upload date, status. Use get_knowledge_base_document(id) to read one.',
      parameters: {
        type: 'object',
        properties: {
          orderBy: { type: 'string', enum: ['recent'], description: 'Ordering (only "recent" supported).' },
          limit: { type: 'number', description: 'Max rows (default 25, max 100).' },
        },
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const limit = clampLimit(asNumber(args.limit), 25, 100);
      const docs = await listKnowledgeBaseDocuments();
      const rows = docs.slice(0, limit).map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
        tags: d.topicTags,
        uploadedAt: d.uploadedAt,
        status: d.status,
      }));
      return ok({ count: docs.length, documents: rows });
    },
  },

  get_knowledge_base_document: {
    spec: {
      name: 'get_knowledge_base_document',
      description:
        'Read one Knowledge Base document by id: title, description, and its full text (for summarizing). Only AI-active documents return text.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Knowledge Base document id.' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const id = asString(args.id);
      if (id === undefined) return toolError('id is required');
      const doc = await getKnowledgeBaseDocument(id);
      if (doc === null) return ok({ found: false });
      if (!doc.aiActive) {
        return ok({ found: true, title: doc.title, description: doc.description, aiActive: false, text: '' });
      }
      const db = getServerClient();
      const { data, error } = await db
        .from('embeddings')
        .select('content, chunk_index')
        .eq('source_type', 'knowledge_base')
        .eq('source_id', id)
        .order('chunk_index', { ascending: true });
      if (error !== null) return toolError(`get_knowledge_base_document: ${error.message}`);
      const text = (data ?? [])
        .map((r) => r.content)
        .join('\n')
        .slice(0, MAX_DOC_TEXT_CHARS);
      return ok({ found: true, title: doc.title, description: doc.description, aiActive: true, text });
    },
  },

  search_knowledge_base: {
    spec: {
      name: 'search_knowledge_base',
      description:
        'Semantic search over the firm-wide Knowledge Base (AI-active documents). Returns the most relevant text chunks. Use for "what does our KB say about X".',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to search for.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (query === undefined) return toolError('query is required');
      const chunks = await retrieveKnowledgeBase(query);
      return ok({
        count: chunks.length,
        chunks: chunks.map((c) => ({ content: c.content, similarity: Math.round(c.similarity * 1000) / 1000 })),
      });
    },
  },

  search_documents: {
    spec: {
      name: 'search_documents',
      description:
        'Semantic search across ALL client documents and meeting content you are permitted to see. Results are gated to your access — transcripts and restricted-folder documents are excluded for non-admins. Each chunk is labelled with its client. Use for questions about client work, notes, or discussions.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to search for.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
    run: async (args, caller) => {
      const query = asString(args.query);
      if (query === undefined) return toolError('query is required');
      const chunks = await retrieveCompanyDocuments(caller, query);
      const nameMap = await loadClientNameMap();
      return ok({
        count: chunks.length,
        chunks: chunks.map((c) => ({
          client: c.clientId !== null ? (nameMap.get(c.clientId) ?? null) : null,
          sourceType: c.sourceType,
          content: c.content,
          similarity: Math.round(c.similarity * 1000) / 1000,
        })),
      });
    },
  },
};

/** The tool specs advertised to the model each turn. */
export const COMPANY_TOOLS: readonly AITool[] = Object.values(TOOLS).map((t) => t.spec);

/**
 * Execute one tool call, ROLE-GATED and READ-ONLY. Never throws: unknown tools,
 * malformed arguments, and execution errors all return a JSON error string so the
 * agent loop can continue and the model can recover gracefully. `caller` is the
 * fixed turn identity — tool arguments cannot change whose access is used.
 */
export async function executeCompanyTool(
  name: string,
  rawArgs: string,
  caller: CompanyCaller,
): Promise<string> {
  const tool = TOOLS[name];
  if (tool === undefined) return toolError(`unknown tool: ${name}`);

  let args: Record<string, unknown>;
  try {
    args = parseArgs(rawArgs);
  } catch {
    return toolError('invalid tool arguments (not valid JSON)');
  }

  try {
    return await tool.run(args, caller);
  } catch (error) {
    console.error(`company tool ${name} failed:`, error);
    return toolError('tool execution failed');
  }
}
