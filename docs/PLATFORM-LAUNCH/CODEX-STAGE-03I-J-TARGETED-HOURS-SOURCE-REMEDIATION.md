# CODEX STAGE 03I-J — Targeted Hours Source Remediation

Mission: `PLATFORM-LAUNCH-STAGE-03I-J-TARGETED-HOURS-SOURCE-REMEDIATION-01`
Generated: 2026-07-29 (Asia/Riyadh)

## Scope

Source-only remediation and deterministic test coverage. No production writes,
migrations, imports, Lovable publish, Legacy mutation, or schedule operation were
performed.

The baseline and decisions are taken from
`STAGE-03I-F-CONTROLLED-138-CANONICAL-V2-IMPORT.md` and its Stage 03I-G/H/I
reconciliations:

- PR113 strict component-hours validation remains authoritative.
- The 63 strict downgrades remain non-READY; false rejections remain zero.
- The import target is the current 93 READY source rows / 87 canonical operations,
  not the historical 138 operations.

## Source bugs fixed

1. The targeted fixture now represents the proven FR231 co-teacher correction as
   explicit `1+1` assigned hours for each of the regular and parallel delivery
   groups. Canonical natural keys and operation count do not change.
2. Canonical hours preflight now attributes an overallocated delivery group to
   every affected incoming source row instead of emitting one synthetic row-zero
   error. The uncorrected two-group fixture therefore reports the four invalid
   source rows precisely.
3. Excel total-hours versus weekly-component validation remains fail-closed for a
   single assignable component. No mismatch is promoted to READY and no clamp or
   silent rewrite was added.

## Deterministic acceptance fixture

| Gate | Expected | Result |
|---|---:|---:|
| READY source rows | 93 | 93 |
| Canonical operations | 87 | 87 |
| Strict downgrades preserved | 63 | 63 |
| Invalid hours before fixture correction | 4 rows | 4 |
| Invalid hours after corrected fixture | 0 | 0 |
| Overallocated instructors | 0 | 0 |
| Legacy mixed into V2 | 0 | 0 |
| Cross-term mixing | 0 | 0 |
| Regular/parallel mixing | 0 | 0 |

The fixture includes six identical duplicate source rows so 93 READY rows
deterministically canonicalize to 87 unique operations. The hours correction
changes only the four FR231 assigned-hour values; it does not change keys or make
any of the 63 strict downgrades READY.

## Runtime and safety gates

Runtime gates are satisfied when the repository typecheck, build, Bun tests,
harness suite, and GitHub Actions checks pass. This change contains no database or
deployment artifact and requires no production action.

## Decision

`READY_FOR_RELEASE_LEAD`
