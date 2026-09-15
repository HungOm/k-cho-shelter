/*
 * Which .gs files a test evaluates, in an order that works.
 *
 * Nineteen test files each carried the same hand-written array. Adding
 * Branding.gs broke every one of them with "handleUploadLogo is not defined" —
 * a list that goes stale the moment somebody adds a file, and goes stale in the
 * direction that looks like the NEW CODE is broken rather than the list.
 *
 * ORDER IS KEPT EXPLICIT rather than sorted. Apps Script evaluates every file
 * into one shared global scope and promises no order, but `eval` here does:
 * Config.gs defines constants the others read AT LOAD TIME, so alphabetical
 * would fail. The known-good order leads; anything new is appended, which is
 * safe because a new file cannot be something an older one already depends on.
 *
 * So a .gs file added tomorrow joins by existing. Same argument as the
 * enumerating tests elsewhere here: a hand-written list reproduces whatever its
 * author could see at the time.
 */
const { readdirSync } = require('fs')
const { join } = require('path')

const DIR = join(__dirname, '..', 'apps_script')
const FIRST = ['Config.gs', 'Auth.gs', 'Api.gs', 'Tickets.gs', 'Books.gs',
               'People.gs', 'Reports.gs', 'Approvals.gs', 'Setup.gs']

module.exports = function gsFiles() {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.gs'))
  const known = FIRST.filter((f) => all.includes(f))
  const rest = all.filter((f) => !FIRST.includes(f)).sort()
  return known.concat(rest)
}
