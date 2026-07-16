/**
 * Phase 9.2 — Academic delivery V2 generator / component-hours harness.
 * Pure logic only — no DB writes.
 */
import { parsePlanComponentHours } from "../../src/lib/academic-delivery-v2/component-hours";
import {
  computeDeliveryGroupCount,
  buildGroupCodes,
} from "../../src/lib/academic-delivery-v2/group-count";
import { planCohortDelivery } from "../../src/lib/academic-delivery-v2/generator-plan";
import {
  formatElectiveCourseLabel,
  componentTypeToSessionType,
} from "../../src/lib/academic-delivery-v2/types";
import {
  isExcludedFromRegularLoad,
  resolveOfferingDisplayName,
} from "../../src/lib/schedule-builder/v2-compat";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function run() {
  // --- Component hours ---
  {
    const missing = parsePlanComponentHours({}, { credit_hours: 3 });
    assert(!missing.ok, "1 missing explicit hours rejected");
    if (!missing.ok) assert(missing.errors[0]?.code === "missing_component_hours", "1 code");
  }
  {
    const ok = parsePlanComponentHours(
      { theory_hours: 2, practical_hours: 2 },
      { credit_hours: 3 },
    );
    assert(ok.ok, "2 theory+practical ok");
    if (ok.ok) {
      assert(ok.data.components.length === 2, "2 comps");
      assert(
        ok.data.components.every((c) => c.weekly_contact_hours > 0),
        "2 positive",
      );
    }
  }
  {
    const zeroOnly = parsePlanComponentHours({ theory_hours: 0, practical_hours: 0 });
    assert(!zeroOnly.ok, "3 zero-only rejected");
  }
  {
    const withTutorial = parsePlanComponentHours({ theory_hours: 2, tutorial_hours: 1 });
    assert(withTutorial.ok, "5 tutorial ok");
    if (withTutorial.ok) {
      assert(
        withTutorial.data.components.some((c) => c.component_type === "tutorial"),
        "5 has tutorial",
      );
    }
  }
  {
    const project = parsePlanComponentHours({ project_hours: 2 });
    assert(project.ok, "6 project ok");
    if (project.ok) {
      const p = project.data.components.find((c) => c.component_type === "project");
      assert(!!p && p.counts_toward_regular_load === false, "6 project outside regular load");
      assert(!!p && p.is_timetabled === true, "6 project timetabled");
    }
  }
  {
    const summer = parsePlanComponentHours({ summer_training_hours: 3 });
    assert(summer.ok, "7 summer ok");
    if (summer.ok) {
      const s = summer.data.components.find((c) => c.component_type === "summer_training");
      assert(!!s && s.is_timetabled === false, "7 summer not weekly");
    }
  }

  // --- Group counts ---
  {
    // 1. cohort smaller than hall capacity
    const r = computeDeliveryGroupCount({
      component_type: "theory",
      student_count: 40,
      roomType: { id: "rt1", default_capacity: 60, strict_capacity: false },
    });
    assert(r.ok && r.group_count === 1, "case1 theory under capacity → 1");
  }
  {
    // 2. exceeds hall capacity
    const r = computeDeliveryGroupCount({
      component_type: "theory",
      student_count: 90,
      roomType: { id: "rt1", default_capacity: 60, strict_capacity: false },
    });
    assert(r.ok && r.group_count === 2, "case2 theory over capacity → 2");
  }
  {
    // 3. practical strict 30
    const r = computeDeliveryGroupCount({
      component_type: "practical",
      student_count: 75,
      roomType: { id: "lab", default_capacity: 30, strict_capacity: true },
    });
    assert(r.ok && r.group_count === 3, "case3 practical ceil(75/30)=3");
  }
  {
    const fail = computeDeliveryGroupCount({
      component_type: "practical",
      student_count: 30,
      roomType: { id: "lab", default_capacity: 30, strict_capacity: false },
    });
    assert(!fail.ok && fail.error_code === "missing_strict_lab_capacity", "case3b no silent guess");
  }
  {
    // 5. tutorial independent
    const r = computeDeliveryGroupCount({
      component_type: "tutorial",
      student_count: 60,
      roomType: { id: "sem", default_capacity: 30, strict_capacity: false },
    });
    assert(r.ok && r.group_count === 2, "case5 tutorial splits by capacity");
  }
  {
    // 6. project outside regular load
    const r = computeDeliveryGroupCount({
      component_type: "project",
      student_count: 60,
      roomType: null,
    });
    assert(r.ok && r.group_count === 1, "case6 project 1 group");
    assert(isExcludedFromRegularLoad({ component_type: "project" }), "case6 exclude load");
  }
  {
    // 7. summer_training outside scheduling
    const r = computeDeliveryGroupCount({
      component_type: "summer_training",
      student_count: 60,
      roomType: null,
    });
    assert(r.ok && r.group_count === 0, "case7 summer no groups");
    assert(componentTypeToSessionType("summer_training") === null, "case7 no session type");
  }

  // --- Generator plan (idempotency + electives) ---
  const lectureRt = { id: "lec", default_capacity: 60, strict_capacity: false };
  const labRt = { id: "lab", default_capacity: 30, strict_capacity: true };
  const room_types = new Map([
    ["lec", lectureRt],
    ["lab", labRt],
  ]);

  const baseInput = {
    cohort: {
      id: "coh1",
      college_id: "col1",
      program_id: "prog1",
      level_id: "lvl3",
      study_system: "regular",
      term_id: "term1",
      entry_year: 2023,
      expected_students: 55,
      semester: 1,
    },
    study_plan_id: "sp1",
    plan_courses: [
      {
        id: "pc1",
        course_id: "c1",
        course_code: "CS301",
        course_name: "شبكات",
        level_id: "lvl3",
        semester: 1,
        is_required: true,
      },
    ],
    components: [
      {
        id: "comp-th",
        plan_course_id: "pc1",
        component_type: "theory" as const,
        weekly_contact_hours: 2,
        required_room_type_id: "lec",
        is_timetabled: true,
        counts_toward_regular_load: true,
      },
      {
        id: "comp-pr",
        plan_course_id: "pc1",
        component_type: "practical" as const,
        weekly_contact_hours: 2,
        required_room_type_id: "lab",
        is_timetabled: true,
        counts_toward_regular_load: true,
      },
    ],
    elective_slots: [] as Array<{
      id: string;
      slot_code: string;
      semester: number;
      level_id: string | null;
      allowed_course_ids: string[];
    }>,
    elective_selections: [] as Array<{
      elective_slot_id: string;
      selected_course_id: string;
      selected_course_code: string;
      selected_course_name: string;
      plan_course_id: string | null;
    }>,
    room_types,
    existing_offerings: new Set<string>(),
    existing_delivery_groups: new Set<string>(),
  };

  {
    // 4. theory + practical
    const plan = planCohortDelivery(baseInput);
    assert(plan.summary.validation_errors.length === 0, "case4 no errors");
    assert(plan.offerings.length === 1, "case4 one offering");
    assert(plan.offerings[0].action === "create", "case4 create");
    // theory: 55<=60 → 1; practical: ceil(55/30)=2
    const theoryGroups = plan.delivery_groups.filter((g) => g.component_type === "theory");
    const pracGroups = plan.delivery_groups.filter((g) => g.component_type === "practical");
    assert(theoryGroups.length === 1, "case4 theory 1");
    assert(pracGroups.length === 2, "case4 practical 2");
  }

  {
    // 8. elective slot without selection
    const plan = planCohortDelivery({
      ...baseInput,
      plan_courses: [],
      components: [],
      elective_slots: [
        {
          id: "slot1",
          slot_code: "CY3XX(E)",
          semester: 1,
          level_id: "lvl3",
          allowed_course_ids: ["cE1"],
        },
      ],
      elective_selections: [],
    });
    assert(
      plan.summary.validation_errors.some((e) => e.code === "elective_slot_unselected"),
      "case8 unselected elective",
    );
  }

  {
    // 9. elective not allowed
    const plan = planCohortDelivery({
      ...baseInput,
      plan_courses: [],
      components: [
        {
          id: "comp-e",
          plan_course_id: "pcE",
          component_type: "theory",
          weekly_contact_hours: 2,
          required_room_type_id: "lec",
          is_timetabled: true,
          counts_toward_regular_load: true,
        },
      ],
      elective_slots: [
        {
          id: "slot1",
          slot_code: "CY3XX(E)",
          semester: 1,
          level_id: "lvl3",
          allowed_course_ids: ["cAllowed"],
        },
      ],
      elective_selections: [
        {
          elective_slot_id: "slot1",
          selected_course_id: "cBad",
          selected_course_code: "BAD1",
          selected_course_name: "غير مسموح",
          plan_course_id: "pcE",
        },
      ],
    });
    assert(
      plan.summary.validation_errors.some((e) => e.code === "elective_course_not_allowed"),
      "case9 not allowed",
    );
  }

  {
    // elective allowed + display label
    const plan = planCohortDelivery({
      ...baseInput,
      plan_courses: [],
      components: [
        {
          id: "comp-e",
          plan_course_id: "pcE",
          component_type: "theory",
          weekly_contact_hours: 2,
          required_room_type_id: "lec",
          is_timetabled: true,
          counts_toward_regular_load: true,
        },
      ],
      elective_slots: [
        {
          id: "slot1",
          slot_code: "CY3XX(E)",
          semester: 1,
          level_id: "lvl3",
          allowed_course_ids: ["cE1"],
        },
      ],
      elective_selections: [
        {
          elective_slot_id: "slot1",
          selected_course_id: "cE1",
          selected_course_code: "CY301",
          selected_course_name: "أمن الشبكات",
          plan_course_id: "pcE",
        },
      ],
    });
    assert(plan.summary.validation_errors.length === 0, "elective ok");
    assert(
      plan.offerings[0]?.display_name === formatElectiveCourseLabel("أمن الشبكات"),
      "elective display label",
    );
    assert(
      resolveOfferingDisplayName({ is_elective: true, course_name: "أمن الشبكات" }).includes(
        "مقرر اختياري",
      ),
      "compat display",
    );
  }

  {
    // 10. idempotent re-run → update not create
    const first = planCohortDelivery(baseInput);
    const existingOff = new Set(first.offerings.map((o) => o.course_id));
    const existingDg = new Set(
      first.delivery_groups.map((g) => `${g.component_id}|${g.group_code}`),
    );
    const second = planCohortDelivery({
      ...baseInput,
      existing_offerings: existingOff,
      existing_delivery_groups: existingDg,
    });
    assert(
      second.offerings.every((o) => o.action === "update"),
      "case10 offerings update",
    );
    assert(
      second.delivery_groups.every((g) => g.action === "update"),
      "case10 groups update",
    );
    assert(
      second.delivery_groups.length === first.delivery_groups.length,
      "case10 same group count (no duplication)",
    );
    assert(buildGroupCodes(2).join(",") === "G1,G2", "group codes stable");
  }

  console.log("academic-delivery-v2-generator.harness.ts: PASS");
}

run();
