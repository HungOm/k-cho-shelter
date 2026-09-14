/**
 * Agents and users — ported from People.gs.
 *
 * An AGENT is somebody who carries books: a name and a phone number, no account,
 * nothing to set up, so you can hand books to someone the day you meet them.
 * A USER is somebody who signs in. Most agents never become users.
 *
 * THE RULES THAT MUST NOT SOFTEN IN THE PORT
 *
 * Only the super admin may mint an admin, alter an existing admin, or touch the
 * super admin's own row. Without that the tree has no top: any admin could
 * promote a second admin, and the first toggle that goes wrong leaves nobody
 * able to undo it.
 *
 * And the super admin is never listed to anybody else. Not the row, not the
 * address. An ordinary admin can do nothing with it here, and the account above
 * you is the one worth attacking.
 */
import { ApiError, isSuperAdminEmail, requireSuperAdmin, type AppUser, type Role } from './gate.ts'

type Ctx = { supabaseAdmin: { from: (t: string) => any } }

const VALID_ROLES: Role[] = ['admin', 'recorder', 'agent', 'viewer']

async function audit(ctx: Ctx, action: string, details: unknown, email: string) {
  await ctx.supabaseAdmin.from('audit_log').insert({ action, details, email })
}

// ============ AGENTS ============

export async function listAgents(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('agents').select('*').order('agent_id')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  // A view-only account never sees a contact number, the same rule the tickets
  // follow. An agent's phone is how you chase a book that has not come back,
  // which is exactly why it is worth withholding from somebody who only reads.
  const rows = (data ?? []).map((a: Record<string, unknown>) =>
    user.role === 'viewer' ? { ...a, phone: '' } : a)
  return { agents: rows }
}

export async function upsertAgent(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const name = String(p.name ?? '').trim()
  if (!name) throw new ApiError('MISSING_FIELD', 'A name is required.')

  const agentId = String(p.agentId ?? '').trim().toUpperCase()
  const phone = String(p.phone ?? '').replace(/[^\d+]/g, '')

  if (agentId) {
    const { data, error } = await ctx.supabaseAdmin
      .from('agents')
      .update({ name, phone, zone: String(p.zone ?? ''), active: p.active !== false })
      .eq('agent_id', agentId).select().maybeSingle()
    if (error) throw new ApiError('QUERY_FAILED', error.message)
    if (!data) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)
    await audit(ctx, 'UPDATE_AGENT', { agentId, name }, user.email)
    return { agentId, updated: true }
  }

  // A new id, allocated from the highest existing one rather than a count —
  // counting breaks the moment anybody is ever deleted, and reusing a retired
  // id would attach an old book history to a new person.
  const { data: last } = await ctx.supabaseAdmin
    .from('agents').select('agent_id').order('agent_id', { ascending: false }).limit(1).maybeSingle()
  const nextNum = last ? parseInt(String(last.agent_id).replace(/\D/g, ''), 10) + 1 : 1
  const newId = 'A' + String(nextNum).padStart(3, '0')

  const { error } = await ctx.supabaseAdmin
    .from('agents').insert({
      agent_id: newId, name, phone, zone: String(p.zone ?? ''), active: true,
    })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, 'CREATE_AGENT', { agentId: newId, name }, user.email)
  return { agentId: newId, created: true }
}

// ============ USERS ============

export async function listUsers(_p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const { data, error } = await ctx.supabaseAdmin
    .from('app_users').select('email,name,role,active,agent_id,added_by,added_at').order('email')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  const superEmail = Deno.env.get('SUPER_ADMIN_EMAIL')?.trim().toLowerCase() ?? ''
  const out = []
  for (const r of data ?? []) {
    const email = String(r.email).trim().toLowerCase()
    const rowIsSuper = !!superEmail && email === superEmail
    if (rowIsSuper && !user.isSuperAdmin) continue      // not shown at all
    out.push({
      email, name: r.name, role: r.role, active: r.active,
      agentId: r.agent_id ?? '', addedBy: r.added_by, addedDate: r.added_at,
      isYou: email === user.email,
      isSuperAdmin: rowIsSuper,
    })
  }

  return {
    users: out,
    youAreSuperAdmin: !!user.isSuperAdmin,
    superAdmin: user.isSuperAdmin ? superEmail : '',
  }
}

