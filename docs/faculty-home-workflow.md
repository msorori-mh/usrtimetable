# Lecturer home college and university teaching workflow

Implementation baseline: `ffe33f2e23e6261f62a89e8894992a6fe5123a27`.
Production target: existing `msorori-mh/usrtimetable` project, not a remix.

## Behavior

- The university identity and P/C/H numbering remain stable. Issuing college and operational row owner do not determine current affiliation.
- Register new lecturers in their home college. Search existing names/numbers first; matching names never merge identities automatically. Exact employee-number duplication is rejected within the university.
- Canonical home derives from consistent explicit affiliation, or an audited administrator decision. Conflicting/missing affiliation remains pending.
- A receiving college requests teaching hours on an existing delivery group. The home college approves/rejects; the receiving college can cancel. Administrators can approve directly. Approval revalidates identity, affiliation, group, term, component hours, allocation and existing-assignment timestamp atomically.
- Existing assignments are preserved. A request does not create an assignment until approval. Direct table writes cannot bypass foreign-teaching approval.
- Lecturer headcounts and the president dashboard use home college; teaching contributors and external contributors are separate measures. College directory shows one row per identity, including home members stored in a legacy college and visiting lecturers with active assignments.
- Workload combines linked identities across equivalent academic-year/term definitions. Confirmed home quota is used once; unknown quota is not treated as zero. The existing 12-hour extra-load ceiling applies university-wide, preserving the existing intake exception.
- The university timetable chooses one published version per college, falling back to that college's coordination version. Users can select other versions explicitly. Shared groups/programs remain visible without duplicating a session; unplaced assignments remain visible. Existing report permissions require access to every participating college.
- All instructor aliases participate in conflict detection. No schedule is regenerated.

## Reconciliation

In Instructors, open **التبعية الأصلية ومصدر النصاب**, then **تسوية**. Choose home and the authoritative record, enter evidence, and confirm quota only when documented. Saving preserves instructor IDs and all teaching/schedule links. A changed quota source invalidates its prior approval. Employment category changes are allowed only from the canonical source and retain previous numbers in history.

User clarification dated 2026-09-19: د. مبارك السفياني and أ. أحمد البدوي belong to the Information Systems department in Al-Jawf college. They count as external when teaching in ITCS; ITCS home members count as external when teaching in Al-Jawf. The clarification does not independently confirm their quota.

## Validation and production gate

Four PostgreSQL integration tests exercise admin/home/receiving/read-only/anonymous roles, request approval and rejection, stale updates, atomic failure, quota ceilings, reconciliation, number history, aliases, shared groups, session-only colleges and unchanged sessions. Fixture identities are synthetic and never inserted into production. Tests use PGlite 0.5.8; existing schema helpers are represented in the fixture, so production-schema compatibility is separately checked by a rolled-back migration transaction.

Run:

```sh
npm install --prefix /tmp/faculty-test --no-package-lock --ignore-scripts @electric-sql/pglite@0.5.8
FACULTY_DB_MODULE=/tmp/faculty-test/node_modules/@electric-sql/pglite/dist/index.js node --test --test-force-exit tests/faculty-workflow-db.test.mjs
bun install --frozen-lockfile
npx tsc --noEmit
npm run build
```

Apply the five `2026091910*` migrations in one transaction, recording each version in `supabase_migrations.schema_migrations` if applying through the database administration connector. Verify live row counts and deterministic row hashes before/after. Only the two user-authorized affiliation corrections may change instructor metadata; no assignments, groups, sessions, versions or faculty numbers should change. Lovable is used only for the existing database/deployment control plane; no AI editing or regeneration.

Initial data: 200 instructor rows, 194 linked identities (including the isolated test identity), 878 assignments, 609 groups, 3040 sessions, 15 versions. Five identities require home review. Borrowed-only quota sources remain pending confirmation. These are data review items, not guessed affiliations.

## Recovery

Before rollout retain a known working deployment. `supabase/rollback/20260919_faculty_workflow.sql` restores exact prior function definitions and removes only the two new enforcement triggers. It retains request, home-decision and audit records; do not drop those records or delete linked instructor rows. Revert the corresponding UI commit if restoring old behavior. The rollback does not reverse later human affiliation decisions and does not delete migration history; subsequent corrections must be new forward migrations. Use a transaction and verify operational hashes after any recovery.
