# G3b — Approved Instance Reconciliation

The 44 exception rows cover **86 approved hard-conflict instances**, because
the canonical validator emits each pair-based conflict twice (once with
`session_id = A, related_session_id = B`, once with the roles swapped) and
exception matching normalizes the pair before lookup.

| Exception rows | Rows | Instances / row | Approved instances |
| --- | --- | --- | --- |
| `instructor_conflict` (pair) | 22 | 2 | **44** |
| `room_conflict` (pair) | 20 | 2 | **40** |
| `room_type_mismatch` (single) | 2 | 1 | **2** |
| **Total** | **44** | — | **86** ✅ |

Live validator run confirms 86 approved instances matched (see
`canonical-validator-results.json`).

Result: **PASS** — 86 exactly, no double-counting, no self-matches.