export async function upsertUser(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  // Checked before anything is validated: an organiser who may not do this at
  // all should be told that, not told which field they forgot.
  requireSuperAdmin(user, 'Adding or changing who can sign in')

  const email = String(p.email ?? '').trim().toLowerCase()
  const role = String(p.role ?? 'viewer').toLowerCase() as Role

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError('BAD_REQUEST', 'That does not look like an email address.')
  }
  if (!VALID_ROLES.includes(role)) {
    throw new ApiError('BAD_REQUEST', 'Role must be one of: ' + VALID_ROLES.join(', '))
  }
  if (role === 'agent' && !p.agentId) {
    throw new ApiError('MISSING_FIELD', 'An agent user must be linked to an Agent_ID.')
  }

  const { data: existing } = await ctx.supabaseAdmin
    .from('app_users').select('email,role').eq('email', email).maybeSingle()

  // The three that keep the top of the tree where it is.
  // WHO MAY SIGN IN, AND AS WHAT, IS THE SUPER ADMIN'S ALONE.
  //
  // An organiser who can hand out roles can hand one to themselves, or to a
  // friendly account they then sign in as — which makes "only the super admin
  // decides who is an organiser" a rule that lasts exactly as long as nobody
  // tries. Organisers run the raffle; they do not decide who else runs it.
  //
  // Managing SELLERS is a different thing and stays with organisers: adding,
  // banning and deactivating an agent is the daily work of running the raffle,
  // and an agent record grants nobody any access to this system.
  if (isSuperAdminEmail(email, Deno.env)) requireSuperAdmin(user, 'Changing the super admin account')

  if (p.agentId) {
    const { data: agent } = await ctx.supabaseAdmin
      .from('agents').select('agent_id').eq('agent_id', String(p.agentId)).maybeSingle()
    if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${p.agentId}".`, null, 404)
  }

  const row = {
    email, name: String(p.name ?? email), role,
    active: p.active === undefined ? true : !!p.active,
    agent_id: p.agentId ? String(p.agentId) : null,
    added_by: user.email,
  }

  const { error } = await ctx.supabaseAdmin
    .from('app_users').upsert(row, { onConflict: 'email' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, existing ? 'UPDATE_USER' : 'CREATE_USER', { email, role }, user.email)
  return existing ? { email, updated: true } : { email, created: true }
}

export async function setUserStatus(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const email = String(p.email ?? '').trim().toLowerCase()
  if (p.active === undefined) throw new ApiError('MISSING_FIELD', 'active is required.')

  // Checked first, and before the row lookup, because the super admin need not
  // have a row at all — and the refusal should read the same whoever asks,
  // including the super admin themselves.
  if (isSuperAdminEmail(email, Deno.env)) {
    throw new ApiError(
      'SUPER_ADMIN_ONLY',
      'The super admin account cannot be enabled or disabled from the app. ' +
        'Change SUPER_ADMIN_EMAIL in the function secrets instead.',
    )
  }

  // Locking yourself out of your own system is a support call you cannot make.
  if (email === user.email && !p.active) {
    throw new ApiError('BAD_REQUEST', 'You cannot disable your own account.')
  }

  const { data: existing } = await ctx.supabaseAdmin
    .from('app_users').select('email,role').eq('email', email).maybeSingle()
  if (!existing) {
    throw new ApiError('USER_NOT_FOUND', `${email} is not on the access list.`, null, 404)
  }
  // An organiser may switch a SELLER's sign-in off — a lost phone at a Sunday
  // service should not wait for the super admin to wake up. Anything above a
  // seller is a privilege decision and goes to the super admin.
  if (existing.role !== 'agent') {
    requireSuperAdmin(user, 'Enabling or disabling anybody but a seller')
  }

  const { error } = await ctx.supabaseAdmin
    .from('app_users').update({ active: !!p.active }).eq('email', email)
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, p.active ? 'ENABLE_USER' : 'DISABLE_USER', { email }, user.email)
  return { email, active: !!p.active }
}

