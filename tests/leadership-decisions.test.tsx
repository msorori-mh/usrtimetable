import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LeadershipDecisionSummary,
  type LeadershipDecisionSummaryProps,
} from "../src/components/reports/leadership-decision-summary";
import {
  leadershipPriorities,
  decisionOrder,
  leadershipViewerKey,
  LEADERSHIP_QUERY_POLICY,
} from "../src/lib/reports/leadership-decisions";
import type { LeadershipCollege } from "../src/lib/reports/leadership";
import {
  roomHourEquivalents,
  type LeadershipCapacityCollege,
} from "../src/lib/reports/leadership-room-capacity";

const college = (id: string, patch: Partial<LeadershipCollege> = {}): LeadershipCollege => ({
  college_id: id,
  college: `كلية ${id}`,
  term_id: `t-${id}`,
  term: "الفصل الأول",
  term_state: "ready",
  year_inferred: false,
  departments: 1,
  programs: 1,
  faculty_count: 2,
  teaching_contributors: 2,
  external_contributors: 0,
  faculty_directory_count: 2,
  rank_counts: {},
  availability_counts: { متاح: 2 },
  employment_counts: {},
  incomplete_faculty: 0,
  net_quota: 20,
  faculty_assigned_hours: 20,
  overload: 0,
  deficit: 0,
  groups_count: 4,
  covered_groups: 4,
  required_hours: 20,
  covered_hours: 20,
  assigned_hours: 20,
  uncovered_hours: 0,
  pending_groups: 0,
  pending_group_hours: 0,
  overallocated_groups: 0,
  version_id: `v-${id}`,
  version: "منشور",
  version_updated_at: null,
  sessions_count: 10,
  teaching_hours: 20,
  theory_hours: 20,
  practical_hours: 0,
  other_hours: 0,
  room_count: 1,
  halls: 1,
  labs: 0,
  seats: 75,
  used_rooms: 1,
  ...patch,
});
const room = (id: string, balance: number | null): LeadershipCapacityCollege => ({
  id,
  name: `كلية ${id}`,
  rooms: [],
  availableHours: balance === null ? null : 20 + balance,
  requiredHours: 20,
  balanceHours: balance,
  surplusHours: balance === null ? null : Math.max(balance, 0),
  deficitHours: balance === null ? null : Math.max(-balance, 0),
  equivalents: roomHourEquivalents(balance === null ? null : Math.max(balance, 0)),
  emptyPublishedRooms: null,
  issues: balance === null ? ["بيانات ناقصة"] : [],
});
const props = (
  patch: Partial<LeadershipDecisionSummaryProps> = {},
): LeadershipDecisionSummaryProps => ({
  colleges: [college("a")],
  uniqueFaculty: 2,
  capacity: [room("a", 16)],
  capacityState: "ready",
  onOpen() {},
  ...patch,
});
const html = (patch: Partial<LeadershipDecisionSummaryProps> = {}) =>
  renderToStaticMarkup(createElement(LeadershipDecisionSummary, props(patch)));

// Walk real React elements to activate the handlers presented by the pure overview.
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [
    element as ReactElement<Record<string, unknown>>,
    ...[element.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode)),
  ];
}

test("unassigned teaching and real room deficits precede publication/data follow-up, one item per college", () => {
  const rows = [
    college("published", { overload: 3 }),
    college("missing", { term_state: "missing", version_id: null }),
    college("gap", { uncovered_hours: 6, version_id: null }),
    college("room"),
  ];
  const result = leadershipPriorities(rows, [room("room", -4)]);
  assert.deepEqual(
    result.map((item) => item.collegeId),
    ["gap", "room", "missing", "published"],
  );
  assert.equal(new Set(result.map((item) => item.collegeId)).size, result.length);
  assert.equal(result[0].tab, "teaching");
  assert.equal(result[1].tab, "rooms");
  assert.equal(rows[0].college_id, "published", "input order stays unchanged");
});

