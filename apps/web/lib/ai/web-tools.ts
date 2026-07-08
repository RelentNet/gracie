/**
 * Web-access tools for the Assistant + Intelligence chats (P6B.2). SERVER-ONLY.
 *
 * Two on-demand tools, advertised to the model ONLY when the per-chat "Web" toggle
 * is on (the routes decide; this module just defines + executes them):
 *   - `web_search` — open-ended discovery via SearXNG (needs `SEARXNG_URL`).
 *   - `fetch_url`  — read ONE specific page/domain directly (SSRF-guarded; does NOT
 *     require SearXNG, so "analyze fnit.us" works even before SearXNG is set up).
 *
 * Web results are UNTRUSTED data: they never change a role/permission gate, and the
 * assistant stays read-only. Errors (including SSRF blocks + "not configured") are
 * returned as JSON strings so the model can relay a helpful message.
 */
import 'server-only';

import type { AITool } from '@gracie/shared';

import { fetchUrl, isWebSearchConfigured, webSearch } from '../web/search.js';

function ok(data: unknown): string {
  return JSON.stringify(data);
}

function toolError(message: string): string {
  return JSON.stringify({ error: message });
}

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

/** Prepend `https://` when the model passes a bare host/domain (e.g. `fnit.us`). */
function normalizeUrl(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
}

interface WebTool {
  readonly spec: AITool;
  readonly run: (args: Record<string, unknown>) => Promise<string>;
}

const TOOLS: Record<string, WebTool> = {
  web_search: {
    spec: {
      name: 'web_search',
      description:
        'Search the public internet for current/up-to-date information via the firm\'s SearXNG. Returns a list of results (title, url, snippet). Use for questions needing live or external info, then fetch_url a result to read it in full. Cite the sources you use.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
          limit: { type: 'number', description: 'Max results (default 6, max 10).' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const query = asString(args.query);
      if (query === undefined) return toolError('query is required');
      if (!isWebSearchConfigured()) {
        return toolError(
          'Web search is not configured on this server (SEARXNG_URL is unset). You can still read a specific page with fetch_url.',
        );
      }
      const results = await webSearch(query, asNumber(args.limit) ?? 6);
      return ok({ count: results.length, results });
    },
  },

  fetch_url: {
    spec: {
      name: 'fetch_url',
      description:
        'Fetch ONE specific public web page (or bare domain like "fnit.us") and return its readable text, for reading or analyzing that site directly. Does not require search. Only public URLs are allowed (internal/private addresses are blocked). Cite the page URL.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'The URL or domain to read.' } },
        required: ['url'],
        additionalProperties: false,
      },
    },
    run: async (args) => {
      const url = asString(args.url);
      if (url === undefined) return toolError('url is required');
      const page = await fetchUrl(normalizeUrl(url));
      return ok(page);
    },
  },
};

/** Tool specs advertised to the model when the Web toggle is on. */
export const WEB_TOOLS: readonly AITool[] = Object.values(TOOLS).map((t) => t.spec);

/** Names of the web tools — used to route dispatch between web + company executors. */
export const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(TOOLS));

/**
 * Execute one web tool. Never throws: unknown tools, malformed args, SSRF blocks,
 * and fetch/search errors all return a JSON error string so the model can recover.
 */
export async function executeWebTool(name: string, rawArgs: string): Promise<string> {
  const tool = TOOLS[name];
  if (tool === undefined) return toolError(`unknown tool: ${name}`);

  let args: Record<string, unknown>;
  try {
    args = parseArgs(rawArgs);
  } catch {
    return toolError('invalid tool arguments (not valid JSON)');
  }

  try {
    return await tool.run(args);
  } catch (error) {
    console.error(`web tool ${name} failed:`, error);
    return toolError(error instanceof Error ? error.message : 'tool execution failed');
  }
}
