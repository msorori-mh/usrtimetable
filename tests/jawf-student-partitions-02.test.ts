/**
 * JAWF-STUDENT-PARTITIONS-02 — shared-student semantics for delivery groups.
 * Pure tests plus source assertions on the proposed SQL. No DB access, no
 * writes, no production data.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  buildPartitionIndex,
  groupsShareStudents,
  makeSharedStudentsPredicate,
  type PartitionMembershipRow,
} from "../src/lib/auto-scheduler/student-partitions";
import { isLocallyBlocked } from "../src/lib/auto-scheduler/session-plan";

const COHORT = "cohort-jawf-l1";
const OTHER_COHORT = "cohort-other";
const P = { p1: "P1", p2: "P2", p3: "P3", p4: "P4" };

/** Course A + course B of the same cohort, mapped per the approved model. */
const rows: PartitionMembershipRow[] = [
  // course A theory G1 -> P1,P2 ; theory G2 -> P3,P4
  { delivery_group_id: "A-th-G1", cohort_id: COHORT, partition_id: P.p1, partition_headcount: 30 },
  { delivery_group_id: "A-th-G1", cohort_id: COHORT, partition_id: P.p2, partition_headcount: 30 },
  { delivery_group_id: "A-th-G2", cohort_id: COHORT, partition_id: P.p3, partition_headcount: 30 },
  { delivery_group_id: "A-th-G2", cohort_id: COHORT, partition_id: P.p4, partition_headcount: 30 },
  // course A practical G1..G4 -> P1..P4
  { delivery_group_id: "A-pr-G1", cohort_id: COHORT, partition_id: P.p1, partition_headcount: 30 },
  { delivery_group_id: "A-pr-G2", cohort_id: COHORT, partition_id: P.p2, partition_headcount: 30 },
  { delivery_group_id: "A-pr-G3", cohort_id: COHORT, partition_id: P.p3, partition_headcount: 30 },
  { delivery_group_id: "A-pr-G4", cohort_id: COHORT, partition_id: P.p4, partition_headcount: 30 },
  // course B practical G1, G2 -> P1, P2 (same partitions, different course)
  { delivery_group_id: "B-pr-G1", cohort_id: COHORT, partition_id: P.p1, partition_headcount: 30 },
  { delivery_group_id: "B-pr-G2", cohort_id: COHORT, partition_id: P.p2, partition_headcount: 30 },
  // another cohort
  {
    delivery_group_id: "X-th-G1",
    cohort_id: OTHER_COHORT,
    partition_id: "X1",
    partition_headcount: 40,
  },
];

const expectedStudents: Record<string, number> = {
  "A-th-G1": 60,
  "A-th-G2": 60,
  "A-pr-G1": 30,
  "A-pr-G2": 30,
  "A-pr-G3": 30,
  "A-pr-G4": 30,
  "B-pr-G1": 30,
  "B-pr-G2": 30,
  "X-th-G1": 40,
};

const index = buildPartitionIndex({ rows, expectedStudents });
const share = (a: string, b: string) => groupsShareStudents(a, b, index);

