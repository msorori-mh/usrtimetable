import { test, expect } from "bun:test";
// @ts-expect-error -- plain .mjs script without types
import { scanSource } from "../scripts/check-unbounded-selects.mjs";

test("H-10 guard flags unbounded big-table reads and accepts bounded/paginated ones", () => {
  const src = `
    const a = await supabase.from("schedule_sessions").select("id").eq("college_id", c);
    const b = await supabase.from("schedule_sessions").select("id").range(0, 9);
    const c2 = await supabase.from("teaching_assignments").select("id", { count: "exact", head: true });
    const d = await readAllRows((from, to) => supabase.from("plan_courses").select("id").order("id").range(from, to));
    const e = await supabase.from("courses").select("id").eq("id", x).maybeSingle();
    // read-all-ok: single user's roles
    const f = await supabase.from("user_roles").select("role").eq("user_id", u);
    const g = await supabase.from("rooms").select("id");
    const h = await supabase.from("plan_courses").update({ a: 1 }).in("id", ids).select("id");
    const i = await supabase.from("instructor_availability").select("id").in("instructor_id", ids);
  `;
  const out = scanSource(src) as Array<{ table: string; line: number }>;
  expect(out.map((o) => o.table)).toEqual(["schedule_sessions", "instructor_availability"]);
});