// ============ ACCESS CONTROL ============

export async function listPermissions(_p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const { data } = await ctx.supabaseAdmin.from('permissions').select('action,role,allowed')
  const current: Record<string, Record<string, boolean>> = {}
  for (const r of data ?? []) (current[r.action] ??= {})[r.role] = r.allowed
  return { roles: VALID_ROLES, overrides: current }
}

export async function setPermission(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  const action = String(p.action ?? '').trim()
  const role = String(p.role ?? '').trim().toLowerCase() as Role
  if (p.allowed === undefined) {
    throw new ApiError('MISSING_FIELD', 'allowed is required (true or false).')
  }
  if (!VALID_ROLES.includes(role)) {
    throw new ApiError('BAD_REQUEST', 'Role must be one of: ' + VALID_ROLES.join(', '))
  }

  const { error } = await ctx.supabaseAdmin
    .from('permissions')
    .upsert({ action, role, allowed: !!p.allowed }, { onConflict: 'action,role' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await audit(ctx, 'SET_PERMISSION', { action, role, allowed: !!p.allowed }, user.email)
  return { action, role, allowed: !!p.allowed }
}

// ============ HOW MANY TICKETS ARE IN PLAY ============

/**
 * Move the line between tickets that exist and tickets that are in play.
 *
 * The raffle prints its ceiling once — twenty thousand numbered stubs — and
 * releases them in phases. Only what is in play is fetched, sold, or drawn, so
 * this one number decides how much of the raffle is live.
 *
 * PULLING THE LINE BACK IS THE DANGEROUS DIRECTION and most of this function is
 * about refusing to do it carelessly. A ticket above the line is not deleted,
 * it is hidden — so holding back a ticket somebody has already paid for does
 * not undo the sale, it conceals it, and the buyer turns up on draw day holding
 * a number the system says is not in the raffle.
 */
export async function setActiveTickets(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  requireSuperAdmin(user, 'Releasing or holding back tickets')

  const { data: cfgRows } = await ctx.supabaseAdmin.from('config').select('key,value')
  const cfg: Record<string, string> = {}
  for (const r of cfgRows ?? []) cfg[String(r.key)] = String(r.value ?? '')

  const n = (k: string, d: number) => parseInt(cfg[k] ?? '', 10) || d
  const generated = n('TOTAL_TICKETS', 0)
  const per = n('TICKETS_PER_BOOK', 10)
  const activeRaw = n('ACTIVE_TICKETS', 0)
  const current = activeRaw <= 0 || activeRaw > generated ? generated : activeRaw

  const target = parseInt(String(p.activeTickets ?? ''), 10)
  if (isNaN(target) || target < 1) {
    throw new ApiError('BAD_REQUEST', 'activeTickets must be a whole number of at least 1.')
  }
  if (target === current) {
    throw new ApiError('NO_CHANGE', `${current} tickets are already in play.`)
  }
  if (target > generated) {
    throw new ApiError(
      'NOT_GENERATED',
      `Only ${generated} tickets have been created, so ${target} cannot be put into play.`,
      { generated, requested: target },
    )
  }
  // A book is one physical object. Half a book in play would mean a seller
  // holding paper where some stubs record a sale and some refuse.
  if (target % per !== 0 && target !== generated) {
    throw new ApiError(
      'PARTIAL_BOOK',
      `${target} is not a whole number of books of ${per}. Choose a multiple of ${per} ` +
      'so no book is half in play.',
    )
  }

  if (target < current) {
    // Anything sold, donated or held above the new line.
    const { data: spoken } = await ctx.supabaseAdmin
      .from('tickets').select('number,status')
      .gt('idx', target).lte('idx', current)
      .in('status', ['Sold', 'Donated', 'Reserved'])
      .order('idx').limit(6)

    if (spoken?.length) {
      const examples = spoken.map((t: { number: string; status: string }) =>
        `${t.number} (${String(t.status).toLowerCase()})`)
      throw new ApiError(
        'TICKETS_IN_USE',
        `Tickets above ${target} are already spoken for — ${examples.join(', ')}. ` +
        'Holding them back would hide them rather than undo them, so it is refused.',
        { examples },
      )
    }

    // And any book above the line that has left the office.
    const { data: books } = await ctx.supabaseAdmin
      .from('books').select('number,status')
      .gt('idx', Math.floor(target / per))
      .lte('idx', Math.ceil(current / per))
      .neq('status', 'Unassigned')
      .order('idx').limit(6)

    if (books?.length) {
      const examples = books.map((b: { number: string; status: string }) =>
        `${b.number} (${String(b.status).toLowerCase()})`)
      throw new ApiError(
        'BOOKS_IN_USE',
        `Books above ${target} are out or already counted — ${examples.join(', ')}. ` +
        'Take them back before holding those tickets back.',
        { examples },
      )
    }
  }

  const { error } = await ctx.supabaseAdmin
    .from('config').update({ value: String(target) }).eq('key', 'ACTIVE_TICKETS')
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_ACTIVE_TICKETS',
    details: { from: current, to: target, generated }, email: user.email,
  })

  return {
    from: current, to: target, generated,
    heldBack: generated - target,
    activeBooks: Math.ceil(target / per),
    released: target > current ? target - current : 0,
    pulledBack: target < current ? current - target : 0,
  }
}

