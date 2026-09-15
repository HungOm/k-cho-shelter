/**
 * Books — ported from Books.gs.
 *
 * A book is a physical object: ten paper tickets, stapled, handed to somebody
 * who walks off with it. Nearly everything here is bookkeeping about where the
 * paper is, which is why the operations come in ranges — books are issued and
 * returned in runs, not one at a time.
 *
 * Settlement is the part that decides money, and it is the part worth reading
 * twice. It asks for the tickets that did NOT sell — the ones the agent is
 * physically holding — and marks everything else sold. Typing two numbers takes
 * five seconds and is exact, whereas "I sold eight" throws away the
 * ticket-to-buyer link the draw depends on.
 */
import { ApiError, type AppUser } from './gate.ts'
import { configDate, defaultDueDate, noteReportFromSettle } from './deadlines.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any; rpc: (f: string, a: unknown) => any } }

async function audit(ctx: Ctx, action: string, details: unknown, email: string) {
  await ctx.supabaseAdmin.from('audit_log').insert({ action, details, email })
}

/**
 * Resolves fromBook/toBook or an explicit list into book indexes.
 *
 * Canonicalised deliberately: the caller may type Book-7 for Book-0007, and the
 * Sheet version had a real bug here — it validated the tolerant form and then
 * matched the raw string, so a book typed short resolved against nothing and
 * came back as "does not exist". Looking the number up is what makes both
 * spellings work, because the database holds the canonical one.
 */
async function resolveBooks(ctx: Ctx, p: Record<string, unknown>): Promise<number[]> {
  if (Array.isArray(p.bookNumbers) && p.bookNumbers.length) {
    const { data } = await ctx.supabaseAdmin
      .from('books').select('idx,number').in('number', p.bookNumbers.map(String))
    const found = (data ?? []).map((b: { idx: number }) => b.idx)
    if (found.length !== p.bookNumbers.length) {
      const got = new Set((data ?? []).map((b: { number: string }) => b.number))
      const missing = p.bookNumbers.map(String).filter((n) => !got.has(n))
      throw new ApiError('BOOK_NOT_FOUND', `Book "${missing[0]}" does not exist.`, { missing }, 404)
    }
    return found.sort((a, b) => a - b)
  }

  const from = String(p.fromBook ?? '').trim()
  if (!from) throw new ApiError('MISSING_FIELD', 'A first book is required.')
  const to = String(p.toBook ?? '').trim() || from

  const { data } = await ctx.supabaseAdmin.from('books').select('idx,number').in('number', [from, to])
  const byNumber = new Map((data ?? []).map((b: { number: string; idx: number }) => [b.number, b.idx]))
  const fi = byNumber.get(from)
  const ti = byNumber.get(to)
  if (fi === undefined) throw new ApiError('BOOK_NOT_FOUND', `Book "${from}" does not exist.`, null, 404)
  if (ti === undefined) throw new ApiError('BOOK_NOT_FOUND', `Book "${to}" does not exist.`, null, 404)

  const lo = Math.min(fi, ti), hi = Math.max(fi, ti)
  if (hi - lo + 1 > 300) {
    throw new ApiError('RANGE_TOO_LARGE', 'Handle at most 300 books at once.')
  }
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
}

async function activeBookLimit(ctx: Ctx): Promise<number> {
  const { data } = await ctx.supabaseAdmin.rpc('active_tickets', {})
  const { data: cfg } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', 'TICKETS_PER_BOOK').maybeSingle()
  const per = parseInt(String(cfg?.value ?? '10'), 10) || 10
  return Math.ceil((Number(data) || 0) / per)
}