test("unknown capacity produces a data-completion issue, never a fabricated deficit", () => {
  const items = leadershipPriorities([college("a")], [room("a", null)]);
  assert.equal(items[0].tab, "rooms");
  assert.doesNotMatch(items[0].title, /عجز/);
  assert.deepEqual(leadershipPriorities([college("a")], []), []);
});

test("missing term suppresses misleading zero teaching and workload conclusions", () => {
  const result = leadershipPriorities(
    [college("a", { term_state: "missing", version_id: null, incomplete_faculty: 10 })],
    [],
  );
  assert.equal(result[0].tab, "quality");
  assert.equal(result[0].title, "تحديد الفترة الأكاديمية");
});

test("each observed issue has an actionable reason and responsible function", () => {
  for (const patch of [
    { pending_groups: 1 },
    { overallocated_groups: 1 },
    { version_id: null },
    { incomplete_faculty: 1 },
    { groups_count: 0 },
    { year_inferred: true },
    { deficit: 3 },
  ]) {
    const [item] = leadershipPriorities([college("a", patch)], []);
    assert(item && item.title && item.impact && item.team);
    assert(["teaching", "faculty", "quality"].includes(item.tab));
  }
});

test("comparison includes every scoped college, places attention first, and does not invent other colleges", () => {
  const rows = [college("b"), college("a", { uncovered_hours: 1 }), college("c")];
  assert.deepEqual(
    decisionOrder(rows, leadershipPriorities(rows, [])).map((row) => row.college_id),
    ["a", "b", "c"],
  );
});

test("overview renders exactly four cards and one compact comparison, without detailed room tables", () => {
  const output = html();
  assert.equal((output.match(/data-testid="leadership-decision-card"/g) ?? []).length, 4);
  assert.equal((output.match(/<table/g) ?? []).length, 1);
  assert.match(output, /dir="rtl"/);
  assert.match(output, /المقارنة المختصرة للكليات/);
  assert.doesNotMatch(output, /تفاصيل ساعات كل قاعة|كيف حُسب/);
});