describe("shared-student semantics", () => {
  test("disjoint theory G1 vs theory G2 is allowed", () => {
    expect(share("A-th-G1", "A-th-G2").share).toBe(false);
    expect(share("A-th-G1", "A-th-G2").reason).toBe("disjoint_partitions");
  });

  test("theory G1 conflicts with practical G1 and G2", () => {
    expect(share("A-th-G1", "A-pr-G1").share).toBe(true);
    expect(share("A-th-G1", "A-pr-G2").share).toBe(true);
    expect(share("A-th-G1", "A-pr-G1").reason).toBe("overlapping_partitions");
  });

  test("theory G1 is allowed against practical G3 and G4", () => {
    expect(share("A-th-G1", "A-pr-G3").share).toBe(false);
    expect(share("A-th-G1", "A-pr-G4").share).toBe(false);
  });

  test("theory G2 conflicts with practical G3/G4 and is free against G1/G2", () => {
    expect(share("A-th-G2", "A-pr-G3").share).toBe(true);
    expect(share("A-th-G2", "A-pr-G4").share).toBe(true);
    expect(share("A-th-G2", "A-pr-G1").share).toBe(false);
    expect(share("A-th-G2", "A-pr-G2").share).toBe(false);
  });

  test("the same partition in two different courses conflicts", () => {
    expect(share("A-pr-G1", "B-pr-G1").share).toBe(true);
    expect(share("A-pr-G2", "B-pr-G2").share).toBe(true);
  });

  test("separate practical partitions across courses are allowed", () => {
    expect(share("A-pr-G1", "B-pr-G2").share).toBe(false);
    expect(share("A-pr-G1", "A-pr-G2").share).toBe(false);
  });

  test("the same group always conflicts with itself", () => {
    expect(share("A-pr-G1", "A-pr-G1")).toEqual({ share: true, reason: "same_group" });
  });

  test("mapped vs unmapped is conservatively blocked", () => {
    expect(share("A-th-G1", "legacy-unmapped")).toEqual({ share: true, reason: "unmapped" });
    expect(share("legacy-a", "legacy-b")).toEqual({ share: true, reason: "unmapped" });
    expect(groupsShareStudents("A-th-G1", "A-th-G2", null)).toEqual({
      share: true,
      reason: "unmapped",
    });
  });

  test("incomplete coverage is conservatively blocked", () => {
    const partial = buildPartitionIndex({
      rows: rows.filter((r) => !(r.delivery_group_id === "A-th-G1" && r.partition_id === P.p2)),
      expectedStudents,
    });
    // A-th-G1 now covers 30 of 60 students → unknown remainder → block.
    expect(groupsShareStudents("A-th-G1", "A-pr-G3", partial)).toEqual({
      share: true,
      reason: "incomplete_coverage",
    });
  });

  test("inconsistent cohort rows for one group drop the mapping (fail closed)", () => {
    const bad = buildPartitionIndex({
      rows: [
        ...rows,
        {
          delivery_group_id: "A-th-G1",
          cohort_id: OTHER_COHORT,
          partition_id: "X1",
          partition_headcount: 30,
        },
      ],
      expectedStudents,
    });
    expect(groupsShareStudents("A-th-G1", "A-pr-G3", bad).share).toBe(true);
  });

  test("groups of different cohorts never share students", () => {
    expect(share("A-th-G1", "X-th-G1")).toEqual({ share: false, reason: "different_cohort" });
  });
});

describe("local candidate pre-filter uses the same semantics", () => {
  const slot = { day: 0, start: "08:00", end: "10:00" };
  const occupiedTheoryG1 = [
    {
      day: 0,
      start: "08:00",
      end: "10:00",
      roomId: "room-1",
      instructorId: "ins-1",
      cohortId: COHORT,
      deliveryGroupId: "A-th-G1",
    },
  ];
  const predicate = makeSharedStudentsPredicate(index);

  test("disjoint groups of the same cohort are no longer blocked locally", () => {
    const blocked = isLocallyBlocked(
      slot,
      { roomId: "room-2", instructorId: "ins-2", cohortId: COHORT, deliveryGroupId: "A-pr-G3" },
      occupiedTheoryG1,
      predicate,
    );
    expect(blocked).toBe(false);
  });

  test("shared-student groups are still blocked locally", () => {
    const blocked = isLocallyBlocked(
      slot,
      { roomId: "room-2", instructorId: "ins-2", cohortId: COHORT, deliveryGroupId: "A-pr-G1" },
      occupiedTheoryG1,
      predicate,
    );
    expect(blocked).toBe(true);
  });

  test("without a predicate the conservative cohort-wide rule is preserved", () => {
    const blocked = isLocallyBlocked(
      slot,
      { roomId: "room-2", instructorId: "ins-2", cohortId: COHORT, deliveryGroupId: "A-pr-G3" },
      occupiedTheoryG1,
    );
    expect(blocked).toBe(true);
  });

  test("existing room and instructor blockers are unchanged", () => {
    expect(
      isLocallyBlocked(
        slot,
        { roomId: "room-1", instructorId: "ins-2", cohortId: COHORT, deliveryGroupId: "A-pr-G3" },
        occupiedTheoryG1,
        predicate,
      ),
    ).toBe(true);
    expect(
      isLocallyBlocked(
        slot,
        { roomId: "room-2", instructorId: "ins-1", cohortId: COHORT, deliveryGroupId: "A-pr-G3" },
        occupiedTheoryG1,
        predicate,
      ),
    ).toBe(true);
  });

  test("non-overlapping times are never blocked", () => {
    expect(
      isLocallyBlocked(
        { day: 0, start: "10:00", end: "12:00" },
        { roomId: "room-1", instructorId: "ins-1", cohortId: COHORT, deliveryGroupId: "A-th-G1" },
        occupiedTheoryG1,
        predicate,
      ),
    ).toBe(false);
  });
});