export async function issueBooks(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Who is taking them?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name,phone').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)

  const idxs = await resolveBooks(ctx, p)
  const liveBooks = await activeBookLimit(ctx)

  const { data: books } = await ctx.supabaseAdmin
    .from('books').select('idx,number,status,held_by_agent').in('idx', idxs).order('idx')

  // Every book checked before any is written, so a range that is half
  // unavailable leaves nothing half issued.
  const blocked = []
  for (const b of books ?? []) {
    if (b.idx > liveBooks) {
      blocked.push({ book: b.number, status: 'not released yet', agentId: '' })
    } else if (b.status !== 'Unassigned' && !p.force) {
      blocked.push({ book: b.number, status: String(b.status).toLowerCase(), agentId: b.held_by_agent ?? '' })
    }
  }
  if (blocked.length) {
    throw new ApiError(
      'BOOKS_NOT_AVAILABLE',
      `${blocked.length} of ${idxs.length} books are not free to issue. Nothing was changed.`,
      { blocked },
    )
  }

  // A due date is a whole day in the raffle's own calendar, never an instant:
  // the column is a date, and sending a timestamp lets Postgres truncate it in
  // UTC, landing a day early for anyone west of here.
  //
  // The default follows the deadline rules: the shared check-in if it is still
  // ahead, else the final deadline if that is, else the plain due-days window.
  // A book handed out today should come back when everything else does, not on
  // its own private schedule.
  const dueAt = await defaultDueDate(ctx, p.dueDate)

  const finalDeadline = await configDate(ctx, 'FINAL_DEADLINE')
  if (finalDeadline && dueAt > finalDeadline) {
    throw new ApiError(
      'DUE_AFTER_FINAL',
      `These books would be due back on ${dueAt}, after the final deadline of ` +
      `${finalDeadline}. Everything has to be back by then. Give them an earlier date, ` +
      'or move the final deadline first.',
      { due: dueAt, finalDeadline },
    )
  }

  /*
   * THE WRITE ONLY LANDS ON BOOKS THAT ARE STILL FREE.
   *
   * The check above read the books and the update below wrote them, and
   * nothing tied the two together. Two organisers issuing the same run within
   * a second both saw it free and both wrote; the second overwrote the first,
   * and the history table recorded two handovers of one book to two people.
   * The status predicate makes the update itself the check: a book that
   * changed hands in between is simply not matched, and the reply says so
   * rather than counting it.
   */
  let write = ctx.supabaseAdmin
    .from('books')
    .update({
      status: 'Out', held_by_agent: agentId,
      issued_at: new Date().toISOString(), due_at: dueAt,
      modified_by: user.email,
    })
    .in('idx', idxs)
  if (!p.force) write = write.eq('status', 'Unassigned')
  const { data: changed, error } = await write.select('idx,number')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const issuedIdx = new Set((changed ?? []).map((b: { idx: number }) => Number(b.idx)))
  const skipped = (books ?? [])
    .filter((b: { idx: number }) => !issuedIdx.has(Number(b.idx)))
    .map((b: { number: string }) => b.number)

  if (!issuedIdx.size) {
    throw new ApiError(
      'BOOKS_CHANGED_MEANWHILE',
      'Those books were given out by somebody else a moment ago. Nothing was changed.',
      { blocked: skipped.map((book: string) => ({ book, status: 'taken meanwhile', agentId: '' })) },
    )
  }

  await ctx.supabaseAdmin.from('book_history').insert(
    [...issuedIdx].map((idx) => ({
      book_idx: idx, to_agent: agentId, action: 'issue',
      by_user: user.email, note: String(p.note ?? ''),
    })))

  await audit(ctx, 'ISSUE_BOOKS',
    { count: issuedIdx.size, agent: agentId,
      books: (changed ?? []).map((b: { number: string }) => b.number),
      skipped: skipped.length ? skipped : undefined },
    user.email)
  return {
    issued: issuedIdx.size,
    books: (changed ?? []).map((b: { number: string }) => b.number),
    // Named, never silently dropped: a handover receipt for five books when
    // three went out is the paper a seller holds up later and is wrong about.
    skipped,
    agent: { id: agentId, name: agent.name, phone: agent.phone },
    dueDate: dueAt,
  }
}

