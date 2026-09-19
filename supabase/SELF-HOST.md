# Running Raffled on your own Supabase

The same repository deploys to a Supabase-hosted project and to a stack you run
yourself. Nothing is forked, nothing is branched, and there is no build flag: the
client reads its address from one variable, the SQL asks for nothing a plain
Postgres does not have, and the API function works out at boot which of two ways
this deployment proves who is calling.

This file is the self-hosted half. `SETUP.md` is still the guide to everything
that is the same on both — the Google client ID, the two deadlines, adding your
team, printing tickets — and it is the one to read first.

**Who this is for.** Somebody who already has a self-hosted Supabase running, or
is willing to run one. If that is not you, the hosted path in `SETUP.md` is the
supported one and it is the one the volunteers' phone numbers are currently
sitting on.

---

## The one question to answer first

Everything else is ordinary deployment. This is the part that is not obvious and
it decides which of two configurations you need:

```
curl -s https://YOUR-SUPABASE/auth/v1/.well-known/jwks.json
```

**A JSON document with a `keys` array** — your auth service signs with keys that
have a key id, and publishes them. Take **Path A** below.

**404, an empty document, or `{"keys":[]}`** — your auth service signs every
session with one shared secret, which is what the official `docker-compose`
does unless you have changed it. Take **Path B**.

The difference matters because `@supabase/server`, the package the API function
is built on, verifies a session by looking its signing key up in a JWKS and
**refuses any token whose header does not name a key**:

```js
const { alg, kid } = decodeProtectedHeader(credentials.token)
if (!alg || !kid) return INVALID
```

On a Path B stack that is every session, for everybody, always — and the refusal
is a bare 401 with nothing in it about why. The app looks deployed and correct
and nobody can sign in.

---

## Step 1 — the database

Identical to hosted, because the schema was written that way. Applied with
`psql` against your own database rather than through the CLI's linked project:

```
psql "$DB" -f supabase/schema.sql
psql "$DB" -f supabase/functions.sql
psql "$DB" -f supabase/rls.sql
for f in supabase/migrations/*.sql; do psql "$DB" -v ON_ERROR_STOP=1 -f "$f"; done
```

Order matters and is the same order `SETUP.md` gives. `supabase db push` also
works if you would rather use the CLI; it needs `--db-url` pointed at your
database.

Two things to know:

**`pg_trgm` is the only extension.** It ships with Postgres. Nothing here wants
`pg_cron`, `pg_net`, `vault` or `pgsodium`, and `tests/selfhost.test.mjs` fails
if a migration starts wanting one.

**One migration will fail on purpose if Realtime is not there.**
`20260916001500_change_nudge.sql` calls `realtime.send` once, with no error
handler, before it installs the trigger that uses it. That is deliberate: the
trigger swallows its own errors — a broadcast must never fail a sale — so
without the check a missing Realtime would install a feature that silently does
nothing and nobody would notice for months. If that migration stops, your stack
has no Realtime and the app will poll instead of being nudged. Everything else
works.

The policy in `20260916002000_nudge_channel_policy.sql` is created on
`realtime.messages`, which your migration role has to be allowed to do. On the
stock compose, connecting as `postgres` is enough.

---

## Step 2 — the functions

A hosted project routes `/functions/v1/<name>` to the right function itself. A
self-hosted stack runs **one** `edge-runtime` container over the whole directory
and hands every request to a main service, which is why this repository carries
one:

```
supabase/functions/
├── main/index.ts      ← routes by name; self-hosted only, never deployed to hosted
├── api/               ← the app
├── verify/            ← the public ticket check
└── _shared/           ← not a function, and not reachable from outside
```

Mount the directory and point the runtime at `main`:

```yaml
  functions:
    image: supabase/edge-runtime:<the version your stack already pins>
    restart: unless-stopped
    volumes:
      - ./supabase/functions:/home/deno/functions:Z
    command:
      - start
      - --main-service
      - /home/deno/functions/main
    environment:
      # Step 2a, below.
```

`main` routes only the names it lists — `api` and `verify`. Anything else, including
`_shared`, is a 404 that never starts a worker.

### 2a — what the container needs in its environment

| Variable | Path A | Path B | What it is |
| --- | --- | --- | --- |
| `SUPABASE_URL` | required | required | How the functions reach your own API. The internal address (`http://kong:8000`) is right here. |
| `SUPABASE_SECRET_KEY` | required | required | The key the admin client uses. On a stack that has no `sb_secret_` keys, your `service_role` key goes here — the package treats it as an opaque string. **This bypasses every policy in the database.** |
| `SUPABASE_JWKS` | required | — | The signing keys, as inline JSON, exactly as `/auth/v1/.well-known/jwks.json` returns them. |
| `SUPABASE_JWT_SECRET` | — | required | Your `JWT_SECRET`. Setting it is what puts the API function on the shared-secret path. Leave it unset on Path A. |
| `SUPER_ADMIN_EMAIL` | required | required | The one account that can do the four things no role can be granted. Read from the environment and nowhere else — the database cannot make anybody super. |
| `ADMIN_BOOTSTRAP_EMAIL` | optional | optional | The older name for the same thing, still read as a fallback. |
| `SUPABASE_PUBLISHABLE_KEY` | optional | optional | Unused by these two functions; set it if you add one that takes `auth: 'publishable'`. |

**Do not use `SUPABASE_JWKS_URL` here.** It is rejected unless it is `https:` or
a loopback address, so the obvious `http://kong:8000/auth/v1/.well-known/jwks.json`
is discarded — and discarded silently, leaving you with no JWKS and a 401 on
every request. Paste the document into `SUPABASE_JWKS` instead.

