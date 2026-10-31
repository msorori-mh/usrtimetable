import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(
    import.meta.dir,
    "../supabase/migrations/20261030100000_partition_daily_hours_all_colleges.sql",
  ),
  "utf8",
);

describe("student daily hours counted per partition in every college", () => {
  test("the partition path is no longer limited to ITCS", () => {
    expect(sql).not.toContain("IF v_delivery_group_id IS NOT NULL AND EXISTS(");
    expect(sql).toContain("IF v_delivery_group_id IS NOT NULL THEN");
    expect(sql).toContain("public._ss_partition_daily_hours(");
  });

  test("ITCS keeps its strict behaviour", () => {
    expect(sql).toContain("IF v_is_itcs THEN RAISE; END IF;");
    expect(sql).toContain("IF v_is_itcs THEN\n      RETURN v_partition_result;");
  });

  test("other colleges fall back to the cohort-wide sum when the mapping is incomplete", () => {
    expect(sql).toContain("'student_mapping_incomplete'");
    expect(sql).toContain("OR (v_cohort_id IS NOT NULL AND s.cohort_id = v_cohort_id)");
  });

  test("limits are unchanged", () => {
    expect(sql).toContain("v_theory_limit numeric := 6;");
    expect(sql).toContain("greatest(v_total_limit, v_prior_total)");
  });
});