export async function transferBooks(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const toAgent = String(p.toAgentId ?? p.agentId ?? '').trim()
  if (!toAgent) throw new ApiError('MISSING_FIELD', 'Who is taking them?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name').eq('agent_id', toAgent).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${toAgent}".`, null, 404)

  const idxs = await resolveBooks(ctx, p)
  const { data: books } = await ctx.supabaseAdmin
    .from('books').select('idx,number,status,held_by_agent').in('idx', idxs).order('idx')

  // Only a book somebody is actually holding can be passed on. A book still in
  // the office is issued, not transferred, and conflating the two loses the
  // history of who had it.
  const blocked = (books ?? [])
    .filter((b: { status: string }) => b.status !== 'Out')
    .map((b: { number: string; status: string }) => ({
      book: b.number, status: String(b.status).toLowerCase(), agentId: '',
    }))
  if (blocked.length) {
    throw new ApiError(
      'TRANSFER_BLOCKED',
      `${blocked.length} of ${idxs.length} books are not out with anybody. Nothing was changed.`,
      { blocked },
    )
  }

  /*
   * MONEY DOES NOT CHANGE HANDS WITH THE BOOK.
   *
   * Expected money is worked out per book and charged to whoever holds it. So
   * passing on a book with sales already recorded moved the value of those
   * sales — made by the first seller, whose name is still on every ticket —
   * onto the second, and the first seller's debt vanished from the chase list
   * with nobody deciding it. A book that has sold anything goes back through
   * the office: brought back, counted in with the money, and the unsold part
   * given out again. That is the path the settlement was built for, and it is
   * the only one that leaves each person owing what they actually sold.
   */
  const { data: ledger } = await ctx.supabaseAdmin
    .from('book_ledger_all')
    .select('idx,number,recorded_sold,recorded_amount,agent_name,held_by_agent')
    .in('idx', idxs)
  const withSales = (ledger ?? [])
    .filter((r: Record<string, unknown>) => Number(r.recorded_sold ?? 0) > 0)
    .map((r: Record<string, unknown>) => ({
      book: r.number, sold: Number(r.recorded_sold ?? 0), amount: Number(r.recorded_amount ?? 0),
      agent: String(r.agent_name ?? r.held_by_agent ?? ''),
    }))
  if (withSales.length) {
    throw new ApiError(
      'BOOK_HAS_SALES',
      `${withSales.length} of ${idxs.length} books have sales recorded on them, and passing ` +
      'them on would charge that money to the new seller. Mark them brought back and count ' +
      'them in first; the unsold tickets can be given out again after. Nothing was changed.',
      { books: withSales },
    )
  }

  const history = (books ?? []).map((b: { idx: number; held_by_agent: string | null }) => ({
    book_idx: b.idx, from_agent: b.held_by_agent, to_agent: toAgent,
    action: 'transfer', by_user: user.email, note: String(p.note ?? ''),
  }))

  const { error } = await ctx.supabaseAdmin
    .from('books').update({ held_by_agent: toAgent, modified_by: user.email }).in('idx', idxs)
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  await ctx.supabaseAdmin.from('book_history').insert(history)

  await audit(ctx, 'TRANSFER_BOOKS',
    { count: idxs.length, to: toAgent, books: (books ?? []).map((b: { number: string }) => b.number) }, user.email)
  return { transferred: idxs.length, books: (books ?? []).map((b: { number: string }) => b.number), agent: agent.name }
}

