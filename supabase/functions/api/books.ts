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
import { ApiError, agentBooks, seesBuyer, shortPhone, type AppUser } from './gate.ts'
import {
  checkInRound, configDate, defaultDueDate, noteReportFromSettle, recordCheckIn,
} from './deadlines.ts'
// The seller's accepted report hands money over the same way every other
// hand-over does. money.ts imports nothing from here, so this is a leaf edge and
// not a cycle — deadlines.ts already depends on money.ts the same way.
import { recordPayment } from './money.ts'
// The approvals queue owns the row a seller answers; books.ts owns the books.
import { openOffer } from './approvals.ts'

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

  /*
   * A BOOK THAT CAME BACK UNTOUCHED CAN GO STRAIGHT OUT AGAIN.
   *
   * Until now only an Unassigned book could be issued, so a seller who took ten
   * books, sold nothing from three of them and handed those three back had to
   * have them counted in — a settlement of nought — and restocked before
   * anybody else could carry them. Three acts, two screens and a figure signed
   * off, to move paper that never left the desk.
   *
   * WITH SALES ON IT, NO. That is the rule transferBooks already states and
   * enforces as BOOK_HAS_SALES: handing a part-sold book to somebody else
   * carries the first seller's money to the second, and the first seller's debt
   * leaves the chase list with nobody deciding it. It is the fault that put
   * RM400 on the wrong volunteer across Books 001, 002, 003 and 116. So the
   * same view column and the same condition are read here, rather than a second
   * rule that can drift from it.
   *
   * The empty ones are collected separately because the write treats them
   * separately: its status predicate is what makes the update its own
   * concurrency check, and 'Unassigned' and 'Returned' are different values.
   */
  const { data: ledger } = await ctx.supabaseAdmin
    .from('book_ledger_all').select('idx,recorded_sold').in('idx', idxs)
  const soldIn = new Map((ledger ?? []).map(
    (r: { idx: number; recorded_sold: number | null }) => [Number(r.idx), Number(r.recorded_sold ?? 0)]))
  const emptyReturned = new Set<number>()

  // Every book checked before any is written, so a range that is half
  // unavailable leaves nothing half issued.
  const blocked = []
  for (const b of books ?? []) {
    if (b.idx > liveBooks) {
      blocked.push({ book: b.number, status: 'not released yet', agentId: '' })
    } else if (b.status === 'Unassigned') {
      // free
    } else if (b.status === 'Returned' && (soldIn.get(Number(b.idx)) ?? 0) === 0) {
      emptyReturned.add(Number(b.idx))
    } else if (!p.force) {
      blocked.push({
        book: b.number,
        // Named for what to DO about it, not merely for what it is. "returned"
        // on its own sends somebody to look for a rule; this says which one.
        status: b.status === 'Returned'
          ? 'brought back with sales on it — count it in first'
          : String(b.status).toLowerCase(),
        agentId: b.held_by_agent ?? '',
      })
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
   *
   * IT IS ONE TRANSACTION NOW, which is the other half. The update and the
   * history row were separate PostgREST calls, so a function killed at its time
   * limit between them left a book saying it was with Josh and a trail that
   * never saw it move. Both statements, and that predicate, are inside
   * issue_books_tx; nothing about which books are eligible has changed.
   */
  const { data: changed, error } = await ctx.supabaseAdmin.rpc('issue_books_tx', {
    p_idxs: idxs,
    // A book brought back with nothing sold out of it is free to go again
    // although its status says Returned. Collected above, from the same ledger
    // column transferBooks reads, so the two rules cannot drift apart.
    p_empty_returned: [...emptyReturned],
    p_agent_id: agentId,
    p_due_at: dueAt,
    p_user: user.email,
    p_note: String(p.note ?? ''),
    p_force: !!p.force,
  })
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

  // One transaction. The trail row names who the book came FROM, so it is
  // written inside the function before the update overwrites that column —
  // separately, a failure between the two loses who handed it over.
  const { error } = await ctx.supabaseAdmin.rpc('transfer_books_tx', {
    p_idxs: idxs, p_to_agent: toAgent, p_user: user.email, p_note: String(p.note ?? ''),
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)


  await audit(ctx, 'TRANSFER_BOOKS',
    { count: idxs.length, to: toAgent, books: (books ?? []).map((b: { number: string }) => b.number) }, user.email)
  return { transferred: idxs.length, books: (books ?? []).map((b: { number: string }) => b.number), agent: agent.name }
}

/**
 * What a seller said came back, against what an organiser actually counted in.
 *
 * TWO RECORDS OF THE SAME EVENT THAT NOBODY EVER PUT SIDE BY SIDE. A seller
 * declares "five books are coming back" in their check-in; an organiser later
 * takes books off them and records the returns. Both are stored, both are
 * trusted, and until now nothing compared them — so a seller who declared five
 * and handed over three looked, on every screen, exactly like a seller who
 * declared five and handed over five. The gap is the whole point of asking
 * them to declare in the first place.
 *
 * VERIFIED MEANS AN ORGANISER TOUCHED IT. `book_history` already carries that:
 * a return writes a row with the organiser's email in by_user, and so does a
 * settlement, which is a return that was counted on the spot. There is no new
 * column here and there does not need to be — "who verified this" has been in
 * the record all along, unread. What was missing was the question.
 *
 * THE WINDOW IS THE ROUND, and its edge is the previous round's due date, read
 * off the check_in_reports rows for that round — the date it was at the time,
 * which is exactly why that column exists. With no previous round there is no
 * edge and the answer is all time, which is correct for round 1 rather than a
 * fallback: nothing has closed yet, so everything counts.
 *
 * A DECLARATION IS NOT AN ACCUSATION. A seller who has brought nothing back yet
 * and said so is not the same as one who said five and brought three, and the
 * reply distinguishes them: `declared` is null when they have not reported at
 * all, and the gap is only meaningful once they have.
 */
export async function returnCheck(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const own = String(user.agentId ?? '').trim()
  const asked = String(p.agentId ?? '').trim()
  if (own && asked && asked !== own && !user.isAdmin && user.role !== 'recorder') {
    throw new ApiError('NOT_YOURS', 'That is somebody else\'s check-in.')
  }
  const only = user.isAdmin || user.role === 'recorder' ? (asked ? [asked] : null) : [own || '\u0000']

  const round = Number(p.round ?? 0) > 0 ? Number(p.round) : await checkInRound(ctx)

  // The edge of this round: the date the PREVIOUS one was due, as it stood then.
  let since: string | null = null
  if (round > 1) {
    const { data: prev } = await ctx.supabaseAdmin
      .from('check_in_reports').select('due_at').eq('round', round - 1)
      .is('undone_at', null).limit(1)
    since = (prev ?? [])[0]?.due_at ?? null
  }

  let rq = ctx.supabaseAdmin
    .from('check_in_reports').select('agent_id,books_back,reported_at,note').eq('round', round)
    .is('undone_at', null)
  if (only) rq = rq.in('agent_id', only)
  const { data: reports, error: rErr } = await rq
  if (rErr) throw new ApiError('QUERY_FAILED', rErr.message)
  const said = new Map((reports ?? []).map((r: Record<string, unknown>) =>
    [String(r.agent_id), r]))

  let aq = ctx.supabaseAdmin.from('agents').select('agent_id,name,phone').eq('active', true)
  if (only) aq = aq.in('agent_id', only)
  const { data: agents } = await aq

  // Every book that has ever been with these sellers, so a return can be
  // attributed to whoever was holding it rather than to whoever holds it now.
  let hq = ctx.supabaseAdmin
    .from('book_history').select('book_idx,from_agent,to_agent,action,by_user,at')
    .in('action', ['return', 'settle'])
  if (since) hq = hq.gte('at', since)
  const { data: history, error: hErr } = await hq
  if (hErr) throw new ApiError('QUERY_FAILED', hErr.message)

  const bookIdxs = [...new Set((history ?? []).map((h: { book_idx: number }) => Number(h.book_idx)))]
  const { data: bookRows } = bookIdxs.length
    ? await ctx.supabaseAdmin.from('books').select('idx,number').in('idx', bookIdxs)
    : { data: [] }
  const numberOf = new Map((bookRows ?? []).map((b: Record<string, unknown>) =>
    [Number(b.idx), String(b.number)]))

  // One book counted once, however many times it was handled.
  const seen = new Map<string, Map<number, Record<string, unknown>>>()
  for (const h of (history ?? []) as Array<Record<string, unknown>>) {
    const who = String(h.from_agent ?? '')
    if (!who) continue
    if (only && !only.includes(who)) continue
    if (!seen.has(who)) seen.set(who, new Map())
    seen.get(who)!.set(Number(h.book_idx), h)
  }

  let oq = ctx.supabaseAdmin.from('books').select('number,held_by_agent').eq('status', 'Out')
  if (only) oq = oq.in('held_by_agent', only)
  const { data: stillOut } = await oq
  const outBy = new Map<string, string[]>()
  for (const b of (stillOut ?? []) as Array<Record<string, unknown>>) {
    const who = String(b.held_by_agent ?? '')
    if (!outBy.has(who)) outBy.set(who, [])
    outBy.get(who)!.push(String(b.number))
  }

  const lines = (agents ?? []).map((a: Record<string, unknown>) => {
    const id = String(a.agent_id)
    const report = said.get(id) as Record<string, unknown> | undefined
    const counted = [...(seen.get(id) ?? new Map()).entries()].map(([idx, h]) => ({
      book: numberOf.get(idx) ?? String(idx),
      verifiedBy: String((h as Record<string, unknown>).by_user ?? ''),
      at: (h as Record<string, unknown>).at,
      how: (h as Record<string, unknown>).action === 'settle' ? 'counted in' : 'taken back',
    })).sort((x, y) => (x.book < y.book ? -1 : 1))

    const declared = report ? Number(report.books_back ?? 0) : null
    return {
      agentId: id,
      name: String(a.name ?? '') || id,
      phone: String(a.phone ?? ''),
      reported: !!report,
      reportedAt: report?.reported_at ?? null,
      declared,
      verified: counted.length,
      // Only meaningful once they have said something. Positive means books
      // they said were coming that nobody has counted in yet.
      shortBy: declared === null ? null : declared - counted.length,
      books: counted,
      stillOut: (outBy.get(id) ?? []).sort(),
    }
  }).filter((l) => l.reported || l.verified > 0 || l.stillOut.length > 0)

  return {
    round,
    since,
    lines: lines.sort((a, b) => (b.shortBy ?? -1) - (a.shortBy ?? -1)),
    // The one number an organiser is looking for.
    unaccounted: lines.reduce((n, l) => n + Math.max(0, l.shortBy ?? 0), 0),
  }
}

/* ============================ OFFERING BOOKS ============================
 *
 * issueBooks above puts books straight into a seller's hands. That is right in
 * exactly one situation: the seller ASKED for them, an organiser granted the
 * petition, and the grant runs issue_books. Consent is already on the record.
 *
 * When the organiser starts it, there is no consent yet, and until this existed
 * there was never going to be any. Typing a name made that person liable for
 * the money. So an organiser OFFERS, and the books sit reserved — on nobody's
 * balance, invisible to every money view — until the seller accepts.
 */

/**
 * ORGANISER: offer books to a seller. Reserves and moves nothing.
 */
export async function offerBooks(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Who are you offering them to?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name,phone').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)

  const idxs = await resolveBooks(ctx, p)
  const liveBooks = await activeBookLimit(ctx)

  // Checked before the write, so a range that is half unreleased offers nothing
  // rather than offering the front of it.
  const tooHigh = idxs.filter((i) => i > liveBooks)
  if (tooHigh.length) {
    throw new ApiError('BOOKS_NOT_AVAILABLE',
      `${tooHigh.length} of ${idxs.length} books have not been released yet. Nothing was changed.`,
      { blocked: tooHigh.map((i) => ({ book: i, status: 'not released yet', agentId: '' })) })
  }

  const dueAt = await defaultDueDate(ctx, p.dueDate)
  const finalDeadline = await configDate(ctx, 'FINAL_DEADLINE')
  if (finalDeadline && dueAt > finalDeadline) {
    throw new ApiError('DUE_AFTER_FINAL',
      `These books would be due back on ${dueAt}, after the final deadline of ` +
      `${finalDeadline}. Give them an earlier date, or move the final deadline first.`,
      { due: dueAt, finalDeadline })
  }

  const note = String(p.note ?? '')
  const { data: reserved, error } = await ctx.supabaseAdmin.rpc('offer_books_tx', {
    p_idxs: idxs, p_agent_id: agentId, p_due_at: dueAt, p_user: user.email, p_note: note,
  })
  if (error) {
    // The SQL names the books that are not free; passed through rather than
    // flattened to "some books are not available", because the organiser is
    // standing at a shelf and needs to know which ones.
    if (/BOOKS_NOT_FREE/.test(error.message)) {
      throw new ApiError('BOOKS_NOT_AVAILABLE', error.message.replace(/^.*BOOKS_NOT_FREE: /, ''))
    }
    throw new ApiError('QUERY_FAILED', error.message)
  }

  const books = (reserved ?? []) as Array<{ idx: number; number: string }>
  if (!books.length) throw new ApiError('NOTHING_TO_DO', 'None of those books were free to offer.')

  /*
   * THE BOOKS ARE RESERVED AND THE SELLER CANNOT YET ANSWER. If the queue row
   * fails to write, that state is permanent until somebody notices — reserved
   * stock with no way to accept it. So the reservation is undone rather than
   * left, and the organiser sees the failure and tries again.
   */
  try {
    const opened = await openOffer(ctx, user, agent, books, dueAt, note)
    return { offered: books.length, books: books.map((b) => b.number), dueAt, ...opened }
  } catch (e) {
    await ctx.supabaseAdmin.rpc('release_offer_tx', {
      p_idxs: books.map((b) => b.idx), p_user: user.email,
      p_reason: 'Offer could not be sent to the seller',
    })
    throw e
  }
}

/**
 * SELLER: accept books offered to you. Reached only through the approvals
 * queue, which has already checked that this offer is addressed to this person.
 */
export async function acceptOffer(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  const idxs = Array.isArray(p.idxs) ? p.idxs.map(Number).filter(Number.isFinite) : []
  if (!idxs.length) throw new ApiError('MISSING_FIELD', 'Which books?')

  /*
   * THE SELLER IS TAKEN FROM THE STORED OFFER AND CHECKED AGAINST WHO IS HERE.
   * decideApproval has already refused a row addressed to anybody else, and
   * this is the second lock: the payload is what reaches the SQL, and a payload
   * that disagreed with the caller would be an acceptance in somebody else's
   * name. accept_offer_tx refuses it a third time, from the row itself.
   */
  if (user.agentId && agentId && user.agentId !== agentId) {
    throw new ApiError('NOT_YOUR_DECISION', 'Those books were offered to somebody else.', null, 403)
  }

  const { data: taken, error } = await ctx.supabaseAdmin.rpc('accept_offer_tx', {
    p_idxs: idxs, p_agent_id: agentId, p_user: user.email, p_note: String(p.note ?? ''),
  })
  if (error) {
    if (/NOT_OFFERED_TO_YOU/.test(error.message)) {
      throw new ApiError('NOT_OFFERED_TO_YOU',
        'Those books are not waiting for you any more — the offer may have been ' +
        'withdrawn or run out of time.')
    }
    throw new ApiError('QUERY_FAILED', error.message)
  }

  const books = (taken ?? []) as Array<{ idx: number; number: string }>
  return { accepted: books.length, books: books.map((b) => b.number) }
}

/**
 * ORGANISER: take an offer back before the seller has answered.
 */
export async function withdrawOffer(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const requestId = String(p.requestId ?? '').trim()
  if (!requestId) throw new ApiError('MISSING_FIELD', 'Which offer?')

  const { data: r } = await ctx.supabaseAdmin
    .from('pending_approvals').select('*').eq('request_id', requestId).maybeSingle()
  if (!r) throw new ApiError('NOT_FOUND', 'No offer with that id.', null, 404)
  if (!r.decide_by_agent) throw new ApiError('NOTHING_TO_DO', 'That request is not an offer of books.')
  if (r.status !== 'Pending') {
    throw new ApiError('NOTHING_TO_DO', 'That offer has already been answered.')
  }

  const pay = (r.payload ?? {}) as { idxs?: unknown }
  const idxs = Array.isArray(pay.idxs) ? pay.idxs.map(Number).filter(Number.isFinite) : []

  // Books first. A cancelled row with the books still reserved is the failure
  // that hides itself; reserved books with a Pending row can at least be
  // withdrawn again.
  const { error } = await ctx.supabaseAdmin.rpc('release_offer_tx', {
    p_idxs: idxs, p_user: user.email, p_reason: 'The organiser withdrew the offer',
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('pending_approvals')
    .update({ status: 'Cancelled', decided_by: user.email, decided_at: new Date().toISOString(),
              note: String(p.note ?? '') })
    .eq('request_id', requestId)

  // Through this file's own audit helper rather than an inline literal. Both
  // are correct; only one of them keeps `action: '…'` in books.ts meaning
  // "a movement written into book_history", which is what tests/history.test.mjs
  // reads this file for. An audit verb sitting in that shape made the screen's
  // trail look like it was missing a translation it should never have had.
  await audit(ctx, 'OFFER_WITHDRAWN',
              { requestId, idxs, agentId: r.decide_by_agent }, user.email)
  return { requestId, status: 'Cancelled', released: idxs.length }
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

  /*
   * One transaction: the book comes back, the tickets held in it go back on the
   * shelf, and the trail records who brought it. Separately, the middle one
   * could be the statement that did not run — leaving tickets reserved for
   * buyers who never came, in a book sitting on the desk.
   */
  const { error } = await ctx.supabaseAdmin.rpc('return_books_tx', {
    p_idxs: idxs, p_user: user.email, p_note: String(p.note ?? ''),
  })
  if (error) throw new ApiError('QUERY_FAILED', error.message)


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
  /*
   * ONE TRANSACTION, and this is the one with money in it.
   *
   * Five statements ran here: read the live settlement payments, read which
   * were already reversed, write the reversals, clear the book, put its unsold
   * tickets back. A failure anywhere in the middle leaves the ledger and the
   * book disagreeing about the same cash — the reversal written and the figure
   * still on the book, or the figure cleared and the money still counted.
   *
   * The "already reversed" check is now inside the insert rather than a read
   * that happened first, so two restocks of the same book cannot both decide
   * they are the one that has to reverse it.
   */
  const { error: restockErr } = await ctx.supabaseAdmin.rpc('restock_books_tx', {
    p_idxs: ids, p_user: user.email, p_note: String(p.note ?? ''),
  })
  if (restockErr) throw new ApiError('QUERY_FAILED', restockErr.message)

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
 * MOVING TICKETS, WHICH IS WHAT A BOOK MOVE WILL EVENTUALLY BE MADE OF.
 *
 * The four operations above move a BOOK: they write `held_by_agent` and a
 * book_history row, and every ticket inside it is wherever the book is by
 * implication. That is why a part-sold book cannot be split — there is one
 * holder column for ten pieces of paper, and the only way to give three of them
 * to somebody else is to restock the whole book and lose its settlement.
 *
 * This is the other model, reachable for the first time: a movement per ticket,
 * with `tickets.holder` as a cache the ledger can re-derive. move_tickets in
 * SQL does the work — locks in index order, refuses unless every ticket is
 * where the caller says it is, writes one row per ticket under one batch, and
 * updates the projection in the same transaction.
 *
 * NOTHING ON ANY SCREEN CALLS THIS YET, deliberately. The picker that would use
 * it is client code, the client deploys on every push, and the backend is
 * frozen behind a deliberate hold — so a screen built now would be a dead one
 * sitting on the live site. The handler ships with the FUNCTION, which is
 * frozen too, so it changes nothing for anybody until the whole thing moves
 * together.
 *
 * WHY IT IS ADMIN-ONLY. Moving paper between people is what an organiser does;
 * a seller does not hand their own book to another seller without the office
 * knowing, and today's issue/transfer/return are all ADMIN_ONLY for that
 * reason. When the picker exists this may want to widen to a seller returning
 * their own stubs, and that is a decision to make with the screen rather than
 * in advance of it.
 */
const MOVE_KINDS = ['issue', 'return', 'transfer', 'restock', 'lost', 'found', 'correction']

export async function moveTickets(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const numbers = Array.isArray(p.ticketNumbers)
    ? p.ticketNumbers.map((n) => String(n).trim()).filter(Boolean)
    : []
  if (!numbers.length) throw new ApiError('MISSING_FIELD', 'Which tickets?')

  const kind = String(p.kind ?? '').trim()
  if (!MOVE_KINDS.includes(kind)) {
    throw new ApiError('BAD_REQUEST', `A movement is one of: ${MOVE_KINDS.join(', ')}.`)
  }

  /*
   * The desk is a holder like any other and is spelled 'desk', never blank and
   * never null — a blank holder is how "everything except X" gets into a query
   * that looked exhaustive. Both ends are named, or the movement is refused.
   */
  const from = String(p.fromHolder ?? '').trim()
  const to = String(p.toHolder ?? '').trim()
  if (!from || !to) throw new ApiError('MISSING_FIELD', 'A movement needs both ends named.')

  for (const who of [from, to]) {
    if (who === 'desk') continue
    const { data: agent } = await ctx.supabaseAdmin
      .from('agents').select('agent_id').eq('agent_id', who).maybeSingle()
    if (!agent) throw new ApiError('AGENT_NOT_FOUND', `There is no seller with the ID "${who}".`)
  }

  const { data: rows } = await ctx.supabaseAdmin
    .from('tickets').select('idx,number').in('number', numbers)
  const found = (rows ?? []) as Array<{ idx: number; number: string }>
  if (found.length !== numbers.length) {
    const have = new Set(found.map((r) => r.number))
    const missing = numbers.filter((n) => !have.has(n))
    throw new ApiError('TICKET_NOT_FOUND', `No such ticket: ${missing.slice(0, 5).join(', ')}.`,
      { missing })
  }

  const { data, error } = await ctx.supabaseAdmin.rpc('move_tickets', {
    p_ticket_idxs: found.map((r) => r.idx),
    p_from_holder: from,
    p_to_holder: to,
    p_kind: kind,
    p_user: user.email,
    p_reason: String(p.reason ?? ''),
    p_client_key: p.clientKey ? String(p.clientKey).slice(0, 100) : null,
  })
  if (error) {
    // NOT_THERE is the caller's premise being wrong about where the paper is,
    // which is a sentence a volunteer can act on, not a database error.
    const message = String(error.message ?? '')
    if (message.includes('NOT_THERE')) {
      throw new ApiError('NOT_THERE', message.replace(/^.*NOT_THERE: /, ''))
    }
    throw new ApiError('QUERY_FAILED', message)
  }

  const result = (data ?? {}) as { batch?: string; moved?: number; replayed?: boolean }
  if (!result.replayed) {
    await audit(ctx, 'MOVE_TICKETS',
      { count: result.moved, from, to, kind, tickets: numbers.slice(0, 20) }, user.email)
  }
  return {
    moved: Number(result.moved ?? 0),
    batch: String(result.batch ?? ''),
    replayed: !!result.replayed,
    from, to, kind,
  }
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
    ? await ctx.supabaseAdmin.from('agents').select('agent_id,name,zone,phone').in('agent_id', ids)
    : { data: [] }
  type Seller = { name: string; zone: string; phone: string }
  const info = new Map<string, Seller>((agents ?? []).map(
    (a: Record<string, unknown>) => [String(a.agent_id), {
      name: String(a.name ?? ''), zone: String(a.zone ?? ''), phone: String(a.phone ?? ''),
    }]))
  const names = new Map<string, string>(
    [...info].map(([id, a]) => [id, a.name]))

  /*
   * AND EVERY CHANGE TO A TICKET IN IT, from the trigger-written trail.
   *
   * The ticket row keeps only its latest state; the trail keeps what it was
   * before. WHO MAY READ THE BUYER IN IT is not a question this handler gets to
   * answer on its own: it is whoever may read that buyer on the ticket itself,
   * decided by seesBuyer in gate.ts, which is the same rule tickets_readable
   * applies in the database and mask() applies to every other read.
   *
   * It used to be `user.isAdmin` and nothing else, which was a fourth rule and
   * the wrong one in both directions. A seller carrying the book was shown the
   * buyer on the live ticket and a blank in its history — the same name, from
   * the same book, hidden on one screen and printed on the other; while an
   * ordinary viewer, who may read every buyer in the raffle, was shown none of
   * them here. A record nobody entitled to it can read is not a record.
   */
  const { data: trail } = await ctx.supabaseAdmin
    .from('ticket_history').select('*').eq('book_idx', book.idx).order('at')
  const { data: ticketRows } = await ctx.supabaseAdmin
    .from('tickets').select('idx,number,recorded_by').eq('book_idx', book.idx)
  const numberOf = new Map((ticketRows ?? []).map((t: { idx: number; number: string }) => [Number(t.idx), t.number]))
  // A helper's claim is on the sales THEY wrote down, so the trail has to ask
  // the ticket who that is now — the history row's own by_user is who made that
  // one change, which is a different question.
  const wroteIt = new Map((ticketRows ?? []).map(
    (t: { idx: number; recorded_by?: string }) => [Number(t.idx), String(t.recorded_by ?? '')]))
  for (const h of (trail ?? []) as Array<Record<string, unknown>>) {
    for (const k of ['from_agent', 'to_agent']) if (h[k]) ids.push(String(h[k]))
  }
  const extra = ids.filter((id) => !names.has(id))
  if (extra.length) {
    const { data: more } = await ctx.supabaseAdmin
      .from('agents').select('agent_id,name,zone,phone').in('agent_id', [...new Set(extra)])
    for (const a of (more ?? []) as Array<Record<string, unknown>>) {
      const id = String(a.agent_id)
      info.set(id, { name: String(a.name ?? ''), zone: String(a.zone ?? ''), phone: String(a.phone ?? '') })
      names.set(id, String(a.name ?? ''))
    }
  }
  const holds = await agentBooks(user, ctx)
  const showBuyer = (ticketIdx: unknown) =>
    seesBuyer({ book_idx: book.idx, recorded_by: wroteIt.get(Number(ticketIdx)) }, user, holds)
  // Shortened for a viewer exactly as mask() shortens the live one. A number
  // printed in full here would undo that masking through the history door.
  const phone = (v: unknown) => (user.role === 'viewer' ? shortPhone(v) : String(v ?? ''))
  const who = (id: unknown) => (id ? (names.get(String(id)) ?? String(id)) : null)

  /*
   * WHO HAD IT, AS A PERSON RATHER THAN A NAME.
   *
   * A name on its own is not enough to act on. Two sellers are called JOHN, and
   * the one a volunteer means is the JOHN from their own church — so the zone
   * travels with the name and the screen can say "Josh (CCFM)", which is how
   * people refer to each other here anyway.
   *
   * THE TELEPHONE NUMBER IS NOT FOR EVERYBODY. Whoever is holding the book next
   * should know who had it before them; they should not be handed a directory
   * of every seller's number as a side effect of looking at a history. So the
   * number is filled in for an organiser and the system admin — the people
   * whose job is chasing — and left empty for everyone else, and the screen
   * makes the name contactable only when there is something to contact.
   *
   * ADDED BESIDE `from`/`to` RATHER THAN REPLACING THEM. The bare names are
   * what the existing trail renders, and a shape change here would break that
   * screen at the same moment this one starts using it.
   */
  const person = (id: unknown) => {
    if (!id) return null
    const a = info.get(String(id))
    return {
      id: String(id),
      name: a?.name ?? String(id),
      zone: a?.zone ?? '',
      phone: user.isAdmin ? (a?.phone ?? '') : '',
    }
  }

  return {
    book: { number: book.number, status: book.status },
    history: (data ?? []).map((h: Record<string, unknown>) => ({
      at: h.at,
      action: h.action,
      from: h.from_agent ? (names.get(String(h.from_agent)) ?? h.from_agent) : null,
      to: h.to_agent ? (names.get(String(h.to_agent)) ?? h.to_agent) : null,
      fromWho: person(h.from_agent),
      toWho: person(h.to_agent),
      by: h.by_user,
      note: h.note || '',
    })),
    tickets: (trail ?? []).map((h: Record<string, unknown>) => {
      const sees = showBuyer(h.ticket_idx)
      return {
        at: h.at,
        ticket: numberOf.get(Number(h.ticket_idx)) ?? String(h.ticket_idx),
        fromStatus: h.from_status ?? '',
        toStatus: h.to_status ?? '',
        fromSeller: who(h.from_agent),
        toSeller: who(h.to_agent),
        fromSellerWho: person(h.from_agent),
        toSellerWho: person(h.to_agent),
        fromBuyer: sees ? (h.from_buyer ?? '') : '',
        toBuyer: sees ? (h.to_buyer ?? '') : '',
        fromPhone: sees ? phone(h.from_phone) : '',
        toPhone: sees ? phone(h.to_phone) : '',
        fromAmount: h.from_amount ?? null,
        toAmount: h.to_amount ?? null,
        // Money state, not buyer detail: the ticket shows Paid/Unpaid to every
        // role, so its record does too. Without these a row whose only change
        // was "marked paid" renders as a step where nothing happened.
        fromPayment: h.from_payment ?? '',
        toPayment: h.to_payment ?? '',
        source: h.source ?? '',
        by: h.by_user ?? '',
        // The ticket's own note, which is a note ABOUT THE BUYER — masked with
        // them by mask(), and masked with them here. (The book's note, above,
        // is an organiser writing down why a book moved.)
        note: sees ? (h.note ?? '') : '',
      }
    }),
  }
}

// ============ THE SELLER'S OWN REPORT ============
/**
 * WHAT A SELLER COULD DO IN THIS APP BEFORE THIS, at the moment that matters
 * most: nothing. They carry the books, they hold the stubs and the cash, and
 * the checkpoint they are given a date for is something that happens TO them —
 * an organiser types their figures into a screen the seller never sees, from
 * numbers read out over a telephone or remembered from a car park. The one
 * record of what the seller actually said is written by somebody else, after
 * the fact, in the seller's absence.
 *
 * So: the seller prepares the report, the organiser accepts it, and the
 * acceptance is what writes. Nothing the seller submits changes a book, a
 * ticket or a figure until somebody on the other side of the table says yes.
 * That is not a new mechanism — it is `pending_approvals`, the same queue a
 * seller already asks for books through, and a petition runs as the APPROVER
 * because returning and counting in are the organiser's acts and always were.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * A DAILY JOB THAT PREPARES IT. It was asked for and it is the wrong shape: a
 * report built at 6am is wrong by lunchtime, and this system has no scheduler
 * (round_snapshots says so in the schema, and says why). The draft is built
 * from live rows the moment the seller opens the screen, which is the same
 * promise — "it is ready, just check it" — without a copy that can go stale or
 * a job that can fail quietly at the weekend.
 *
 * MONEY THAT POSTS ITSELF. The cash is a single hand-over recorded against the
 * seller, not a figure invented per book, and it is written only when an
 * organiser presses Accept with the sentence in front of them saying what it
 * will record. A raffle where a tap on a phone creates money rows for cash
 * nobody is holding is a raffle whose ledger means nothing.
 */

/** What the seller is about to be asked to confirm, built from live rows. */
export async function reportDraft(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const own = String(user.agentId ?? '').trim()
  const asked = String(p.agentId ?? '').trim()
  const staff = user.isAdmin || user.role === 'recorder'
  if (asked && asked !== own && !staff) {
    throw new ApiError('NOT_YOURS', 'That is somebody else\'s report.')
  }
  const agentId = staff ? (asked || own) : own
  if (!agentId) {
    throw new ApiError(
      'NOT_A_SELLER',
      'Reports are made by sellers, and your account is not linked to one. ' +
      'An organiser can link it on the People screen.',
    )
  }

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No seller with the ID "${agentId}".`, null, 404)

  const { data: cfgRows } = await ctx.supabaseAdmin
    .from('config').select('key,value').in('key', ['TICKET_PRICE', 'CURRENCY'])
  const cfg = Object.fromEntries((cfgRows ?? []).map(
    (r: { key: string; value: string }) => [r.key, r.value]))
  const price = Number(cfg.TICKET_PRICE || 10) || 10

  const round = await checkInRound(ctx)
  const checkIn = await configDate(ctx, 'CHECK_IN_DATE')

  // Already answered this round? The draft still builds — a seller who comes
  // back with more is the case recordCheckIn is written to accept — but the
  // screen has to say so rather than let somebody report twice by accident.
  const { data: already } = await ctx.supabaseAdmin
    .from('check_in_reports').select('reported_at,books_back,amount_paid')
    .eq('agent_id', agentId).eq('round', round).is('undone_at', null).maybeSingle()

  const { data: held } = await ctx.supabaseAdmin
    .from('books').select('idx,number,first_ticket,last_ticket,due_at,status')
    .eq('held_by_agent', agentId).eq('status', 'Out').order('idx')

  /*
   * WHAT THEY HAVE ALREADY REPORTED AND NOBODY HAS ACCEPTED.
   *
   * Sending a report changes nothing, so those books are still Out and still
   * here — and a seller opening this screen a second time would be shown them
   * exactly as before, with no sign they had already said anything. Two reports
   * naming the same book is not dangerous (the second finds the work done and
   * says so) but it is confusing at the moment somebody is trying to be
   * careful, which is the wrong moment to confuse them.
   */
  const { data: waiting } = await ctx.supabaseAdmin
    .from('pending_approvals').select('payload')
    .eq('action', 'report_back').eq('status', 'Pending')
  const alreadyReported = new Set<string>()
  for (const r of (waiting ?? []) as Array<Record<string, unknown>>) {
    const payload = (r.payload ?? {}) as Record<string, unknown>
    if (String(payload.agentId ?? '') !== agentId) continue
    for (const line of (Array.isArray(payload.books) ? payload.books : []) as Array<Record<string, unknown>>) {
      const n = String(line.book ?? '').trim()
      if (n) alreadyReported.add(n)
    }
  }

  const idxs = (held ?? []).map((b: { idx: number }) => Number(b.idx))
  const { data: tickets } = idxs.length
    ? await ctx.supabaseAdmin.from('tickets')
        .select('idx,number,book_idx,status').in('book_idx', idxs).order('idx')
    : { data: [] }

  const inBook = new Map<number, Array<Record<string, unknown>>>()
  for (const t of (tickets ?? []) as Array<Record<string, unknown>>) {
    const k = Number(t.book_idx)
    if (!inBook.has(k)) inBook.set(k, [])
    inBook.get(k)!.push(t)
  }

  const SOLD = ['Sold', 'Donated']
  const books = (held ?? []).map((b: Record<string, unknown>) => {
    const rows = inBook.get(Number(b.idx)) ?? []
    const sold = rows.filter((t) => SOLD.includes(String(t.status)))
    const unsold = rows.filter((t) => !SOLD.includes(String(t.status)) && String(t.status) !== 'Void')
    return {
      book: String(b.number),
      firstTicket: String(b.first_ticket ?? ''),
      lastTicket: String(b.last_ticket ?? ''),
      due: b.due_at ?? null,
      held: rows.length,
      recordedSold: sold.length,
      unsoldNumbers: unsold.map((t) => String(t.number)),
      /*
       * WHAT THE SCREEN SHOULD SUGGEST, and it is only a suggestion.
       *
       * A book with nothing written down in it is one the seller either never
       * opened or sold from without recording — the first is a bring-back, and
       * the second is why the seller gets to change it. A book with sales in it
       * is one to count in, because the money on it has to be reconciled before
       * anybody else can carry it.
       */
      suggest: sold.length ? 'count' : 'return',
      inReport: alreadyReported.has(String(b.number)),
    }
  })

  const expected = books.reduce((n, b) => n + b.recordedSold * price, 0)

  // What they have already handed over, so the money box does not ask for it
  // twice. Reversals are negative rows and net themselves out.
  const { data: paid } = await ctx.supabaseAdmin
    .from('payments').select('amount').eq('agent_id', agentId)
  const collected = (paid ?? []).reduce(
    (n: number, r: { amount: number }) => n + Number(r.amount ?? 0), 0)

  return {
    agentId,
    agentName: String((agent as { name?: string }).name ?? agentId),
    round,
    checkInDate: checkIn,
    // The date on the paper they were given, which is the one they remember.
    dueBy: books.reduce((soonest: string, b) => {
      const d = String(b.due ?? '')
      return d && (!soonest || d < soonest) ? d : soonest
    }, ''),
    currency: String(cfg.CURRENCY ?? ''),
    ticketPrice: price,
    books,
    booksOut: books.length,
    recordedSold: books.reduce((n, b) => n + b.recordedSold, 0),
    ticketsHeld: books.reduce((n, b) => n + b.held, 0),
    expected,
    collected,
    // What the figures say is outstanding, which is what the money box starts at.
    owed: Math.round((expected - collected) * 100) / 100,
    alreadyReported: already
      ? { at: already.reported_at, booksBack: already.books_back, amountPaid: already.amount_paid }
      : null,
  }
}

/**
 * The accepted report, carried out.
 *
 * RUNS AS THE ORGANISER WHO ACCEPTED IT — see PETITIONS in approvals.ts.
 * Bringing a book back and counting one in are organiser acts; re-checking them
 * against the seller who asked would refuse every report at the moment it was
 * granted, which is the worst place to find out.
 *
 * ORDER MATTERS AND IT IS THE ORDER OF THE TABLE. The books come back first,
 * because a book must be on the desk before it can be counted in. Then each
 * book named for counting is counted, with the stubs the seller listed. Then
 * the money, as one hand-over — not split across books, because the seller
 * hands over one envelope and inventing a per-book share of it would be putting
 * a figure in the ledger that nobody counted.
 *
 * WHAT IS REFUSED RATHER THAN SKIPPED: a book that is not theirs, or is not out
 * with them any more. A report is judged against the rows as they are NOW, not
 * as they were when it was written, and half of it landing is worse than none.
 */
export async function reportBack(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Which seller is this report from?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No seller with the ID "${agentId}".`, null, 404)
  const who = String((agent as { name?: string }).name ?? agentId)

  const lines = (Array.isArray(p.books) ? p.books : []) as Array<Record<string, unknown>>
  const named = lines.map((l) => String(l.book ?? '').trim()).filter(Boolean)

  const { data: rows } = named.length
    ? await ctx.supabaseAdmin.from('books')
        .select('idx,number,status,held_by_agent').in('number', named)
    : { data: [] }
  const byNumber = new Map((rows ?? []).map(
    (b: Record<string, unknown>) => [String(b.number), b]))

  /*
   * ALREADY DONE IS NOT A CONFLICT, and getting that wrong cost a real evening.
   *
   * This refused the whole report if any book was not still Out — which is
   * right for a book that has gone somewhere ELSE, and wrong for one that is
   * already where this report was trying to put it. The two were treated the
   * same, and the combination is a trap:
   *
   *   this handler makes several writes and is not one transaction. A failure
   *   part way through leaves some books moved and the request still Pending.
   *   The organiser then cannot accept it — the moved books read as stale — and
   *   declining leaves the books where the half-run left them. Reported from
   *   the live raffle as "the book status was not preserved, it was mutated,
   *   and after the report was rejected the seller cannot sell that book".
   *
   * So a book that is already SETTLED when the report asked for it to be
   * counted in, or already RETURNED when the report asked for it to come back,
   * is skipped and named in the result. Accepting the same report again
   * finishes what is left, which is what somebody will try and what used to be
   * impossible. A book that is Lost, Void, or with a different seller is still
   * refused outright, and refuses the whole report with it.
   */
  const wrong: string[] = []
  const done: string[] = []
  const todo: Array<Record<string, unknown>> = []
  for (const line of lines) {
    const n = String(line.book ?? '').trim()
    if (!n) continue
    const b = byNumber.get(n) as Record<string, unknown> | undefined
    const want = String(line.action)
    if (!b) { wrong.push(`${n} does not exist`); continue }

    const status = String(b.status)
    // Where it already is what the report wanted, nothing is owed and nothing
    // is wrong. held_by_agent survives both moves, so the book is still known
    // to be theirs even though it is no longer Out.
    if ((want === 'count' && status === 'Settled') ||
        (want === 'return' && (status === 'Returned' || status === 'Settled'))) {
      done.push(n)
      continue
    }
    if (String(b.held_by_agent ?? '') !== agentId) { wrong.push(`${n} is not with ${who}`); continue }
    if (status !== 'Out') { wrong.push(`${n} is ${status.toLowerCase()} now`); continue }
    todo.push(line)
  }
  if (wrong.length) {
    throw new ApiError(
      'REPORT_STALE',
      `This report no longer matches the books: ${wrong.join(', ')}. ` +
      'Nothing was changed. Ask them to send it again.',
      { books: wrong },
    )
  }

  const returning = todo.filter((l) => String(l.action) === 'return').map((l) => String(l.book))
  const counting = todo.filter((l) => String(l.action) === 'count')

  /*
   * 1. COUNTED IN FIRST, AND STRAIGHT FROM THE SELLER'S HANDS.
   *
   * This used to bring every book back and then count in the ones that needed
   * it — two steps where one does, because settle_book has always accepted a
   * book that is still Out. That is the ordinary count-in: a seller stands
   * there with the book and the organiser counts it.
   *
   * The order is the difference between a half-run leaving a mess and a half-run
   * leaving the rest alone. Each settle_book is one transaction in the database,
   * so a book is either counted in or untouched; anything this loop has not
   * reached is still Out with the seller, exactly as it was, and the report can
   * be accepted again to finish it.
   */
  const counted: Array<Record<string, unknown>> = []
  for (const line of counting) {
    const r = await settleBook({
      bookNumber: String(line.book),
      unsoldTickets: Array.isArray(line.unsold) ? line.unsold.map(String) : [],
      amountPaid: 0,
      note: `Counted in from ${who}'s report`,
    }, user, ctx) as Record<string, unknown>
    counted.push({ book: String(line.book), sold: r.declaredSold, due: r.amountDue })
  }

  // 2. And the rest come back to the desk, in one statement.
  if (returning.length) {
    await returnBooks({ bookNumbers: returning, note: `Reported back by ${who}` }, user, ctx)
  }
  const coming = [...returning, ...counting.map((l) => String(l.book)), ...done]

  // 3. The cash, as one hand-over against the seller. `record_payment` is the
  //    existing door for money that is not tied to one book, and it is the
  //    right one: the seller handed over an envelope, not ten envelopes.
  const handed = Number(p.amountHanded ?? 0) || 0
  let payment: unknown = null
  if (handed > 0) {
    payment = await recordPayment({
      agentId, amount: handed, method: String(p.method ?? 'cash'),
      // The ledger says which figure this is. A row that reads "handed in with
      // their report" when the approver counted something else is the ledger
      // quoting the claim as though it were the count.
      note: (p.declared && Number((p.declared as Record<string, unknown>).amountHanded ?? 0) !== handed)
        ? 'Counted at the table with their report'
        : 'Handed in with their report',
    }, user, ctx)
  }

  /*
   * 4. And the declaration itself — what the seller SAID, beside what the rows
   *    now show. This is the half `return_check` compares, and the half nothing
   *    else records.
   *
   *    WHERE THE APPROVER COUNTED SOMETHING DIFFERENT, BOTH FIGURES GO IN. The
   *    numbers stored are what was actually counted, because those are what the
   *    ledger and the chase list have to agree with. The claim is written into
   *    the note in words — "they said 180, counted 170" — so the difference is
   *    on the check-in sheet an organiser prints, rather than only in an audit
   *    row nobody opens. `declared` is set by decideApproval and by nothing
   *    else; a direct call has no such field and this whole branch is skipped.
   */
  const declared = (p.declared ?? null) as Record<string, unknown> | null
  const gaps: string[] = []
  if (declared) {
    const said = (k: string) => Number(declared[k] ?? 0)
    const got = (k: string) => Number(p[k] ?? 0) || 0
    if (said('amountHanded') !== got('amountHanded')) {
      gaps.push(`they said ${said('amountHanded')} and ${got('amountHanded')} was counted`)
    }
    if (said('stubsReturned') !== got('stubsReturned')) {
      gaps.push(`they said ${said('stubsReturned')} stubs and ${got('stubsReturned')} were counted`)
    }
    if (said('unsoldReturned') !== got('unsoldReturned')) {
      gaps.push(`they said ${said('unsoldReturned')} unsold and ${got('unsoldReturned')} came back`)
    }
  }
  const note = [String(p.note ?? '').trim(), gaps.length ? `Counted at the table: ${gaps.join('; ')}.` : '']
    .filter(Boolean).join(' ')

  await recordCheckIn({
    agentId,
    booksBack: coming.length,
    ticketsSold: Number(p.ticketsSold ?? 0) || 0,
    amountPaid: handed,
    stubsReturned: Number(p.stubsReturned ?? 0) || 0,
    unsoldReturned: Number(p.unsoldReturned ?? 0) || 0,
    note,
  }, user, ctx)

  await audit(ctx, 'REPORT_BACK', {
    agent: agentId, returned: returning.length, counted: counted.length, handed,
  }, user.email)

  return {
    agentId, agentName: who,
    returned: returning, counted, handed, payment,
    // Named rather than silently folded in: an organiser who accepts a report
    // and is told "3 books" when they handed over two wants to know which one
    // the app had already dealt with.
    alreadyDone: done,
    books: coming,
  }
}
