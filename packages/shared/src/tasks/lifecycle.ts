/**
 * Pure task-lifecycle logic (tasks lifecycle core).
 *
 * GA has tried task-tracking several times and it never stuck — the team judges
 * tasks on how reliably they CLEAR, not how many get captured. So the rules here
 * are aggressive about NOT piling on:
 *
 *  - DEDUP is the keystone. Before a meeting creates a task we check the client
 *    doesn't already have the same one (active or archived), by a fuzzy match on
 *    the description. A repeat escalates the existing task to HIGH instead of
 *    duplicating it — that is what makes "mentioned again → important" work and
 *    stops the duplicate pile.
 *  - Two priorities only: standard (default) and high.
 *  - A per-client active cap keeps the list short; overflow archives the stalest
 *    standard tasks (high tasks are never auto-evicted).
 *  - Aging archives standard tasks that see no activity for two weeks.
 *
 * Everything here is PURE (no DB / IO) so it is unit-tested directly. Consumers:
 * the worker's generate processor + nightly aging sweep, and the web voice
 * "action item" path (which reuses dedup + owner-on-name for dictated items).
 * Lives in @gracie/shared so both the worker and the web app share ONE copy.
 */

/** Max active (non-archived, non-complete) tasks kept per client before eviction. */
export const MAX_ACTIVE_TASKS_PER_CLIENT = 3;

/** A standard task with no activity for this many days auto-archives (GA cadence). */
export const STANDARD_TASK_TTL_DAYS = 14;

/**
 * Two descriptions are the same task at/above this overlap (containment) coefficient
 * of their significant-word signatures — intersection / smaller-signature-size. Overlap
 * (not Jaccard) so a terse restatement stays a match when a recurring meeting re-adds
 * qualifiers ("Follow up with client" vs "Follow up with the client next week").
 * ponytail: fixed threshold + token-set overlap; swap for edit-distance if recurring
 * meetings still leak near-duplicates.
 */
export const DEDUP_SIMILARITY_THRESHOLD = 0.8;

/** Low-signal words dropped before matching so "send the proposal" == "send proposal". */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'and', 'or', 'with', 'on', 'in', 'at', 'as',
  'is', 'are', 'be', 'by', 'from', 'into', 'please', 'will', 'shall', 'should', 'must',
  'need', 'needs', 'get', 'this', 'that', 'we', 'our',
]);

/** Lowercase, strip punctuation/diacritics, collapse whitespace. */
export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Significant-word set (normalized, stopwords removed) used for fuzzy matching. */
function signature(desc: string): Set<string> {
  return new Set(
    normalizeDescription(desc)
      .split(' ')
      .filter((word) => word !== '' && !STOPWORDS.has(word)),
  );
}

/** True when two task descriptions describe the same action (the dedup keystone). */
export function isDuplicateDescription(
  a: string,
  b: string,
  threshold: number = DEDUP_SIMILARITY_THRESHOLD,
): boolean {
  const sa = signature(a);
  const sb = signature(b);
  const minSize = Math.min(sa.size, sb.size);
  // Empty or single-token signatures are too weak to fuzzy-match (a lone shared word
  // would match any longer task containing it) → require exact normalized equality.
  if (minSize <= 1) return normalizeDescription(a) === normalizeDescription(b);
  let intersection = 0;
  for (const word of sa) if (sb.has(word)) intersection += 1;
  return intersection / minSize >= threshold;
}

/** First existing task whose description matches `desc`, else null. */
export function findDuplicateTask<T extends { readonly description: string }>(
  desc: string,
  existing: readonly T[],
): T | null {
  for (const task of existing) {
    if (isDuplicateDescription(desc, task.description)) return task;
  }
  return null;
}

/**
 * What to do with one extracted task given any existing match for its client:
 *  - no match        → insert (high iff explicitly flagged important)
 *  - archived match  → reactivate it as high (it came back = it matters again)
 *  - active match     → escalate it to high (re-mentioned while open = a repeat)
 * Completed tasks are NOT passed as candidates — a re-mention of finished work is
 * legitimately new work, so it inserts.
 */
export type TaskUpsertDecision =
  | { readonly kind: 'insert'; readonly high: boolean }
  | { readonly kind: 'escalate'; readonly id: string }
  | { readonly kind: 'reactivate'; readonly id: string };

export function decideTaskUpsert(
  extracted: { readonly priority: boolean },
  match: { readonly id: string; readonly archived: boolean } | null,
): TaskUpsertDecision {
  if (match === null) return { kind: 'insert', high: extracted.priority };
  return match.archived ? { kind: 'reactivate', id: match.id } : { kind: 'escalate', id: match.id };
}

/**
 * Resolve an owner hint to a user id ONLY when a person is clearly named. Matches on
 * exact full name, email, email local-part, or a name token ("Sarah" → "Sarah Chen").
 * Deliberately NOT a loose substring match: owner is set only when a name is clearly
 * present, otherwise the task stays unassigned under the client — never guessed onto
 * an arbitrary person.
 */
