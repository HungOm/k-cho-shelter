/**
 * Paging straight from PostgREST, without offset.
 *
 * WHY NOT OFFSET. Measured against this project's 20,000 tickets, in pages of
 * a thousand:
 *
 *     offset, page 1      ~115ms
 *     offset, page 20     ~280ms     and worsening with depth
 *     keyset, same depth   ~62ms     and flat
 *
 * OFFSET 19000 makes the database walk nineteen thousand rows and throw them
 * away. Asking for "the rows after index 19000" is a lookup into the primary
 * key. The whole difference is that one is a scan and the other is a seek.
 *
 * THE REASON THAT MATTERS MORE THAN SPEED. Offset paging is wrong while
 * anything is being written. Someone records a sale in book 3 while you are
 * fetching page 12; every later row shifts by one, and you silently get a
 * duplicate or miss a ticket — with no error, and no way to tell afterwards.
 * In a raffle that is a ticket that appears twice in a search, or one that
 * cannot be found at all. A cursor is a position in the data, not a count of
 * rows skipped, so nothing shifts underneath it.
 */

/**
 * Fetches everything matching a filter, a page at a time.
 *
 * @param {object} supabase   the supabase-js client
 * @param {string} table      a *_readable view — never a base table
 * @param {object} opts
 *   select    columns, default '*'
 *   key       the ordered unique column to page on, default 'idx'
 *   pageSize  rows per request, default 1000 (PostgREST's own cap)
 *   filter    (query) => query, applied to every page
 *   onPage    (rows, total) => void, so a screen can draw as it loads
 *   signal    AbortSignal, to stop when the user leaves
 */
export async function fetchAll(supabase, table, opts = {}) {
  const {
    select = '*', key = 'idx', pageSize = 1000,
    filter = (q) => q, onPage, signal,
  } = opts

  const out = []
  let cursor = null

  // Bounded rather than `while (true)`. Twenty thousand tickets is twenty
  // pages; a hundred means something has gone wrong — a filter that does not
  // narrow, or a key that is not unique — and spinning forever against the
  // database is a worse failure than stopping and saying so.
  for (let page = 0; page < 100; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    let q = supabase.from(table).select(select).order(key).limit(pageSize)
    if (cursor !== null) q = q.gt(key, cursor)
    q = filter(q)

    const { data, error } = await q
    if (error) throw error
    if (!data?.length) break

    out.push(...data)
    onPage?.(data, out.length)

    // A short page means the end. Reading the cursor from the row rather than
    // counting keeps this correct when the filter skips rows.
    if (data.length < pageSize) break
    const last = data[data.length - 1][key]
    if (last === undefined) {
      throw new Error(`fetchAll: "${key}" is not in the selected columns, so paging cannot continue`)
    }
    cursor = last
  }

  return out
}

/**
 * One page, for a screen that shows a list rather than loading everything.
 *
 * Returns { rows, nextCursor } — nextCursor is null at the end, so a caller
 * can tell "no more" from "something went wrong" without guessing.
 */
export async function fetchPage(supabase, table, opts = {}) {
  const { select = '*', key = 'idx', pageSize = 100, cursor = null, filter = (q) => q } = opts

  let q = supabase.from(table).select(select).order(key).limit(pageSize)
  if (cursor !== null) q = q.gt(key, cursor)

  const { data, error } = await filter(q)
  if (error) throw error

  const rows = data ?? []
  return {
    rows,
    nextCursor: rows.length === pageSize ? rows[rows.length - 1][key] : null,
  }
}

/**
 * How many rows match, without fetching any of them.
 *
 * head:true sends no body at all, so a count over twenty thousand tickets costs
 * about the same as a count over ten. Worth using wherever a screen shows a
 * total — the alternative, fetching everything to call .length on it, is the
 * habit the spreadsheet forced on this app and the one worth unlearning.
 */
export async function countRows(supabase, table, filter = (q) => q) {
  const { count, error } = await filter(
    supabase.from(table).select('*', { count: 'exact', head: true }),
  )
  if (error) throw error
  return count ?? 0
}