/**
 * The paper trail for handing books over: what went out, to whom, and by when.
 * A read, so it needs no guards of its own beyond the registry's.
 */
export async function handoverReceipt(p: Record<string, unknown>, _u: AppUser, ctx: Ctx) {
  const agentId = String(p.agentId ?? '').trim()
  if (!agentId) throw new ApiError('MISSING_FIELD', 'Which seller?')

  const { data: agent } = await ctx.supabaseAdmin
    .from('agents').select('agent_id,name,phone,zone').eq('agent_id', agentId).maybeSingle()
  if (!agent) throw new ApiError('AGENT_NOT_FOUND', `No agent with ID "${agentId}".`, null, 404)

  const { data: books } = await ctx.supabaseAdmin
    .from('books').select('number,first_ticket,last_ticket,status,issued_at,due_at')
    .eq('held_by_agent', agentId).eq('status', 'Out').order('idx')

  const { data: cfgRows } = await ctx.supabaseAdmin
    .from('config').select('key,value').in('key', ['TICKET_PRICE', 'CURRENCY', 'EVENT_NAME', 'ORG_NAME'])
  const cfg: Record<string, string> = {}
  for (const r of cfgRows ?? []) cfg[String(r.key)] = String(r.value ?? '')

  const price = Number(cfg.TICKET_PRICE ?? 10)
  const { data: counted } = await ctx.supabaseAdmin
    .from('book_ledger_all').select('number,counted_sold').eq('held_by_agent', agentId)
  const perBook = new Map((counted ?? []).map((b: { number: string; counted_sold: number }) =>
    [b.number, Number(b.counted_sold ?? 0)]))

  const list = (books ?? []).map((b: Record<string, unknown>) => ({
    book: b.number,
    firstTicket: b.first_ticket,
    lastTicket: b.last_ticket,
    issued: b.issued_at,
    due: b.due_at,
    soldSoFar: perBook.get(String(b.number)) ?? 0,
  }))

  return {
    agent: { id: agent.agent_id, name: agent.name, phone: agent.phone, zone: agent.zone },
    books: list,
    bookCount: list.length,
    ticketPrice: price,
    currency: cfg.CURRENCY ?? 'RM',
    eventName: cfg.EVENT_NAME ?? '',
    orgName: cfg.ORG_NAME ?? '',
    issuedAt: new Date().toISOString(),
  }
}

