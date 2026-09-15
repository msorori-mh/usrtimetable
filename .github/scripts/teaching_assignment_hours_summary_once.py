from pathlib import Path

helper_path = Path("src/lib/teaching-assignments/instructor-name-search.ts")
helper = helper_path.read_text()
if "summarizeInstructorAssignedHours" not in helper:
    helper += '''

export type InstructorAssignedHoursSummary = {
  totalHours: number;
  matchedInstructors: string[];
};

type InstructorHoursRow = {
  component_hours: number | null;
  instructors: ReadonlyArray<{
    instructor_name: string | null;
    assigned_component_hours: number | null;
    is_active?: boolean;
  }>;
};

/**
 * إجمالي الساعات الفعلية للمحاضر المطابق للبحث داخل الصفوف الحالية.
 * التدريس المشترك يعتمد الساعات الصريحة، والمدرس الوحيد يرجع لساعات المكوّن عند غيابها.
 */
export function summarizeInstructorAssignedHours(
  rows: readonly InstructorHoursRow[],
  query: string,
): InstructorAssignedHoursSummary {
  const q = normalizeArabicName(query);
  if (!q) return { totalHours: 0, matchedInstructors: [] };

  const names = new Map<string, string>();
  let totalHours = 0;

  for (const row of rows) {
    const activeInstructors = row.instructors.filter((instructor) => instructor.is_active !== false);
    for (const instructor of activeInstructors) {
      if (!instructorNameMatches(instructor.instructor_name, q)) continue;

      const displayName = String(instructor.instructor_name ?? "").trim();
      const normalizedName = normalizeArabicName(displayName);
      if (normalizedName && !names.has(normalizedName)) {
        names.set(normalizedName, displayName);
      }

      if (
        instructor.assigned_component_hours != null &&
        Number.isFinite(Number(instructor.assigned_component_hours))
      ) {
        totalHours += Number(instructor.assigned_component_hours);
      } else if (
        activeInstructors.length === 1 &&
        row.component_hours != null &&
        Number.isFinite(Number(row.component_hours))
      ) {
        totalHours += Number(row.component_hours);
      }
    }
  }

  return { totalHours, matchedInstructors: [...names.values()] };
}
'''
    helper_path.write_text(helper)

route_path = Path("src/routes/_authenticated/teaching-assignments.tsx")
route = route_path.read_text()

old_import = '''import {
  filterRowsByInstructorName,
  normalizeArabicName,
} from "@/lib/teaching-assignments/instructor-name-search";'''
new_import = '''import {
  filterRowsByInstructorName,
  normalizeArabicName,
  summarizeInstructorAssignedHours,
} from "@/lib/teaching-assignments/instructor-name-search";'''
if old_import not in route and "summarizeInstructorAssignedHours" not in route:
    raise SystemExit("instructor search import anchor not found")
route = route.replace(old_import, new_import, 1)

summary_state_anchor = '''  const instructorSearchActive = normalizeArabicName(instructorSearch) !== "";
  const readOnly = !canManage || workspace.data?.can_manage === false;'''
summary_state_replacement = '''  const instructorSearchActive = normalizeArabicName(instructorSearch) !== "";
  const instructorHoursSummary = useMemo(
    () => summarizeInstructorAssignedHours(workspace.data?.rows ?? [], instructorSearch),
    [workspace.data?.rows, instructorSearch],
  );
  const readOnly = !canManage || workspace.data?.can_manage === false;'''
if "const instructorHoursSummary = useMemo(" not in route:
    if summary_state_anchor not in route:
        raise SystemExit("summary state anchor not found")
    route = route.replace(summary_state_anchor, summary_state_replacement, 1)