export function resolveTaskOwner(
  hint: string | null,
  users: ReadonlyArray<{ readonly id: string; readonly name: string; readonly email: string }>,
): string | null {
  if (hint === null) return null;
  const needle = hint.trim().toLowerCase();
  if (needle === '') return null;
  for (const user of users) {
    const name = user.name.toLowerCase();
    const email = user.email.toLowerCase();
    if (needle === name || needle === email || email.split('@')[0] === needle) return user.id;
  }
  for (const user of users) {
    if (user.name.toLowerCase().split(/\s+/).includes(needle)) return user.id;
  }
  return null;
}

/**
 * Owner-on-name for FREEFORM text — the voice "action item" path. The meeting pipeline
 * gets a clean owner hint from the model, but a dictated item is one raw sentence, so we
 * scan its words and take the first that {@link resolveTaskOwner} maps to a staff member
 * (i.e. equals a full first/last name token). Returns null when no staffer is clearly named.
 * ponytail: token scan, first hit wins — a word that happens to equal a staffer's name
 * ("call Mark about the markup") can misassign; upgrade to model-extracted hints if it bites.
 */
export function resolveOwnerFromText(
  text: string,
  users: ReadonlyArray<{ readonly id: string; readonly name: string; readonly email: string }>,
): string | null {
  for (const token of normalizeDescription(text).split(' ')) {
    if (token === '') continue;
    const id = resolveTaskOwner(token, users);
    if (id !== null) return id;
  }
  return null;
}

/**
 * Ids to archive so a client's active-task count drops to `cap`. Only standard
 * (non-high) tasks are evicted, stalest first (oldest activity, then oldest
 * creation). High tasks are never evicted — they persist until done, so a client
 * saturated with high tasks may legitimately stay above the cap.
 */
export function decideCapEvictions(
  active: ReadonlyArray<{
    readonly id: string;
    readonly priorityFlag: boolean;
    readonly updatedAt: string;
    readonly createdAt: string;
  }>,
  cap: number = MAX_ACTIVE_TASKS_PER_CLIENT,
): string[] {
  const over = active.length - cap;
  if (over <= 0) return [];
  return active
    .filter((task) => !task.priorityFlag)
    .sort(
      (a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt),
    )
    .slice(0, over)
    .map((task) => task.id);
}

/** ISO cutoff before which an untouched standard task is stale (aging sweep). */
export function agingCutoffIso(now: Date, ttlDays: number = STANDARD_TASK_TTL_DAYS): string {
  return new Date(now.getTime() - ttlDays * 86_400_000).toISOString();
}

/** One task's fields the merge cares about (index 0 of the selection = the survivor). */
export interface MergeTaskInput {
  readonly clientId: string;
  readonly description: string;
  readonly priorityFlag: boolean;
}

/** Fields written onto the survivor when a merge is applied. */
export interface MergeCombination {
  readonly description: string;
  readonly priorityFlag: boolean;
}

/**
 * True when every task shares one client. A task is client-scoped, so merge is too —
 * combining across clients would silently move work onto the survivor's client. Empty
 * or single-task selections are not mergeable (nothing to fold in).
 */
export function tasksShareClient(tasks: readonly { readonly clientId: string }[]): boolean {
  const [first, ...rest] = tasks;
  if (first === undefined) return false;
  return rest.every((task) => task.clientId === first.clientId);
}

/**
 * Fold N selected tasks into the survivor's fields (pure — the DB re-parents the
 * merged-away notes and deletes their rows). `tasks[0]` is the survivor:
 *  - description: the survivor's, with each DISTINCT merged-away description appended
 *    on its own bullet line (identical restatements are dropped via normalizeDescription)
 *    so the combined task still names everything it absorbed;
 *  - priorityFlag: HIGH if ANY selected task is high — the highest priority wins.
 * Throws on an empty selection (callers guard for 2+, but fail loud rather than silent).
 */
export function combineMergedTasks(tasks: readonly MergeTaskInput[]): MergeCombination {
  const [survivor, ...rest] = tasks;
  if (survivor === undefined) throw new Error('combineMergedTasks: no tasks to merge');
  const base = survivor.description.trim();
  const seen = new Set<string>([normalizeDescription(base)]);
  const extra: string[] = [];
  for (const task of rest) {
    const norm = normalizeDescription(task.description);
    if (norm === '' || seen.has(norm)) continue;
    seen.add(norm);
    extra.push(task.description.trim());
  }
  const description =
    extra.length === 0 ? base : `${base}\n\nMerged in:\n${extra.map((d) => `• ${d}`).join('\n')}`;
  return { description, priorityFlag: tasks.some((task) => task.priorityFlag) };
}