/**
 * Add more tickets to a running raffle.
 *
 * APPEND ONLY, and the refusals are the substance. The arithmetic that makes a
 * ticket cost zero lookups is that ticket N has idx N — so tickets can be added
 * past the end and never inserted or renumbered.
 *
 * The dangerous mistake here is not asking for too many on purpose. It is a
 * slipped digit turning 10,000 into 100,000, appending ninety thousand rows
 * that cannot be taken back, because shrinking would delete tickets that may
 * already be sold. Hence a planned ceiling checked before anything is written.
 */
export async function expandTickets(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  requireSuperAdmin(user, 'Adding more tickets to a running raffle')

  const { data: cfgRows } = await ctx.supabaseAdmin.from('config').select('key,value')
  const cfg: Record<string, string> = {}
  for (const r of cfgRows ?? []) cfg[String(r.key)] = String(r.value ?? '')
  const n = (k: string, d: number) => parseInt(cfg[k] ?? '', 10) || d

  const current = n('TOTAL_TICKETS', 0)
  const per = n('TICKETS_PER_BOOK', 10)
  const ceiling = n('TICKET_CEILING', 0)
  const target = parseInt(String(p.totalTickets ?? ''), 10)

  if (isNaN(target)) throw new ApiError('BAD_REQUEST', 'totalTickets must be a whole number.')
  if (target < current) {
    throw new ApiError(
      'CANNOT_SHRINK',
      `The raffle has ${current} tickets and cannot be reduced to ${target}. Every ticket ` +
      `above ${target} would stop existing, including ones already sold, and nothing would ` +
      'report an error. Tickets can only be added.',
    )
  }
  if (target === current) {
    throw new ApiError('NO_CHANGE', `The raffle already has ${current} tickets.`)
  }
  if (ceiling > 0 && target > ceiling) {
    throw new ApiError(
      'ABOVE_CEILING',
      `This raffle is planned to reach ${ceiling} tickets and you have asked for ${target}. ` +
      'If that is really the intention, raise the ceiling first. Tickets cannot be taken ' +
      'back once released, so the ceiling is checked before anything is written.',
      { ceiling, requested: target, current },
    )
  }
  if (target > 200000) {
    throw new ApiError('TOO_MANY', 'The most this system holds is 200000 tickets.')
  }
  if (current % per !== 0) {
    throw new ApiError(
      'PARTIAL_BOOK',
      `The last book is not full: ${current} tickets does not divide into books of ${per}. ` +
      'Growing would have to rewrite that book rather than add to the end, so it is refused.',
    )
  }

  // The same drift check the Sheet does, asked of the database: if the rows and
  // the settings disagree, appending puts new tickets on the wrong numbers.
  const countOf = async (table: string) => {
    const { count } = await ctx.supabaseAdmin.from(table).select('idx', { count: 'exact', head: true })
    return count ?? 0
  }
  const haveTickets = await countOf('tickets')
  const haveBooks = await countOf('books')
  const currentBooks = Math.ceil(current / per)
  if (haveTickets !== current || haveBooks !== currentBooks) {
    throw new ApiError(
      'SCHEMA_DRIFT',
      `The settings say ${current} tickets in ${currentBooks} books, but the database holds ` +
      `${haveTickets} tickets and ${haveBooks} books. Adding to the end would put new tickets ` +
      'on the wrong numbers. Sort this out before growing the raffle.',
    )
  }

  const prefix = cfg.TICKET_PREFIX ?? ''
  const digits = n('TICKET_DIGITS', 5)
  const start = n('TICKET_START', 1)
  const bookPrefix = cfg.BOOK_PREFIX ?? 'Book-'
  const bookDigits = n('BOOK_DIGITS', 3)
  const pad = (v: number, w: number) => String(v).padStart(w, '0')

  // Numbering has to still fit. Widening the padding later would renumber every
  // ticket already printed, so this raffle simply cannot grow that far.
  if (String(start + target - 1).length > digits) {
    throw new ApiError(
      'NUMBERING_TOO_SMALL',
      `Ticket numbers are ${digits} digits, which cannot reach ${start + target - 1}. ` +
      'The padding cannot be widened now — that would renumber every ticket already ' +
      'printed — so this raffle cannot grow that far.',
    )
  }

  const newBooks = Math.ceil(target / per)
  const addedTickets = target - current
  const addedBooks = newBooks - currentBooks

  // A preview by default, like every other wide operation here.
  const dryRun = p.dryRun === undefined ? true : !!p.dryRun
  if (dryRun) {
    return {
      dryRun: true, from: current, to: target,
      addedTickets, addedBooks,
      firstNewTicket: prefix + pad(start + current, digits),
      lastNewTicket: prefix + pad(start + target - 1, digits),
      message: 'Nothing was written. Send the same request with dryRun:false to apply it.',
    }
  }

  // Books first: a ticket references its book.
  const books = []
  for (let b = currentBooks + 1; b <= newBooks; b++) {
    books.push({
      idx: b, number: bookPrefix + pad(b, bookDigits),
      first_ticket: prefix + pad(start + (b - 1) * per, digits),
      last_ticket: prefix + pad(start + b * per - 1, digits),
      status: 'Unassigned', modified_by: user.email,
    })
  }
  for (let i = 0; i < books.length; i += 500) {
    const { error } = await ctx.supabaseAdmin.from('books').insert(books.slice(i, i + 500))
    if (error) throw new ApiError('QUERY_FAILED', error.message)
  }

  for (let from = current + 1; from <= target; from += 500) {
    const batch = []
    for (let i = from; i < Math.min(from + 500, target + 1); i++) {
      batch.push({
        idx: i, number: prefix + pad(start + i - 1, digits),
        book_idx: Math.ceil(i / per), status: 'Available',
        version: 1, recorded_by: user.email,
      })
    }
    const { error } = await ctx.supabaseAdmin.from('tickets').insert(batch)
    if (error) throw new ApiError('QUERY_FAILED', error.message)
  }

  await ctx.supabaseAdmin.from('config').update({ value: String(target) }).eq('key', 'TOTAL_TICKETS')

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'EXPAND_TICKETS',
    details: { from: current, to: target, addedBooks }, email: user.email,
  })

  // Deliberately NOT put into play. Creating tickets and releasing them are two
  // decisions, and merging them would release ninety thousand tickets on a
  // slipped digit rather than merely creating them.
  return {
    from: current, to: target, addedTickets, addedBooks,
    firstNewTicket: prefix + pad(start + current, digits),
    lastNewTicket: prefix + pad(start + target - 1, digits),
    note: 'Created but not yet in play. Use "tickets in play" to release them.',
  }
}

