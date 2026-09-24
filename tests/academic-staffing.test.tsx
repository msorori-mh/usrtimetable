import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AcademicStaffingEntry,
  AcademicStaffingPanel,
} from "../src/components/reports/academic-staffing-panel";
import {
  buildStaffingReadiness,
  staffingReadinessExport,
  STAFFING_VERIFICATION_REQUIREMENTS,
} from "../src/lib/reports/academic-staffing";
import { leadershipCollegeSchema } from "../src/lib/reports/leadership";

function college(patch: Record<string, unknown> = {}) {
  return leadershipCollegeSchema.parse({
    college_id: "00000000-0000-4000-8000-000000000001",
    college: "كلية العينة",
    term_id: "00000000-0000-4000-8000-000000000002",
    term: "الفصل الأول",
    term_state: "ready",
    year_inferred: false,
    departments: 1,
    programs: 2,
    faculty_count: 3,
    faculty_directory_count: 3,
    rank_counts: { "أستاذ مساعد": 2, معيد: 1 },
    employment_counts: { full_time: 3 },
    incomplete_faculty: 0,
    net_quota: 36,
    faculty_assigned_hours: 36,
    overload: 0,
    deficit: 0,
    groups_count: 12,
    covered_groups: 12,
    required_hours: 36,
    covered_hours: 36,
    assigned_hours: 36,
    uncovered_hours: 0,
    pending_groups: 0,
    pending_group_hours: 0,
    overallocated_groups: 0,
    version_id: "00000000-0000-4000-8000-000000000003",
    version: "منشور",
    version_updated_at: null,
    sessions_count: 12,
    teaching_hours: 36,
    theory_hours: 24,
    practical_hours: 12,
    other_hours: 0,
    room_count: 2,
    halls: 1,
    labs: 1,
    seats: 100,
    used_rooms: 2,
    ...patch,
  });
}

test("published, fully covered, classified and populated data never certify staffing results", () => {
  const row = buildStaffingReadiness(college());
  assert.equal(row.status, "جاري التطوير");
  assert.equal(row.proposedPositions, null);
  assert.equal(row.staffingGapHours, null);
  assert.equal(row.recommendation, null);
  assert.equal(row.quotas.state, "available");
  assert.match(row.quotas.detail, /اعتماد صفة التعيين مطلوب/);
});

test("missing period or inferred year does not masquerade as verified completeness", () => {
  for (const term_state of ["missing", "ambiguous"]) {
    const row = buildStaffingReadiness(college({ term_state, term_id: null }));
    assert.equal(row.period.state, "incomplete");
    assert.equal(row.demand.state, "unavailable");
    assert.equal(row.quotas.state, "unavailable");
    assert.equal(row.assignments.state, "unavailable");
  }
  assert.equal(buildStaffingReadiness(college({ year_inferred: true })).period.state, "incomplete");
  assert.equal(buildStaffingReadiness(college({ year_inferred: null })).period.state, "incomplete");
});

test("null and empty inputs stay unknown rather than complete zero", () => {
  const row = buildStaffingReadiness(
    college({
      groups_count: null,
      faculty_count: null,
      incomplete_faculty: null,
      net_quota: null,
      faculty_directory_count: 0,
      rank_counts: {},
    }),
  );
  assert.equal(row.demand.state, "unavailable");
  assert.equal(row.quotas.state, "unavailable");
  assert.equal(row.ranks.state, "unavailable");
  assert.equal(buildStaffingReadiness(college({ groups_count: 0 })).demand.state, "incomplete");
});

test("known zero quota remains a recorded value but cannot unlock results", () => {
  const row = buildStaffingReadiness(college({ net_quota: 0, incomplete_faculty: 0 }));
  assert.equal(row.quotas.state, "available");
  assert.equal(row.proposedPositions, null);
});

