import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolveAcademicProgramOwner } from "../src/lib/reports/academic-program-owner.ts";
const programs = [
  {
    id: "old-jouf",
    college_id: "itcs",
    department_id: "old-dept",
    name: "نظم الجوف التاريخي",
    canonical_program_id: "jouf-program",
  },
  {
    id: "jouf-program",
    college_id: "jouf",
    department_id: "jouf-dept",
    name: "نظم المعلومات - الجوف",
    canonical_program_id: null,
  },
  {
    id: "itcs-program",
    college_id: "itcs",
    department_id: "itcs-dept",
    name: "نظم المعلومات",
    canonical_program_id: null,
  },
  {
    id: "admin-program",
    college_id: "admin",
    department_id: "admin-dept",
    name: "التسويق",
    canonical_program_id: null,
  },
];
test("canonical ownership uses explicit IDs, including multi-hop links", () => {
  const map = new Map(programs.map((p) => [p.id, p]));
  map.set("older", { ...programs[0], id: "older", canonical_program_id: "old-jouf" });
  assert.equal(resolveAcademicProgramOwner("older", map).college_id, "jouf");
  assert.equal(resolveAcademicProgramOwner("itcs-program", map).college_id, "itcs");
});
test("similar names cannot manufacture cross-college ownership", () => {
  const p = { ...programs[0], canonical_program_id: null };
  assert.equal(resolveAcademicProgramOwner(p.id, new Map([[p.id, p]])).college_id, "itcs");
});
test("missing and cyclic canonical records reject inaccurate attribution", () => {
  assert.throws(
    () => resolveAcademicProgramOwner("old-jouf", new Map([[programs[0].id, programs[0]]])),
    /تعذر قراءة/,
  );
  const cyclic = programs.map((p) =>
    p.id === "jouf-program" ? { ...p, canonical_program_id: "old-jouf" } : p,
  );
  assert.throws(
    () => resolveAcademicProgramOwner("old-jouf", new Map(cyclic.map((p) => [p.id, p]))),
    /دائري/,
  );
});
const fixture = { programs, roles: ["super_admin"], sessions: [] };
const colleges = [
  { id: "itcs", name: "كلية التكنولوجيا" },
  { id: "jouf", name: "كلية الجوف" },
  { id: "admin", name: "كلية الإدارية" },
];
const departments = programs.map((p) => ({ id: p.department_id, name: p.department_id }));
globalThis.__ownerFixture = fixture;
globalThis.__ownerDb = {
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  // Mirrors public.academic_program_owners: owners only for programs the caller reads.
  async rpc(name, { p_program_ids }) {
    if (name !== "academic_program_owners") throw new Error("Unexpected RPC: " + name);
    const all = new Map(fixture.programs.map((p) => [p.id, p]));
    const readable = (p) => fixture.roles.includes("super_admin") || p.college_id === "itcs";
    return {
      data: p_program_ids
        .filter((id) => all.has(id) && readable(all.get(id)))
        .map((id) => {
          const owner = resolveAcademicProgramOwner(id, all);
          return {
            program_id: id,
            owner_program_id: owner.id,
            program_name: owner.name,
            college_id: owner.college_id,
            college_name: colleges.find((c) => c.id === owner.college_id).name,
            department_name: owner.department_id,
          };
        }),
      error: null,
    };
  },
  from(table) {
    if (table === "academic_programs" || table === "colleges" || table === "departments")
      throw new Error("Ownership must not be read from tenant tables: " + table);
    if (table === "user_roles")
      return {
        select: () => ({ eq: async () => ({ data: fixture.roles.map((role) => ({ role })) }) }),
      };
    let ids = [];
    const q = {
      select: () => q,
      in: (_key, values) => {
        ids = values;
        return q;
      },
      order: () => q,
      range: async (from, to) => ({
        data: ({ academic_programs: fixture.programs, colleges, departments }[table] ?? [])
          .filter((x) => ids.includes(x.id))
          .slice(from, to + 1),
        error: null,
      }),
    };
    return q;
  },
};
const bundle = await build({
  entryPoints: ["src/lib/reports/queries/university-instructor-schedule.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "report-fixtures",
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({
          path: "db",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^@\/lib\/instructors\/faculty-workflow$/ }, () => ({
          path: "faculty",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /^\.\/session-queries$/ }, () => ({
          path: "sessions",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "db"
              ? "export const supabase=globalThis.__ownerDb;"
              : path === "faculty"
                ? "export const facultyWorkflow={};"
                : "export const fetchInstructorScheduleSessions=async p=>globalThis.__ownerFixture.sessions.filter(s=>s.college_id===p.collegeId); export const fetchCohortDeliveryGroupLabels=async()=>({cohorts:new Map(),deliveryGroups:new Map()});",
        }));
      },
    },
  ],
});
const api = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
const { summarizeUniversitySchedule } =
  await import("../src/lib/reports/university-instructor-schedule.ts");
fixture.sessions = ["old-jouf", "old-jouf", "itcs-program", "admin-program"].map((program, i) => ({
  id: "s" + i,
  college_id: i === 3 ? "admin" : "itcs",
  day_of_week: i,
  start_time: "08:00:00",
  end_time: "11:00:00",
  instructor_id: "teacher",
  course_offerings: {
    program_id: program,
    academic_programs: { name: program },
    courses: { name: "مقرر", departments: { name: "قسم مصدر المقرر" } },
  },
}));
const input = {
  anchorCollegeId: "itcs",
  selected: { id: "teacher", university_number: null },
  records: [],
  scopes: ["itcs", "admin"].map((id) => ({
    collegeId: id,
    collegeName: colleges.find((c) => c.id === id).name,
    version: { id: "v-" + id, name: "جدول " + id },
    options: [],
  })),
};
test("real query maps hosted Jouf lectures and the quota summary to three academic colleges", async () => {
  const sessions = await api.fetchUniversityInstructorSchedule(input);
  assert.equal(sessions.length, 4);
  assert.equal(sessions[0].college_name, "كلية الجوف");
  assert.equal(sessions[0].source_college_id, "itcs");
  assert.equal(sessions[0].department_name, "jouf-dept");
  assert.equal(sessions[0].program_name, "نظم المعلومات - الجوف");
  assert.deepEqual(
    sessions.map((s) => s.id),
    ["s0", "s1", "s2", "s3"],
  );
  const summary = summarizeUniversitySchedule([...sessions, sessions[0]], {});
  assert.equal(summary.totalHours, 12);
  assert.deepEqual(Object.fromEntries(summary.colleges.map((c) => [c.collegeId, c.hours])), {
    jouf: 6,
    itcs: 3,
    admin: 3,
  });
});
test("academic ownership does not expand the authorized session read scope", async () => {
  fixture.roles = ["college_admin"];
  try {
    const sessions = await api.fetchUniversityInstructorSchedule(input);
    assert.equal(sessions.length, 3);
    assert.ok(sessions.every((s) => s.source_college_id === "itcs"));
    // A college administrator still sees the owning college of a hosted lecture.
    assert.equal(sessions[0].college_name, "كلية الجوف");
    assert.equal(sessions[0].program_name, "نظم المعلومات - الجوف");
  } finally {
    fixture.roles = ["super_admin"];
  }
});

test("the server resolves owners only for programs the caller can read", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(
    "supabase/migrations/20261003040000_academic_program_owners.sql",
    "utf8",
  );
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /public\.can_view_college\(auth\.uid\(\), p\.college_id\)/);
  assert.match(sql, /NOT p\.id = ANY \(c\.path\)/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.academic_program_owners\(uuid\[\]\) FROM PUBLIC, anon/,
  );
});
