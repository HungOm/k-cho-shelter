# Not yet a migration

`supabase db push` reads this project's `supabase/migrations/` **directory**, not
git. So a finished-but-uncommitted migration sitting in there is a migration that
the next push by anybody applies to the live fundraiser — whoever wrote it,
whether or not it was ready, and with nothing in the history to say it happened.

That is not hypothetical in this repository. See `b940012`, "Production was
running three migrations that existed in no commit".

A file waits here while it is written and while it is reviewed. It moves into
`supabase/migrations/` in the same commit that tracks it, so "on disk" and "in
git" become true at the same moment and there is no window in between.

Check before any push:

    diff <(ls supabase/migrations/*.sql) <(git ls-files supabase/migrations/*.sql)

Anything that prints is a migration production may be about to run that nobody
has committed.
