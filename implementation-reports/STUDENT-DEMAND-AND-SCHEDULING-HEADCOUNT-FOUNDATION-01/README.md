# Student demand and scheduling headcount foundation

## Source design summary

The source-only model adds college-scoped, study-system-preserving approved scheduling headcounts
per academic cohort and term, with optional course-offering and component overrides. Scheduling
resolution is fail-closed and never derives a count from legacy expected-student fields.

## Status

**NOT APPLIED.** The migration remains source-only pending `APPROVE_DB_MIGRATION_APPLY`.

## Dependency

A2 shared groups are blocked until the production migration is approved and applied, and approved
headcount data has been entered.
