# ITCS native review draft

The review document alone did not create a usable timetable version. This change adds a registered, draft-only import through the existing authenticated Super Admin cutover entrypoint. Timetable payloads and source snapshots are registered privately and are not committed to this public repository.

The importer clones the authoritative version, preserves its delivery facts, restores the two explicitly mapped stale assignments from active roots, and creates replacements scoped only to the new draft. Assignment uniqueness is enforced separately for global assignments and each version; callers cannot choose their assignment scope. Existing assignments remain available to historical versions.

Both check and save run the same atomic writer and final database constraints. The check stage always rolls back. Save records an idempotent receipt and verifies exact target placements, counts, hours, student paths, source history, and workload. Publication is rejected by this import profile.

Validation includes scope isolation and forged-scope rejection, authorization, source drift, publication rejection, transaction rollback, TypeScript, build, and the database migration in a transaction ending in rollback against the deployed schema. The final application additionally requires an authenticated live check and exact post-save verification.

Recovery: preserve the prior published schedule and the earlier review document. A failed import rolls back all newly created records. No automatic publication or destructive cleanup is included.
