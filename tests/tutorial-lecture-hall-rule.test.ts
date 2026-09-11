/**
 * TUTORIAL-LECTURE-HALL-PERMANENT-RULE-01 — focused tests.
 * tutorial => lecture_hall everywhere (import / editor / assignment); practical untouched.
 */
import { describe, expect, it } from "bun:test";
import {
  findTutorialRoomType,
  resolveTutorialAssignmentRoomType,
  resolveTutorialRoomTypeId,
  tutorialRoomTypeIsLocked,
  TUTORIAL_ROOM_TYPE_CODE,
} from "@/lib/academic-delivery/tutorial-room-type";
import { validatePlanRowRoomTypes } from "@/lib/academic-delivery/plan-component-room-types";
import {
  normalizeComponentFormRoomType,
  validateComponentForm,
  type ComponentForm,
  type PlanContext,
  type RoomTypeOption,
} from "@/lib/academic-delivery/plan-course-editor";

const COLLEGE = "college-1";

const LH = {
  id: "rt-lh",
  code: "lecture_hall",
  college_id: COLLEGE,
  is_active: true,
  default_capacity: 75,
};
const LAB = {
  id: "rt-lab",
  code: "computer_lab",
  college_id: COLLEGE,
  is_active: true,
  default_capacity: 38,
};

const ctx: PlanContext = { collegeId: COLLEGE, studyPlanId: "plan-1", programId: "prog-1" };
const roomTypeOptions: RoomTypeOption[] = [
  { id: LH.id, name_ar: "قاعة محاضرات", code: LH.code, college_id: COLLEGE, is_active: true },
  { id: LAB.id, name_ar: "معمل حاسوب", code: LAB.code, college_id: COLLEGE, is_active: true },
];

const form = (over: Partial<ComponentForm>): ComponentForm => ({
  component_type: "tutorial",
  weekly_contact_hours: 2,
  required_room_type_id: null,
  is_timetabled: true,
  counts_toward_regular_load: true,
  counts_toward_overtime: true,
  compensation_mode: "per_hour",
  explicit_group_size: null,
  ...over,
});

describe("tutorial room type contract", () => {
  it("auto-binds tutorial to the college lecture_hall", () => {
    const res = resolveTutorialRoomTypeId({
      componentType: "tutorial",
      requiredRoomTypeId: null,
      roomTypes: [LAB, LH],
      collegeId: COLLEGE,
    });
    expect(res).toEqual({ ok: true, requiredRoomTypeId: LH.id, corrected: true });
    expect(findTutorialRoomType([LAB, LH], COLLEGE)?.code).toBe(TUTORIAL_ROOM_TYPE_CODE);
  });

  it("rejects tutorial + computer_lab deterministically", () => {
    const res = resolveTutorialRoomTypeId({
      componentType: "tutorial",
      requiredRoomTypeId: LAB.id,
      roomTypes: [LAB, LH],
      collegeId: COLLEGE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe("TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL");
  });

  it("fails clearly when the college has no lecture_hall", () => {
    const res = resolveTutorialRoomTypeId({
      componentType: "tutorial",
      requiredRoomTypeId: null,
      roomTypes: [LAB],
      collegeId: COLLEGE,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorCode).toBe("TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING");
  });

  it("leaves practical components untouched", () => {
    expect(
      resolveTutorialRoomTypeId({
        componentType: "practical",
        requiredRoomTypeId: LAB.id,
        roomTypes: [LAB, LH],
        collegeId: COLLEGE,
      }),
    ).toEqual({ ok: true, requiredRoomTypeId: LAB.id, corrected: false });
    expect(tutorialRoomTypeIsLocked("practical")).toBe(false);
    expect(tutorialRoomTypeIsLocked("tutorial")).toBe(true);
  });
});

describe("import validation (plan rows)", () => {
  it("resolves tutorial to lecture_hall even when the file omits the code", () => {
    const out = validatePlanRowRoomTypes({
      courseCode: "CS200",
      hours: { theory_hours: 2, tutorial_hours: 2 },
      roomTypeCodes: { required_room_type_code_lecture: "lecture_hall" },
      collegeId: COLLEGE,
      catalog: [LH, LAB],
    });
    expect(out.errors).toEqual([]);
    expect(out.resolvedIds.tutorial).toBe(LH.id);
    expect(out.resolvedIds.theory).toBe(LH.id);
  });

  it("rejects a manifest that gives tutorial a lab room type", () => {
    const out = validatePlanRowRoomTypes({
      courseCode: "CS201",
      hours: { theory_hours: 2, tutorial_hours: 2 },
      roomTypeCodes: {
        required_room_type_code_lecture: "lecture_hall",
        required_room_type_code_tutorial: "computer_lab",
      },
      collegeId: COLLEGE,
      catalog: [LH, LAB],
    });
    expect(out.errors.map((e) => e.errorCode)).toEqual(["tutorial_room_type_must_be_lecture_hall"]);
    expect(out.resolvedIds.tutorial).toBeUndefined();
  });

  it("keeps practical bound to its own lab room type", () => {
    const out = validatePlanRowRoomTypes({
      courseCode: "CS202",
      hours: { theory_hours: 2, practical_hours: 2, tutorial_hours: 1 },
      roomTypeCodes: {
        required_room_type_code_lecture: "lecture_hall",
        required_room_type_code_practical: "computer_lab",
      },
      collegeId: COLLEGE,
      catalog: [LH, LAB],
    });
    expect(out.errors).toEqual([]);
    expect(out.resolvedIds.practical).toBe(LAB.id);
    expect(out.resolvedIds.tutorial).toBe(LH.id);
  });
});

describe("plan component editor", () => {
  it("blocks saving tutorial with a lab room type", () => {
    const res = validateComponentForm({
      ctx,
      form: form({ required_room_type_id: LAB.id }),
      roomTypes: roomTypeOptions,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL");
  });

  it("normalizes an empty tutorial room type to lecture_hall before write", () => {
    const out = normalizeComponentFormRoomType(ctx, form({}), roomTypeOptions);
    expect(out.required_room_type_id).toBe(LH.id);
    const practical = normalizeComponentFormRoomType(
      ctx,
      form({ component_type: "practical", required_room_type_id: LAB.id }),
      roomTypeOptions,
    );
    expect(practical.required_room_type_id).toBe(LAB.id);
  });

  it("accepts tutorial with lecture_hall", () => {
    expect(
      validateComponentForm({
        ctx,
        form: form({ required_room_type_id: LH.id }),
        roomTypes: roomTypeOptions,
      }),
    ).toEqual({ ok: true });
  });
});

describe("teaching assignment mirror", () => {
  it("forces lecture_hall for tutorial assignments", () => {
    expect(
      resolveTutorialAssignmentRoomType({ componentType: "tutorial", requiredRoomType: null }),
    ).toEqual({ ok: true, requiredRoomType: "lecture_hall" });
    expect(
      resolveTutorialAssignmentRoomType({
        componentType: "tutorial",
        requiredRoomType: "lecture_hall",
      }),
    ).toEqual({ ok: true, requiredRoomType: "lecture_hall" });
  });

  it("rejects tutorial assignments requesting a lab", () => {
    const res = resolveTutorialAssignmentRoomType({
      componentType: "tutorial",
      requiredRoomType: "computer_lab",
    });
    expect(res.ok).toBe(false);
  });

  it("does not touch practical assignments", () => {
    expect(
      resolveTutorialAssignmentRoomType({
        componentType: "practical",
        requiredRoomType: "computer_lab",
      }),
    ).toEqual({ ok: true, requiredRoomType: "computer_lab" });
  });
});
