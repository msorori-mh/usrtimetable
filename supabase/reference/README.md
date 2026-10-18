# supabase/reference

Schema-only reference dumps written by `scripts/db/make-baseline.sh` (M-7):

- `prod-schema-<date>.sql` — production schema (`pg_dump --schema-only`, read-only role; no data).
- `replay-schema-<date>.sql` / `schema-diff-<date>.txt` — local by-products, git-ignored.

Only a reviewed `prod-schema-<date>.sql` is committed, as the input to the baseline/squash
procedure in `docs/operations/migrations-baseline.md`. No production dump has been taken yet.