test("incomplete quota/split and over-allocation are visible, inconsistent counts are unknown", () => {
  const row = buildStaffingReadiness(
    college({ incomplete_faculty: 2, pending_groups: 1, overallocated_groups: 2 }),
  );
  assert.equal(row.quotas.state, "incomplete");
  assert.equal(row.assignments.state, "incomplete");
  assert.equal(
    buildStaffingReadiness(college({ incomplete_faculty: 4 })).quotas.state,
    "unavailable",
  );
});

test("unknown, omitted and ambiguous ranks are not silently mapped to teaching categories", () => {
  for (const rank_counts of [{ "غير محدد": 3 }, { محاضر: 3 }, { دكتوراه: 3 }, { "أستاذ مساعد": 2 }])
    assert.equal(buildStaffingReadiness(college({ rank_counts })).ranks.state, "incomplete");
  assert.equal(
    buildStaffingReadiness(
      college({ rank_counts: { assistant_professor: 2, teaching_assistant: 1 } }),
    ).ranks.state,
    "available",
  );
  assert.equal(
    buildStaffingReadiness(college({ rank_counts: { "أستاذ مساعد": 4 } })).ranks.state,
    "unavailable",
  );
});

test("unused personal quota, temporary coverage and employment labels cannot become hiring numbers", () => {
  const baseline = buildStaffingReadiness(college());
  const altered = buildStaffingReadiness(
    college({
      deficit: 100,
      overload: 200,
      uncovered_hours: 0,
      employment_counts: { contract: 3 },
    }),
  );
  assert.deepEqual(altered, baseline);
});

test("CSV/XLSX rows retain the development notice and requirements without invented results", () => {
  const row = staffingReadinessExport(college());
  assert.equal(row.staffing_status, "جاري التطوير");
  assert.match(row.staffing_verification, /إثبات اكتمال البيانات/);
  assert.ok(Object.values(row).every((value) => typeof value === "string"));
  assert.equal(STAFFING_VERIFICATION_REQUIREMENTS.length, 8);
});

test("entry opens readiness and keeps the notice in the printable markup", () => {
  let opened = false;
  const entry = AcademicStaffingEntry({
    onOpen: () => {
      opened = true;
    },
  });
  const button = entry.props.children[1].props.children[1];
  button.props.onClick();
  assert.equal(opened, true);
  const html = renderToStaticMarkup(entry);
  assert.match(html, /جاري التطوير/);
  assert.match(html, /إثبات اكتمال البيانات/);
});

test("panel renders only provided scope, escapes names, and handles empty/stale snapshots", () => {
  const html = renderToStaticMarkup(
    <AcademicStaffingPanel colleges={[college({ college: "<script>test</script>" })]} stale />,
  );
  assert.ok(html.includes("&lt;script&gt;test&lt;/script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /آخر قراءة ناجحة/);
  assert.match(html, /لم يثبت اكتمالها بعد/);
  assert.match(html, /10% و15%/);
  assert.match(html, /dir="rtl"/);
  assert.doesNotMatch(html, /درجة وظيفية مطلوبة|لا حاجة للتوظيف|معتمد نهائيًا/);
  assert.match(
    renderToStaticMarkup(<AcademicStaffingPanel colleges={[]} />),
    /لا يمكن إثبات الاكتمال/,
  );
});

test("integration reuses authorized executive scope, cache identity and export gate", () => {
  const route = readFileSync("src/routes/_authenticated/reports.leadership.tsx", "utf8");
  const component = readFileSync("src/components/reports/academic-staffing-panel.tsx", "utf8");
  assert.match(route, /canViewLeadership\(me\)/);
  assert.match(route, /queryKey: \["university-leadership", viewerKey, period\]/);
  assert.match(route, /<AcademicStaffingPanel colleges=\{scoped\}/);
  assert.match(route, /\.\.\.staffingReadinessExport\(college\)/);
  assert.match(route, /\.\.\.STAFFING_EXPORT_HEADERS/);
  assert.doesNotMatch(component, /supabase|localStorage|sessionStorage|\.rpc\(|\.from\(/);
});
