# Three daily instructor meetings

Maximum three meetings per instructor/day, counting regular and parallel together. This is independent of duration and existing daily-hour and weekly-attendance limits. Merged lectures count once; replaced split-source rows are excluded.

Implemented in candidate feasibility, joint mathematical rows, independent final validation, bounded-repair blocker discovery, and the authoritative fallback prefilter. A deferred database constraint checks the final version after writes, allowing atomic swaps while rejecting a fourth meeting. Approval/publication also checks historical drafts. The UI explains the limit and reports an explicit rejected save when PostgreSQL refuses a plan.

Validation: 28 focused scheduler tests passed, including new four-short-meeting, mixed-system, locked-session and mathematical-model cases. Scoped TypeScript checks including V2 passed. The SQL regression passed against disposable PGlite/PostgreSQL: third accepted, fourth rejected, atomic swap accepted, replaced source ignored, invalid approval rejected. CI repeats the SQL test on PostgreSQL.

Security review: migration yes; RLS, RPC signatures, authentication and authorization changes no. The trigger is SECURITY DEFINER only to inspect the complete final version, has an empty search_path, fully qualified data access, no dynamic SQL, and execution revoked from PUBLIC. It grants no new write authority. Existing version serialization is retained. No secrets or production data in this change. Production risk low: incompatible older drafts must be repaired before further saves/approval. No locked sessions or assignment identities are changed by this code.

Rollout: correct the current draft through its authenticated atomic save, apply the migration, verify no daily-count violations, then publish the tested client. Do not regenerate the draft or relax student/room/hour constraints.
