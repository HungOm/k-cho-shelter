#!/usr/bin/env bash
#
# Make the key that the weekly backup is sealed with, and print what to paste.
#
# WHY A SCRIPT AND NOT A PARAGRAPH. The four secrets in
# .github/workflows/backup.yml are the difference between a backup that runs
# and a red cross on the repository every Sunday, and the first of them is a
# gpg key pair — which is exactly the kind of thing that gets put off, then
# done wrong at speed, with the private half left somewhere convenient.
#
# WHAT THIS DELIBERATELY DOES NOT DO: upload anything. It does not touch the
# repository, it does not call gh, and it does not send the key anywhere. It
# makes the pair, hands you the public half, and prints the commands. The
# private half stays on this machine and it is your job to keep it — because
# the whole design is that the runner holds only the public key and therefore
# cannot read a backup it has just taken.
#
# Run it on a machine that is NOT the CI runner. Anywhere you trust with the
# ability to read every buyer's telephone number, because that is what the
# private key is for.
#
#   bash supabase/backup-key.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Held in its own variable because bash does quote processing inside
# ${1:-...}, so the apostrophe in K'Cho would open a string that never closes.
DEFAULT_NAME="K'Cho raffle backups"
NAME="${1:-$DEFAULT_NAME}"

command -v gpg >/dev/null 2>&1 || {
  echo "gpg is not installed. On a Mac: brew install gnupg" >&2
  exit 1
}

if gpg --list-keys "$NAME" >/dev/null 2>&1; then
  echo "A key called \"$NAME\" already exists on this machine."
  echo "Using it rather than making a second one — two keys is how a backup"
  echo "ends up sealed to the half nobody kept."
  echo
else
  echo "Making a key pair for \"$NAME\"…"
  # No passphrase: a scheduled job cannot type one, and the protection here is
  # that the private half never leaves this machine. If you would rather have a
  # passphrase, make the key by hand and keep it somewhere you can reach at the
  # moment you need to restore — which will be a bad moment.
  gpg --batch --passphrase '' --pinentry-mode loopback \
      --quick-generate-key "$NAME" default default never
  echo
fi

OUT="backup-key.pub"
gpg --armor --export "$NAME" > "$OUT"
[ -s "$OUT" ] || { echo "Export produced nothing — is the key really there?" >&2; exit 1; }

FPR=$(gpg --list-keys --with-colons "$NAME" | awk -F: '/^fpr:/ {print $10; exit}')

cat <<DONE

Public key written to  $OUT   (safe to share — it can only seal, never open)
Fingerprint            $FPR

The private half is in your gpg keyring on THIS machine and nowhere else.
Back it up somewhere you will still have in a year:

  gpg --armor --export-secret-keys "$NAME" > somewhere-safe.asc

Without it a sealed backup cannot be opened by anybody, including you.

--------------------------------------------------------------------------
Now set the four repository secrets. Settings -> Secrets and variables ->
Actions, or with the gh CLI:

  gh secret set BACKUP_GPG_PUBLIC_KEY < $OUT
  gh secret set SUPABASE_DB_URL       # the Postgres connection string
  gh secret set SUPABASE_URL          # the project URL
  gh secret set SUPABASE_SECRET_KEY   # the sb_secret_ key, NOT the publishable one

Then run the workflow once by hand (Actions -> Weekly backup -> Run workflow)
rather than waiting for Sunday, so a mistake is found today.

To read a backup later:

  gpg --decrypt raffle-backup-<date>.tar.gz.gpg > raffle-backup.tar.gz

--------------------------------------------------------------------------
DONE

# The public key is harmless, but a stray file in the working tree is how
# somebody commits one by accident and then wonders which key is live.
if ! grep -qx 'backup-key.pub' .gitignore 2>/dev/null; then
  echo "Note: $OUT is not in .gitignore. It is safe to commit, but you may not want to."
fi