export async function returnBooks(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const idxs = await resolveBooks(ctx, p)
  const { data: books } = await ctx.supabaseAdmin
    .from('books').select('idx,number,status,held_by_agent').in('idx', idxs).order('idx')

  const blocked = (books ?? [])
    .filter((b: { status: string }) => b.status !== 'Out')
    .map((b: { number: string; status: string }) => ({
      book: b.number, status: String(b.status).toLowerCase(), agentId: '',
    }))
  if (blocked.length) {
    throw new ApiError(
      'BOOKS_NOT_AVAILABLE',
      `${blocked.length} of ${idxs.length} books are not out. Nothing was changed.`,
      { blocked },
    )
  }

  const { error } = await ctx.supabaseAdmin
    .from('books').update({ status: 'Returned', modified_by: user.email }).in('idx', idxs)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // A reserved ticket in a returned book is a hold nobody is chasing any more.
  await ctx.supabaseAdmin
    .from('tickets')
    .update({ status: 'Available', buyer_name: '', buyer_phone: '', recorded_by: user.email })
    .in('book_idx', idxs).eq('status', 'Reserved')

  await ctx.supabaseAdmin.from('book_history').insert(
    (books ?? []).map((b: { idx: number; held_by_agent: string | null }) => ({
      book_idx: b.idx, from_agent: b.held_by_agent, action: 'return',
      by_user: user.email, note: String(p.note ?? ''),
    })))

  await audit(ctx, 'RETURN_BOOKS',
    { count: idxs.length, books: (books ?? []).map((b: { number: string }) => b.number) }, user.email)
  return { returned: idxs.length, books: (books ?? []).map((b: { number: string }) => b.number) }
}

/**
 * Settlement. The one that decides what an agent owes.
 *
 * Goes through a Postgres function because it writes a book row and up to ten
 * ticket rows together — half a settlement is a figure nobody can reconcile.
 */
