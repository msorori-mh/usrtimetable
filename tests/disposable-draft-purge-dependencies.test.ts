import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    import.meta.dir,
    "../supabase/migrations/20260928213000_fix_disposable_clone_purge_dependencies.sql",
  ),
  "utf8",
);

describe("disposable clone purge dependency closure", () => {
  test("keeps the original authorization and lifecycle guards", () => {
    expect(migration).toContain("PURGE_SUPER_ADMIN_REQUIRED");
    expect(migration).toContain("PURGE_PROTECTED_VERSION");
    expect(migration).toContain("PURGE_NOT_DISPOSABLE");
    expect(migration).toContain("PURGE_STATUS_NOT_DRAFT");
    expect(migration).toContain("PURGE_CROSS_COLLEGE_DEPENDENT");
    expect(migration).toContain("PURGE_ORPHAN_ROWS_REMAIN");
    expect(migration).toContain("SET search_path = public, pg_temp");
  });

  test("fails closed when the disposable draft is still a source", () => {
    expect(migration).toContain("PURGE_VERSION_HAS_CLONES");
    expect(migration).toContain("PURGE_VERSION_HAS_SOURCE_REVISIONS");
    expect(migration).toContain("PURGE_VERSION_HAS_CUTOVER_PROFILE");
    expect(migration).toContain("PURGE_EXTERNAL_SESSION_REFERENCE");
    expect(migration).toContain("PURGE_EXTERNAL_SOURCE_ROW_REFERENCE");
  });

  test("deletes every version-scoped dependency child before its parent", () => {
    const orderedDeletes = [
      "education_source_revision_private.additions",
      "education_source_revision_private.sessions",
      "education_source_revision_private.source_rows",
      "education_source_revision_private.revisions",
      "assignment_version_private.scope",
      "schedule_version_delivery_private.group_partition_facts",
      "schedule_version_delivery_private.partner_partition_facts",
      "schedule_version_delivery_private.instructor_hour_waivers",
      "schedule_version_delivery_private.group_facts",
      "schedule_version_delivery_private.partition_facts",
      "schedule_version_delivery_private.partner_group_facts",
      "schedule_version_delivery_private.cohort_facts",
      "schedule_version_delivery_private.scope",
      "schedule_version_delivery_private.clone_provenance",
      "public.schedule_sessions",
      "public.schedule_versions",
    ];

    let previous = -1;
    for (const table of orderedDeletes) {
      const index = migration.indexOf(`DELETE FROM ${table}`);
      expect(index, `missing delete for ${table}`).toBeGreaterThan(previous);
      previous = index;
    }
  });

  test("preserves the restricted RPC grant", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)",
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.purge_disposable_draft_schedule_version\(uuid\)\s+TO authenticated/,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE[\s\S]*purge_disposable_draft_schedule_version[\s\S]*TO anon/,
    );
  });
});
