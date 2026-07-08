/**
 * Web access for the Assistant + Intelligence chats (P6B.2). SERVER-ONLY.
 *
 * Two capabilities, both behind the per-chat "Web" toggle and exposed to the model
 * as on-demand tools (lib/ai/web-tools.ts):
 *   - {@link webSearch} — a query against a self-hosted **SearXNG** metasearch
 *     instance (`SEARXNG_URL`), returning title/url/snippet. No API key, no
 *     per-query cost; the operator runs SearXNG in Coolify / a VM.
 *   - {@link fetchUrl} — fetch one page and reduce it to readable text.
 *
 * SECURITY (SSRF): `fetchUrl` takes a URL that ultimately originates from the web
 * (a search result) or the model, so it is UNTRUSTED. Every hop is validated —
 * http(s) only, and the host must NOT resolve to a loopback/private/link-local/ULA
 * address (blocks cloud-metadata `169.254.169.254`, internal services, etc.).
 * Redirects are followed manually so each `Location` is re-validated (defeats a
 * redirect-to-internal bypass). Responses are size- and time-capped. Web content is
 * treated as data only — it never changes any role/permission gate (the assistant
 * stays read-only and role-scoped regardless of what a page says).
 */
import 'server-only';

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { isBlockedHostname, isPrivateAddress } from './ssrf.js';

const WEB_UA = 'GracieAssistant/1.0 (+internal firm assistant)';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_FETCH_BYTES = 2_000_000; // 2 MB
const MAX_TEXT_CHARS = 12_000;
const MAX_REDIRECTS = 3;
const DEFAULT_RESULTS = 6;
const MAX_RESULTS = 10;

/** Base URL of the self-hosted SearXNG instance (empty ⇒ web search disabled). */
function searxngBaseUrl(): string {
  return (process.env.SEARXNG_URL ?? '').trim().replace(/\/+$/, '');
}

/** True when `SEARXNG_URL` is set — the toggle/tools surface a clear message otherwise. */
export function isWebSearchConfigured(): boolean {
  return searxngBaseUrl() !== '';
}

export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface FetchedPage {
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

interface SearxngResponse {
  readonly results?: ReadonlyArray<{
    readonly title?: string;
    readonly url?: string;
    readonly content?: string;
  }>;
}

/**
 * Query SearXNG (JSON API). Returns up to `limit` results. Throws if `SEARXNG_URL`
 * is unset (callers should check {@link isWebSearchConfigured} first) or the
 * instance errors/times out.
 */
export async function webSearch(query: string, limit = DEFAULT_RESULTS): Promise<WebSearchResult[]> {
  const base = searxngBaseUrl();
  if (base === '') throw new Error('web search is not configured (SEARXNG_URL unset)');
  const count = Math.max(1, Math.min(limit, MAX_RESULTS));

  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': WEB_UA },
    });
    if (!res.ok) {
      throw new Error(`SearXNG returned HTTP ${res.status} (is JSON format enabled?)`);
    }
    const json = (await res.json()) as SearxngResponse;
    return (json.results ?? [])
      .map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }))
      .filter((r) => r.url !== '')
      .slice(0, count);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SECURITY-CRITICAL SSRF gate. Reject non-http(s) URLs and any host that resolves
 * to a non-public address. Applied to the initial URL AND every redirect hop.
 */
async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('only http(s) URLs are allowed');
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (isBlockedHostname(host)) throw new Error('blocked host');
  const addresses =
    isIP(host) !== 0
      ? [host]
      : (await lookup(host, { all: true })).map((a) => a.address);
  if (addresses.length === 0) throw new Error('host did not resolve');
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new Error('blocked host (resolves to a private address)');
  }
  return u;
}

/** Fetch with manual redirect handling so every hop is SSRF-validated. */
async function safeFetch(raw: string, signal: AbortSignal): Promise<Response> {
  let target = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const u = await assertPublicHttpUrl(target);
    const res = await fetch(u, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': WEB_UA, Accept: 'text/html,application/xhtml+xml,text/plain' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location === null || location === '') return res;
      target = new URL(location, u).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

/**
 * Fetch one page and reduce it to readable text (SSRF-guarded, size/time-capped).
 * Non-HTML/text content types are reported rather than dumped.
 */
export async function fetchUrl(raw: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await safeFetch(raw, controller.signal);
    if (!res.ok) throw new Error(`fetch returned HTTP ${res.status}`);
    const finalUrl = res.url === '' ? raw : res.url;
    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      return { url: finalUrl, title: '', text: `[unsupported content type: ${contentType || 'unknown'}]` };
    }
    const body = await readCapped(res, MAX_FETCH_BYTES);
    const { title, text } = htmlToText(body);
    return { url: finalUrl, title, text: text.slice(0, MAX_TEXT_CHARS) };
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body up to `maxBytes`, then stop. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (res.body === null) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/** Minimal HTML→text: drop script/style/comments, turn block ends into newlines. */
function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1] !== undefined ? decodeEntities(stripTags(titleMatch[1])).trim() : '';
  const text = decodeEntities(
    stripTags(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n'),
    ),
  )
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