/** The planned size of this raffle — the guard rail expand_tickets checks. */
export async function setTicketCeiling(p: Record<string, unknown>, user: AppUser, ctx: Ctx) {
  requireSuperAdmin(user, 'Changing the planned size of the raffle')

  const target = parseInt(String(p.ticketCeiling ?? ''), 10)
  if (isNaN(target) || target < 1) {
    throw new ApiError('BAD_REQUEST', 'ticketCeiling must be a whole number of at least 1.')
  }

  const { data: row } = await ctx.supabaseAdmin
    .from('config').select('value').eq('key', 'TOTAL_TICKETS').maybeSingle()
  const generated = parseInt(String(row?.value ?? '0'), 10) || 0

  // A ceiling below what already exists describes a raffle that is over its own
  // limit, which would make every later refusal read as nonsense.
  if (target < generated) {
    throw new ApiError(
      'BELOW_GENERATED',
      `${generated} tickets already exist, so the planned size cannot be ${target}.`,
      { generated, requested: target },
    )
  }

  const { error } = await ctx.supabaseAdmin
    .from('config').upsert({ key: 'TICKET_CEILING', value: String(target) }, { onConflict: 'key' })
  if (error) throw new ApiError('QUERY_FAILED', error.message)

  await ctx.supabaseAdmin.from('audit_log').insert({
    action: 'SET_TICKET_CEILING', details: { to: target, generated }, email: user.email,
  })
  return { ticketCeiling: target, generated }
}