describe("proposed SQL (not applied)", () => {
  const schema = readFileSync(
    "docs/migrations-proposed/20260910T2100_cohort_student_partitions.sql",
    "utf8",
  );
  const data = readFileSync(
    "docs/migrations-proposed/20260910T2100_jawf_level1_partition_data_apply.sql",
    "utf8",
  );
  const checks = readFileSync(
    "docs/migrations-proposed/20260910T2100_partitions_preflight_postverify_rollback.sql",
    "utf8",
  );

  test("both tables are college/cohort scoped with grants and RLS", () => {
    for (const table of ["cohort_student_partitions", "delivery_group_partition_members"]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(schema).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated`,
      );
      expect(schema).toContain(`GRANT ALL ON public.${table} TO service_role`);
      expect(schema).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(schema).not.toContain("TO anon");
  });

  test("read scope uses can_view_college and every write uses can_manage_college", () => {
    expect(schema).toContain("public.can_view_college(auth.uid(), college_id)");
    const manageCount =
      schema.split("public.can_manage_college(auth.uid(), college_id)").length - 1;
    expect(manageCount).toBeGreaterThanOrEqual(6);
  });

  test("cross-college and cross-cohort mapping is rejected by triggers", () => {
    expect(schema).toContain("CROSS_COLLEGE_FORBIDDEN");
    expect(schema).toContain("COHORT_MISMATCH");
    expect(schema).toContain("trg_dgpm_consistency");
  });

  test("the helper is fail-closed and not executable by anon", () => {
    expect(schema).toContain("CREATE OR REPLACE FUNCTION public.delivery_groups_share_students");
    expect(schema).toContain("IF a_count = 0 OR b_count = 0 THEN RETURN true; END IF;");
    expect(schema).toContain("SET search_path TO 'public'");
    expect(schema).toContain(
      "REVOKE ALL ON FUNCTION public.delivery_groups_share_students(uuid, uuid) FROM PUBLIC",
    );
    expect(schema).toContain(
      "GRANT EXECUTE ON FUNCTION public.delivery_groups_share_students(uuid, uuid) TO authenticated, service_role",
    );
  });

  test("the single server conflict helper consults the shared-student authority", () => {
    expect(schema).toContain("CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap");
    expect(schema).toContain("v_shared := public.delivery_groups_share_students(");
    expect(schema).toContain("v_shared := true;");
  });

  test("data apply is scoped to the approved Jawf ids and is idempotent", () => {
    expect(data).toContain("a54be564-b9cc-4c23-8b02-504453100123");
    expect(data).toContain("7168345f-cf9d-4789-b2ad-547abb687dc8");
    expect(data).toContain("dd991d15-aef5-4e3e-a59d-724a89ee1f66");
    expect(data).toContain("18dd364a-76d7-40b8-a217-fa929c082a7f");
    expect(data).toContain("TARGET_COHORT_MISMATCH");
    expect(data).toContain("ON CONFLICT (cohort_id, partition_code) DO NOTHING");
    expect(data).toContain("ON CONFLICT (delivery_group_id, partition_id) DO NOTHING");
    expect(data).toContain("PARTITION_COVERAGE_INCOMPLETE");
    // never touches sessions or other cohorts
    expect(data).not.toMatch(/UPDATE\s+public\.schedule_sessions/);
    expect(data).not.toMatch(/DELETE\s+FROM\s+public\.schedule_sessions/);
  });

  test("preflight, postverify and rollback are all provided", () => {
    expect(checks).toContain("PREFLIGHT");
    expect(checks).toContain("POSTVERIFY");
    expect(checks).toContain("ROLLBACK");
    expect(checks).toContain("9ed1e0a2-bd5c-4515-bd62-6ab5854062c7");
    expect(checks).toContain("delivery_groups_share_students(a.id, b.id)");
  });
});