export async function settleBook(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const bookNumber = String(p.bookNumber ?? '').trim()
  if (!bookNumber) throw new ApiError('MISSING_FIELD', 'Which book?')

  const amountPaid = Number(p.amountPaid)
  if (isNaN(amountPaid) || amountPaid < 0) {
    throw new ApiError('MISSING_FIELD', 'How much money was handed in? (amountPaid)')
  }

  // Read before the settle: the function answers about the BOOK, and the report
  // this settlement stands for belongs to the person who was holding it.
  const { data: held } = await ctx.supabaseAdmin
    .from('books').select('idx,held_by_agent').eq('number', bookNumber).maybeSingle()

  const { data, error } = await ctx.supabaseAdmin.rpc('settle_book', {
    p_book_number: bookNumber,
    p_unsold: p.unsoldTickets ?? [],
    p_amount_paid: amountPaid,
    p_allow_unidentified: !!p.allowUnidentified,
    p_sold_count: p.soldCount ?? null,
    p_force: !!p.force,
    p_user: user.email,
    p_note: String(p.note ?? ''),
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)
  if (data?.error) throw new ApiError(data.error.code, data.error.message, data.error.details)

  await audit(ctx, 'SETTLE', {
    book: bookNumber, sold: data.declaredSold, due: data.amountDue, paid: amountPaid,
  }, user.email)

  const holder = String((held as { held_by_agent?: string } | null)?.held_by_agent ?? '')

  // Somebody who has just settled a book has reported, and should not also have
  // to be ticked off a list by the person who counted it.
  await noteReportFromSettle(ctx, holder, bookNumber, user)

  // The cash counted in at settlement is written by settle_book itself now,
  // inside the transaction that counted it — so the book's declared figure and
  // the seller's running total cannot end up as two separate truths. It used
  // to happen here, in a call that deliberately could not fail the settlement,
  // and the price of that was a book saying money came in over a ledger with
  // no row for it.


  return data
}

/**
 * Puts a book back on the shelf so it can be given out again.
 *
 * THIS IS THE ANSWER TO "a book brought back should be available again". It is,
 * but not in one step, and the step in between is the point: a Returned book
 * has not been counted yet. Issuing it again before settling would hand a new
 * seller partly-sold paper and lose any record of what the first seller owed.
 *
 * So the path is: Returned -> settle (the money is reconciled) -> restock (the
 * unsold tickets go back into circulation) -> Unassigned -> issue again.
 *
 * Restocking clears the declared figures, because leaving them would describe a
 * settlement that no longer matches the book. That is destructive, which is why
 * a range of them needs a second person.
 */
export async function restockBooks(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const idxs = await resolveBooks(ctx, p)
  const { data: books } = await ctx.supabaseAdmin
    .from('books').select('idx,number,status,held_by_agent,declared_sold').in('idx', idxs).order('idx')

  // Only a book that is finished with can go back on the shelf.
  const eligible = (books ?? []).filter((b: { status: string }) =>
    b.status === 'Returned' || b.status === 'Settled')
  if (!eligible.length) {
    throw new ApiError(
      'NOTHING_TO_DO',
      'None of those books are brought back or settled, so none can go back on the shelf.',
    )
  }

  const ids = eligible.map((b: { idx: number }) => b.idx)

  // WHY THIS CHECK EXISTS. Restocking clears held_by_agent, and the outstanding
  // report finds debts by looking at which agent holds a book. So restocking a
  // book somebody still owes money on does not just lose the figure — it takes
  // the debt off the chase list entirely, silently, with nothing left to show
  // it was ever there. The tickets keep sold_by_agent, but no report reads it.
  //
  // A book that came back untouched owes nothing and restocks freely, which is
  // the ordinary case: hand out twenty, five come back unopened. A book with
  // sales on it has to be settled first, because settling is precisely the step
  // that records what was sold and what was handed in.
  const { data: ledger } = await ctx.supabaseAdmin
    .from('book_ledger_all')
    .select('number,status,agent_name,held_by_agent,counted_expected,counted_collected')
    .in('idx', ids)

  const owing = (ledger ?? [])
    .map((r: Record<string, unknown>) => ({
      book: r.number, status: r.status,
      agent: r.agent_name ?? r.held_by_agent ?? '',
      owed: Math.round((Number(r.counted_expected ?? 0) - Number(r.counted_collected ?? 0)) * 100) / 100,
    }))
    .filter((r: { owed: number }) => r.owed > 0.005)

  if (owing.length) {
    throw new ApiError(
      'MONEY_STILL_OWED',
      `${owing.length} of these books still have money owed on them. Settle them first, ` +
      'or the amount owed disappears from the outstanding report. Nothing was changed.',
      { books: owing },
    )
  }

  /*
   * THE LEDGER GOES BACK WITH THE FIGURE, and this is the half that used to be
   * missed.
   *
   * Clearing amount_paid takes the money off the book. The settlement rows
   * that made up that figure stayed in `payments`, so the book and the ledger
   * stopped agreeing the moment a settled book was restocked — silently,
   * because nothing sums them against each other. Reversed rather than
   * deleted, for the same reason a re-settle is: the claim was made, and a
   * correction whose evidence is gone cannot be told from a figure that was
   * always right.
   */
  const { data: live } = await ctx.supabaseAdmin
    .from('payments').select('id,agent_id,amount,book_idx,method')
    .in('book_idx', ids).eq('source', 'settlement').is('reverses', null)

  const already = new Set<number>()
  const { data: undone } = await ctx.supabaseAdmin
    .from('payments').select('reverses').in('book_idx', ids).not('reverses', 'is', null)
  for (const r of (undone ?? []) as Array<{ reverses: number }>) already.add(Number(r.reverses))

  const toReverse = ((live ?? []) as Array<Record<string, unknown>>)
    .filter((r) => !already.has(Number(r.id)))
  if (toReverse.length) {
    const { error } = await ctx.supabaseAdmin.from('payments').insert(
      toReverse.map((r) => ({
        agent_id: r.agent_id, amount: -Number(r.amount), received_by: user.email,
        method: r.method ?? 'cash', book_idx: r.book_idx, source: 'settlement',
        reverses: r.id, note: 'Reversed: book put back on the shelf',
      })))
    if (error) throw new ApiError('QUERY_FAILED', error.message)
  }

  await ctx.supabaseAdmin.from('books').update({
    status: 'Unassigned', held_by_agent: null,
    issued_at: null, due_at: null,
    declared_sold: null, amount_due: null, amount_paid: null,
    settled_at: null, settled_by: '', notes: '',
    modified_by: user.email,
  }).in('idx', ids)

  // Tickets nobody bought go back into circulation. Sold and donated ones are
  // left exactly as they are — the sale happened, and the buyer still has to be
  // findable when their number comes up.
  await ctx.supabaseAdmin.from('tickets').update({
    status: 'Available', buyer_name: '', buyer_phone: '', buyer_zone: '',
    sold_by_agent: null, amount: null, payment_status: '', sold_at: null,
    source: '', recorded_by: user.email,
  }).in('book_idx', ids).in('status', ['Available', 'Reserved'])

  await ctx.supabaseAdmin.from('book_history').insert(
    eligible.map((b: { idx: number; held_by_agent: string | null; declared_sold: number | null }) => ({
      book_idx: b.idx, from_agent: b.held_by_agent, action: 'restock',
      by_user: user.email,
      note: String(p.note ?? '') ||
        (b.declared_sold != null ? `Settlement of ${b.declared_sold} cleared.` : ''),
    })))

  await audit(ctx, 'RESTOCK_BOOKS', { count: ids.length, note: p.note }, user.email)
  return {
    restocked: ids.length,
    books: eligible.map((b: { number: string }) => b.number),
    skipped: (books ?? []).length - ids.length,
  }
}

/** Mark books lost, void, or reopen them. Destructive, hence the reason. */
export async function setBookStatus(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const status = String(p.status ?? '')
  const reason = String(p.reason ?? '').trim()
  const valid = ['Lost', 'Void', 'Out', 'Returned', 'Unassigned']
  if (!valid.includes(status)) {
    throw new ApiError('BAD_REQUEST', 'Status must be one of: ' + valid.join(', '))
  }
  // Required, not optional. A book marked lost without a reason is a question
  // somebody has to ask three people about in a month's time.
  if (!reason) throw new ApiError('MISSING_FIELD', 'A reason is required.')

  const idxs = await resolveBooks(ctx, p)
  const { data: books } = await ctx.supabaseAdmin
    .from('books').select('idx,number,status,held_by_agent').in('idx', idxs).order('idx')

  // A preview by default, because a mistyped range across hundreds of books
  // would otherwise be one click.
  const dryRun = p.dryRun === undefined ? true : !!p.dryRun
  if (dryRun) {
    return {
      dryRun: true, wouldChange: books?.length ?? 0,
      books: (books ?? []).map((b: { number: string; status: string }) => ({
        book: b.number, from: b.status, to: status,
      })),
      message: 'Nothing was changed. Send the same request with dryRun:false to apply it.',
    }
  }

  await ctx.supabaseAdmin.from('books')
    .update({ status, notes: reason, modified_by: user.email }).in('idx', idxs)

  // Lost or void means the unsold tickets leave the draw — they cannot be sold
  // and must not be drawn. Sold ones are left alone: somebody paid for those.
  if (status === 'Lost' || status === 'Void') {
    await ctx.supabaseAdmin.from('tickets')
      .update({ status: 'Void', notes: `Book ${status.toLowerCase()}: ${reason}`, recorded_by: user.email })
      .in('book_idx', idxs).in('status', ['Available', 'Reserved'])
  }

  await ctx.supabaseAdmin.from('book_history').insert(
    (books ?? []).map((b: { idx: number; held_by_agent: string | null }) => ({
      book_idx: b.idx, from_agent: b.held_by_agent, action: status.toLowerCase(),
      by_user: user.email, note: reason,
    })))

  await audit(ctx, 'SET_BOOK_STATUS',
    { count: idxs.length, status, reason, books: (books ?? []).map((b: { number: string }) => b.number) }, user.email)
  return { changed: idxs.length, status, books: (books ?? []).map((b: { number: string }) => b.number) }
}

/**
 * Where a book has been, and why.
 *
 * This existed as a table from the beginning and was never readable from
 * anywhere — every movement recorded, none of it ever shown. Which is the worse
 * half to be missing: the record was being kept for exactly the moment somebody
 * asks "who had this book in March", and until now the only way to answer was
 * to open the spreadsheet.
 */
export async function bookHistory(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const bookNumber = String(p.bookNumber ?? '').trim()
  if (!bookNumber) throw new ApiError('MISSING_FIELD', 'Which book?')

  const { data: book } = await ctx.supabaseAdmin
    .from('books').select('idx,number,status,held_by_agent').eq('number', bookNumber).maybeSingle()
  if (!book) throw new ApiError('BOOK_NOT_FOUND', `Book ${bookNumber} does not exist.`, null, 404)

  const { data, error } = await ctx.supabaseAdmin
    .from('book_history').select('*').eq('book_idx', book.idx).order('at')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // Agent ids are not what anybody wants to read in a history.
  const ids: string[] = [...new Set((data ?? []).flatMap((h: { from_agent: string; to_agent: string }) =>
    [h.from_agent, h.to_agent].filter(Boolean)))]
  const { data: agents } = ids.length
    ? await ctx.supabaseAdmin.from('agents').select('agent_id,name').in('agent_id', ids)
    : { data: [] }
  const names = new Map<string, string>(
    (agents ?? []).map((a: { agent_id: string; name: string }) => [a.agent_id, a.name]))

  /*
   * AND EVERY CHANGE TO A TICKET IN IT, from the trigger-written trail.
   *
   * The ticket row keeps only its latest state; the trail keeps what it was
   * before. Buyer names and numbers ride along for an organiser only — this
   * action is open to every role so a seller can see where a book went, and a
   * seller is not owed the name that used to be on somebody else's ticket.
   */
  const { data: trail } = await ctx.supabaseAdmin
    .from('ticket_history').select('*').eq('book_idx', book.idx).order('at')
  const { data: ticketRows } = await ctx.supabaseAdmin
    .from('tickets').select('idx,number').eq('book_idx', book.idx)
  const numberOf = new Map((ticketRows ?? []).map((t: { idx: number; number: string }) => [Number(t.idx), t.number]))
  for (const h of (trail ?? []) as Array<Record<string, unknown>>) {
    for (const k of ['from_agent', 'to_agent']) if (h[k]) ids.push(String(h[k]))
  }
  const extra = ids.filter((id) => !names.has(id))
  if (extra.length) {
    const { data: more } = await ctx.supabaseAdmin
      .from('agents').select('agent_id,name').in('agent_id', [...new Set(extra)])
    for (const a of (more ?? []) as Array<{ agent_id: string; name: string }>) names.set(a.agent_id, a.name)
  }
  const showBuyer = !!user.isAdmin
  const who = (id: unknown) => (id ? (names.get(String(id)) ?? String(id)) : null)

  return {
    book: { number: book.number, status: book.status },
    history: (data ?? []).map((h: Record<string, unknown>) => ({
      at: h.at,
      action: h.action,
      from: h.from_agent ? (names.get(String(h.from_agent)) ?? h.from_agent) : null,
      to: h.to_agent ? (names.get(String(h.to_agent)) ?? h.to_agent) : null,
      by: h.by_user,
      note: h.note || '',
    })),
    tickets: (trail ?? []).map((h: Record<string, unknown>) => ({
      at: h.at,
      ticket: numberOf.get(Number(h.ticket_idx)) ?? String(h.ticket_idx),
      fromStatus: h.from_status ?? '',
      toStatus: h.to_status ?? '',
      fromSeller: who(h.from_agent),
      toSeller: who(h.to_agent),
      fromBuyer: showBuyer ? (h.from_buyer ?? '') : '',
      toBuyer: showBuyer ? (h.to_buyer ?? '') : '',
      fromPhone: showBuyer ? (h.from_phone ?? '') : '',
      toPhone: showBuyer ? (h.to_phone ?? '') : '',
      fromAmount: h.from_amount ?? null,
      toAmount: h.to_amount ?? null,
      source: h.source ?? '',
      by: h.by_user ?? '',
      note: h.note ?? '',
    })),
  }
}
