/**
 * Run a PostgREST `.in(column, ids)` query in bounded chunks and merge the rows.
 *
 * supabase-js encodes `.in('col', [id, id, …])` as a GET request whose URL carries
 * the whole list: `?col=in.(id,id,…)`. A list long enough — e.g. every meeting in a
 * busy calendar month — overflows Kong/PostgREST's URI length limit and the request
 * 414s ("URI too long"). Splitting the ids into small batches keeps each request's
 * URL comfortably under the limit while producing the SAME rows a single unbounded
 * query would (just gathered across a few round-trips).
 *
 * The caller supplies `queryChunk`, which runs one `.in()` for a slice of ids and
 * resolves to the standard supabase `{ data, error }`. Keeping query construction at
 * the call site preserves supabase-js's literal table/select typing (a generic
 * `db.from(tableName)` here would erase it). The first chunk that errors aborts the
 * whole call and throws `<label>: <message>`, matching the single-query error text.
 *
 * Empty `ids` short-circuits to `[]` without issuing any request.
 *
 * A UUID is 36 chars, so the default 100-id chunk is ~3.7 KB of ids — well under the
 * ~8 KB URI budget with headroom for the base path and select clause.
 */
export async function selectByIdsChunked<T>(
  label: string,
  ids: readonly string[],
  queryChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chunkSize = 100,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await queryChunk(chunk);
    if (error !== null) throw new Error(`${label}: ${error.message}`);
    if (data !== null) rows.push(...data);
  }
  return rows;
}