table_anchor = '''          <Card className="overflow-hidden" data-testid="ta-v2-groups-table">'''
summary_card = '''          {instructorSearchActive && instructorHoursSummary.matchedInstructors.length > 0 && (
            <Card
              className="mb-4 flex flex-wrap items-center justify-between gap-4 border-primary/30 bg-primary/5 p-4"
              data-testid="ta-v2-instructor-hours-summary"
            >
              <div>
                <p className="text-xs text-muted-foreground">
                  {instructorHoursSummary.matchedInstructors.length === 1
                    ? "المحاضر"
                    : "المحاضرون المطابقون"}
                </p>
                <p className="font-semibold">
                  {instructorHoursSummary.matchedInstructors.length === 1
                    ? instructorHoursSummary.matchedInstructors[0]
                    : `${instructorHoursSummary.matchedInstructors.length} محاضرين مطابقين`}
                </p>
              </div>
              <div className="text-left">
                <p className="text-xs text-muted-foreground">إجمالي الساعات المسندة</p>
                <p className="text-2xl font-bold tabular-nums text-primary">
                  {instructorHoursSummary.totalHours.toLocaleString("ar-YE")} ساعة
                </p>
              </div>
            </Card>
          )}

'''
if 'data-testid="ta-v2-instructor-hours-summary"' not in route:
    if table_anchor not in route:
        raise SystemExit("table anchor not found")
    route = route.replace(table_anchor, summary_card + table_anchor, 1)
route_path.write_text(route)

test_path = Path("tests/teaching-assignments-instructor-search.test.ts")
test = test_path.read_text()
old_test_import = '''  instructorNameMatches,
  normalizeArabicName,
} from "@/lib/teaching-assignments/instructor-name-search";'''
new_test_import = '''  instructorNameMatches,
  normalizeArabicName,
  summarizeInstructorAssignedHours,
} from "@/lib/teaching-assignments/instructor-name-search";'''
if "summarizeInstructorAssignedHours," not in test:
    if old_test_import not in test:
        raise SystemExit("test import anchor not found")
    test = test.replace(old_test_import, new_test_import, 1)

page_anchor = '''describe("teaching-assignments page wiring", () => {'''
summary_tests = '''describe("summarizeInstructorAssignedHours", () => {
  it("sums explicit split hours and sole-instructor fallback for the searched lecturer", () => {
    const summary = summarizeInstructorAssignedHours(
      [
        {
          component_hours: 3,
          instructors: [
            {
              instructor_name: "أحمد محمد",
              assigned_component_hours: null,
              is_active: true,
            },
          ],
        },
        {
          component_hours: 4,
          instructors: [
            {
              instructor_name: "أحمد محمد",
              assigned_component_hours: 1.5,
              is_active: true,
            },
            {
              instructor_name: "سارة علي",
              assigned_component_hours: 2.5,
              is_active: true,
            },
          ],
        },
        {
          component_hours: 2,
          instructors: [
            {
              instructor_name: "أحمد محمد",
              assigned_component_hours: 2,
              is_active: false,
            },
          ],
        },
      ],
      "احمد",
    );

    expect(summary.totalHours).toBe(4.5);
    expect(summary.matchedInstructors).toEqual(["أحمد محمد"]);
  });
});

'''
if 'describe("summarizeInstructorAssignedHours"' not in test:
    if page_anchor not in test:
        raise SystemExit("page wiring test anchor not found")
    test = test.replace(page_anchor, summary_tests + page_anchor, 1)

if 'data-testid="ta-v2-instructor-hours-summary"' not in test:
    wiring_anchor = '''  it("shows the no-matching-instructor message and export filter", () => {'''
    wiring_test = '''  it("shows the instructor assigned-hours summary while searching", () => {
    expect(src).toContain('data-testid="ta-v2-instructor-hours-summary"');
    expect(src).toContain("إجمالي الساعات المسندة");
    expect(src).toContain("summarizeInstructorAssignedHours");
  });

'''
    if wiring_anchor not in test:
        raise SystemExit("wiring test insertion anchor not found")
    test = test.replace(wiring_anchor, wiring_test + wiring_anchor, 1)

test_path.write_text(test)
