import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const up = readFileSync(
  resolve(
    import.meta.dir,
    "../supabase/migrations/20261031120000_shared_lecture_partner_partition_fallback.sql",
  ),
  "utf8",
);
const down = readFileSync(
  resolve(
    import.meta.dir,
    "../supabase/rollbacks/20261031120000_shared_lecture_partner_partition_fallback.down.sql",
  ),
  "utf8",
);

describe("shared lecture memberships fall back to cohort partitions", () => {
  test("partner facts without partner partitions no longer hide cohort partitions", () => {
    expect(up).not.toContain("WHERE s.cohort_id IS NULL AND pf.group_id IS NULL");
    expect(up).toContain("AND (pf.group_id IS NULL OR NOT EXISTS (");
    expect(up).toContain("WHERE pp2.version_id=p_version AND pp2.group_id=m.delivery_group_id");
  });

  test("version-scoped facts and incomplete-coverage markers are kept", () => {
    expect(up).toContain("schedule_version_delivery_private.group_partition_facts");
    expect(up).toContain("SELECT l.anchor_group_id,g.cohort_id,NULL::uuid,NULL::integer,true");
    expect(up).toContain("SECURITY DEFINER");
  });

  test("rollback restores the previous filter", () => {
    expect(down).toContain("WHERE s.cohort_id IS NULL AND pf.group_id IS NULL");
  });
});