### 2b — JWT verification at the edge

Turn the container's own JWT check **off**.

On a hosted project the platform checks a JWT before the function runs, and
`config.toml` sets that per function: on for `api`, off for `verify`, with the
reasoning written out there. A self-hosted `edge-runtime` has one setting for
the whole container and cannot express the split, so it has to be one or the
other:

- **Off** — `api` refuses unauthenticated callers itself, on both paths, before
  a single row is read. `verify` answers the stranger in the hall who scanned a
  QR, which is its entire purpose.
- **On** — `api` is no better protected than it already was, and `verify` is
  dead. Every ticket someone scans reports that it cannot be checked.

So: off. The gate is in the function, which is where it was to begin with.

---

## Step 3 — the app

One build, pointed at your own address:

```
VITE_SUPABASE_URL=https://supabase.example.org \
VITE_SUPABASE_PUBLISHABLE_KEY=<your publishable or anon key> \
VITE_GOOGLE_CLIENT_ID=<the Google client ID from SETUP.md> \
npm run build
```

Publish `dist/` anywhere that serves static files. The key in the bundle is the
public half of the pair whichever kind of project it came from; what protects
the data is row security in the database, for the signed-in person.

The GitHub Pages workflow reads these from repository **variables**, so pointing
the published app at your own stack is three values in one settings page and no
change to any file.

---

## Step 4 — Google sign-in

The app signs in with a Google ID token and trades it for a session, so your auth
service has to be told to trust the same client ID:

```
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<the client ID, and any others, comma separated>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<the client secret>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://supabase.example.org/auth/v1/callback
GOTRUE_SITE_URL=https://the-app.example.org
GOTRUE_URI_ALLOW_LIST=https://the-app.example.org
```

Until the client ID is listed there, every sign-in is refused and the app says
so plainly — it does not report a rejected password, because it is not one.

---

## Does it work? Four checks, in order

```
# 1. The public ticket check answers a stranger. No session, no key.
curl -i -s "https://supabase.example.org/functions/v1/verify?t=NOPE&c=NOPE"
# → HTTP 400, {"ok":false,"reason":"malformed"}. That is the function ANSWERING
#   — it is refusing a request that is not shaped like a ticket, which is what
#   you want to see and does not need to know your ticket prefix. A 401 means
#   the container's JWT check is still on (2b); a 404 means main is not routing.

# 2. The API refuses an unauthenticated caller.
curl -s -X POST https://supabase.example.org/functions/v1/api \
  -H 'content-type: application/json' -d '{"action":"get_config"}'
# → 401. If it is 404, main is not routing; if it is 200, stop and read 2b.

# 3. The API refuses the anon key presented as a session. This is the one that
#    matters on Path B: the anon key IS a valid JWT signed with your secret.
curl -s -X POST https://supabase.example.org/functions/v1/api \
  -H "authorization: Bearer $ANON_KEY" \
  -H 'content-type: application/json' -d '{"action":"get_config"}'
# → 401, AUTH_REQUIRED. Anything else is a hole; do not put real data in.

# 4. A real session works. Sign in to the app, then from the browser console:
#    (await window.supabase?.auth?.getSession())  — or copy the token from the
#    network tab of any request the app makes.
```

---

## When it does not work

| What you see | What it is |
| --- | --- |
| Every call 401s, sign-in itself succeeded | No JWKS on Path A, or `SUPABASE_JWT_SECRET` unset on Path B. The function is verifying against keys it does not have. |
| Every call 401s, and you set `SUPABASE_JWKS_URL` | It was `http:` and not loopback, so it was discarded. Use inline `SUPABASE_JWKS`. |
| Scanning a ticket QR says the ticket cannot be checked | The container's JWT check is on. See 2b. |
| 404 from every function | `--main-service` is not pointed at `main`, or the volume is mounted somewhere other than `/home/deno/functions`. |
| The browser blocks the response, CORS | Two sets of CORS headers — the function sets its own, so the gateway must not add a second. Remove the `cors` plugin from the functions route, not from the function. |
| Sign-in refused for everybody | The Google client ID is not in `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`. |
| The app polls but never updates by itself | Realtime is absent or the policy on `realtime.messages` did not apply. Harmless; the app falls back to polling. |
| `supabase functions deploy` says it cannot find the project | It is for hosted projects only. Self-hosted functions are files in a mounted volume; restart the container. |

---

## Backups

`supabase/backup.sh` works against any Postgres. Set `SUPABASE_DB_URL` to your
connection string and it takes that path instead of the linked-project one:

```
SUPABASE_DB_URL='postgresql://postgres:...@localhost:5432/postgres' supabase/backup.sh
```

Everything else about it — the encryption, what is in a backup and what is not,
restoring — is in `SETUP.md` and is unchanged.

---

## What is different, once it is running

Nothing, from the point of view of anybody using the app. The screens, the
permissions, the audit trail, the money and the printed tickets are the same
code. What differs is underneath:

- **Sessions are verified by the function** rather than at the platform edge on
  Path B. Stricter, if anything: the check also requires the token to be a
  session rather than merely something this project's secret signed.
- **There is no dashboard** for the things `SETUP.md` points at one for. The
  Google client ID is an environment variable; the function secrets are
  environment variables; the SQL editor is `psql`.
- **Nobody upgrades the database for you.** The Postgres major version, the auth
  service and the storage service are yours to keep current, and a stack left
  alone for a year is the one that cannot be restored in a hurry.
