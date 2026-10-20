/* eslint-disable @typescript-eslint/no-explicit-any -- untyped dynamic tables, as in the original data-cleanup page */
import { supabase } from "@/integrations/supabase/client";
import { chunkIds, readAllRows } from "@/lib/supabase/read-all";
import { firstQueryError } from "@/lib/data-cleanup-bulk";

/** Data-cleanup reads: one paginated college-wide fetch (split from data-cleanup.tsx, L-14). */
// ---------- types ----------
export type CourseRow = {
  id: string;
  code: string;
  name: string;
  course_nature: string | null;
  department_id: string | null;
};
export type PlanCourseRow = {
  id: string;
  course_id: string;
  lectures_per_week: number | null;
  labs_per_week: number | null;
  lecture_session_duration: number | null;
  lab_session_duration: number | null;
  required_room_type_for_lecture: string | null;
  required_room_type_for_lab: string | null;
};
export type InstructorRow = {
  id: string;
  full_name: string;
  specialization: string | null;
  department_id: string | null;
  instructor_type_id: string | null;
};
export type RoomRow = {
  id: string;
  code: string;
  name: string;
  capacity: number;
  room_type_id: string | null;
  is_active: boolean;
};
export type OfferingRow = {
  id: string;
  expected_students: number;
  study_plan_id: string | null;
  plan_course_id: string | null;
  study_system: string | null;
  course_id: string;
};

// ---------- data fetch ----------
/** H-10: large selections are updated in id chunks so `.in()` never overflows the URL. */
export async function updateByIdChunks(
  table: "courses" | "instructors" | "rooms" | "course_offerings",
  patch: Record<string, unknown>,
  ids: string[],
): Promise<{ error: { message: string } | null }> {
  for (const chunk of chunkIds(ids)) {
    const { error } = await (supabase as any).from(table).update(patch).in("id", chunk);
    if (error) return { error };
  }
  return { error: null };
}

export async function fetchAll(collegeId: string) {
  // H-10: every table is read college-wide, so each read is paginated through
  // readAllRows (PostgREST caps a response at 1000 rows) and reported in the
  // same { data, error } shape the diagnostics below expect.
  // Query builders mutate in place, so a fresh builder is created per page.
  const readCollegeRows = async (q: () => any): Promise<{ data: any[] | null; error: any }> => {
    try {
      const data = await readAllRows<any>((from, to) =>
        q().eq("college_id", collegeId).order("id").range(from, to),
      );
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error ?? new Error("تعذر قراءة البيانات") };
    }
  };
  const [
    courses,
    planCourses,
    instructors,
    availability,
    rooms,
    offerings,
    assignments,
    departments,
    instructorTypes,
    roomTypes,
  ] = await Promise.all([
    readCollegeRows(() =>
      supabase.from("courses").select("id, code, name, course_nature, department_id"),
    ),
    readCollegeRows(() =>
      supabase
        .from("plan_courses")
        .select(
          "id, course_id, lectures_per_week, labs_per_week, lecture_session_duration, lab_session_duration, required_room_type_for_lecture, required_room_type_for_lab",
        ),
    ),
    readCollegeRows(() =>
      supabase
        .from("instructors")
        .select("id, full_name, specialization, department_id, instructor_type_id"),
    ),
    readCollegeRows(() => supabase.from("instructor_availability").select("id, instructor_id")),
    readCollegeRows(() =>
      supabase.from("rooms").select("id, code, name, capacity, room_type_id, is_active"),
    ),
    readCollegeRows(() =>
      supabase
        .from("course_offerings")
        .select("id, expected_students, study_plan_id, plan_course_id, study_system, course_id"),
    ),
    readCollegeRows(() => supabase.from("teaching_assignments").select("id, course_offering_id")),
    readCollegeRows(() => supabase.from("departments").select("id, name")),
    readCollegeRows(() => supabase.from("instructor_types").select("id, name_ar, code, is_active")),
    readCollegeRows(() =>
      supabase.from("room_types").select("id, name_ar, code, default_capacity, is_active"),
    ),
  ]);
  const loadError = firstQueryError([
    { label: "المقررات", error: courses.error },
    { label: "مقررات الخطة", error: planCourses.error },
    { label: "المحاضرون", error: instructors.error },
    { label: "التوفّر", error: availability.error },
    { label: "القاعات", error: rooms.error },
    { label: "الطروحات", error: offerings.error },
    { label: "الإسنادات", error: assignments.error },
    { label: "الأقسام", error: departments.error },
    { label: "أنواع المحاضرين", error: instructorTypes.error },
    { label: "أنواع القاعات", error: roomTypes.error },
  ]);
  if (loadError) throw new Error(loadError);
  type TypeRow = { id: string; name_ar: string; code: string | null; is_active: boolean | null };
  const activeOnly = <T extends { is_active: boolean | null }>(rows: T[]) =>
    rows.filter((r) => r.is_active !== false);
  return {
    courses: (courses.data ?? []) as CourseRow[],
    planCourses: (planCourses.data ?? []) as PlanCourseRow[],
    instructors: (instructors.data ?? []) as InstructorRow[],
    availability: (availability.data ?? []) as { id: string; instructor_id: string }[],
    rooms: (rooms.data ?? []) as RoomRow[],
    offerings: (offerings.data ?? []) as OfferingRow[],
    assignments: (assignments.data ?? []) as { id: string; course_offering_id: string }[],
    departments: (departments.data ?? []) as { id: string; name: string }[],
    instructorTypes: activeOnly((instructorTypes.data ?? []) as TypeRow[]),
    roomTypes: activeOnly(
      (roomTypes.data ?? []) as (TypeRow & { default_capacity: number | null })[],
    ),
  };
}