test("the priority list is limited to three while all seven colleges remain accessible", () => {
  const rows = Array.from({ length: 7 }, (_, i) => college(String(i), { version_id: null }));
  const output = html({ colleges: rows, capacity: [], capacityState: "loading" });
  assert.equal((output.match(/<li /g) ?? []).length, 3);
  assert.equal((output.match(/aria-label="تفاصيل كلية/g) ?? []).length, 7);
});

test("all four card actions and college details retain the requested tab and scope", () => {
  const calls: unknown[] = [];
  const tree = LeadershipDecisionSummary(
    props({
      colleges: [college("a", { incomplete_faculty: 4 })],
      onOpen: (...args) => calls.push(args),
    }),
  );
  const nodes = elements(tree);
  const buttons = nodes.filter((item) => item.type === "button");
  for (const button of buttons.slice(0, 4)) (button.props.onClick as () => void)();
  const reason = buttons.find((button) => button.props["aria-label"] === "عرض السبب: كلية a")!;
  (reason.props.onClick as () => void)();
  assert.deepEqual(calls, [["teaching"], ["teaching"], ["faculty"], ["rooms"], ["faculty", "a"]]);
});

test("partial teaching scope is stated beside zero; unknown demand does not count as complete", () => {
  const output = html({
    colleges: [college("a"), college("b", { groups_count: 0 })],
    capacity: [],
    capacityState: "loading",
  });
  assert.match(output, /المصدر: 1 من 2 كليات · جزئي/);
  assert.match(output, /غير محسوب/);
  assert.doesNotMatch(output, /تغطية التدريس<\/h2>[^]*?100%[^]*?عرض حالة الجداول/);
});

test("no known teaching source remains unknown instead of zero", () => {
  const output = html({
    colleges: [
      college("a", { term_state: "missing", required_hours: null, uncovered_hours: null }),
    ],
  });
  assert.match(output, /المصدر: 0 من 1 كليات · جزئي/);
  assert.match(output, /غير محسوب/);
});

test("pending/error/restricted capacity cannot leak the previous room snapshot into cards or priorities", () => {
  for (const state of ["loading", "error", "restricted"] as const) {
    const output = html({ capacityState: state, capacity: [room("a", -123)] });
    assert.doesNotMatch(output, /123/);
  }
});

test("room surplus and deficit stay separate in the compact summary", () => {
  const output = html({
    colleges: [college("a"), college("b")],
    capacity: [room("a", 16), room("b", -4)],
  });
  assert.match(output, /16 ساعة/);
  assert.match(output, /العجز 4 ساعة/);
});

test("room reuse opportunity turns surplus into quick executive equivalents", () => {
  const ids = ["hours", "days", "room", "mixed", "zero", "deficit", "unknown"];
  const output = html({
    colleges: ids.map((id) => college(id)),
    capacity: [
      room("hours", 5),
      room("days", 16),
      room("room", 36),
      room("mixed", 70),
      room("zero", 0),
      room("deficit", -4),
      room("unknown", null),
    ],
  });
  assert.match(output, /فرصة إعادة الاستخدام/);
  assert.match(output, /يعادل 5 ساعات/);
  assert.match(output, /يعادل يومين قاعة \+ 4 ساعات/);
  assert.match(output, /يعادل قاعة أسبوعية كاملة/);
  assert.match(output, /يعادل قاعة أسبوعية كاملة \+ 5 أيام قاعة \+ 4 ساعات/);
  assert.match(output, /لا توجد سعة فائضة/);
  assert.match(output, /غير محسوب/);
  assert.match(output, /لا تعني\s+توافر قاعة بعينها/);
});

test("single-college input does not expose other colleges and uses unique faculty count", () => {
  const output = html({
    colleges: [college("scoped", { faculty_count: 100 })],
    uniqueFaculty: 2,
    capacityState: "restricted",
  });
  assert.equal((output.match(/aria-label="تفاصيل كلية/g) ?? []).length, 1);
  assert.doesNotMatch(output, /كلية a/);
  assert.doesNotMatch(output, />100</);
});

test("cache scope changes for another account, role change, or college reassignment", () => {
  const me = { id: "u", roles: ["college_dean"], collegeIds: ["a"] };
  const key = leadershipViewerKey(me);
  for (const patch of [{ id: "v" }, { roles: ["super_admin"] }, { collegeIds: ["b"] }])
    assert.notEqual(leadershipViewerKey({ ...me, ...patch }), key);
  assert.equal(
    leadershipViewerKey({ id: "u", roles: ["x", "y"], collegeIds: ["b", "a"] }),
    leadershipViewerKey({ id: "u", roles: ["y", "x"], collegeIds: ["a", "b"] }),
  );
  assert.equal(LEADERSHIP_QUERY_POLICY.refetchOnWindowFocus, false);
});

test("route preserves same-scope content during refresh, closes details on period change, and avoids placeholder scope reuse", () => {
  const source = readFileSync("src/routes/_authenticated/reports.leadership.tsx", "utf8");
  assert.match(source, /isLoading=\{query.isPending\}/);
  assert.match(source, /error=\{!data \? query.error : null\}/);
  assert.match(source, /setDrilldown\(null\);\s*setDetail\(null\);\s*setPeriod/);
  assert.doesNotMatch(source, /placeholderData|keepPreviousData/);
  assert.match(source, /تعذر التحديث/);
  assert.match(source, /queryKey: \["university-leadership", viewerKey, period\]/);
  assert.match(source, /LEADERSHIP_OVERVIEW_TIMEOUT_MS = 15_000/);
  assert.match(source, /\.abortSignal\(controller\.signal\)/);
  assert.match(source, /retry: false/);
  assert.match(source, /استغرق تحميل مؤشرات الجامعة وقتًا أطول من المتوقع/);
});
