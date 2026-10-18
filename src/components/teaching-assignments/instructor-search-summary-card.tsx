import { Card } from "@/components/ui/card";
import { summarizeInstructorAssignedHours } from "@/lib/teaching-assignments/instructor-name-search";
import { summarizeInstructorAttendanceDays } from "@/lib/teaching-assignments/assignment-row-days";
import { formatDecimal, formatNumber } from "@/lib/format";

/** Hours and attendance-day totals for the instructor typed in the search box (split from teaching-assignments.tsx, L-14). */
export function InstructorSearchSummaryCard({
  instructorHoursSummary,
  attendanceDaysSummary,
  scheduleUnavailable,
}: {
  instructorHoursSummary: ReturnType<typeof summarizeInstructorAssignedHours>;
  attendanceDaysSummary: ReturnType<typeof summarizeInstructorAttendanceDays>;
  scheduleUnavailable: boolean;
}) {
  return (
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
            : `${formatNumber(instructorHoursSummary.matchedInstructors.length)} محاضرين مطابقين`}
        </p>
      </div>
      <div className="text-end">
        <p className="text-xs text-muted-foreground">إجمالي الساعات المسندة</p>
        <p className="text-2xl font-bold tabular-nums text-primary">
          {formatDecimal(instructorHoursSummary.totalHours)} ساعة
        </p>
      </div>
      <div className="text-end" data-testid="ta-v2-instructor-attendance-days">
        <p className="text-xs text-muted-foreground">عدد أيام الحضور</p>
        <p className="text-2xl font-bold tabular-nums text-primary">
          <span dir="ltr" data-testid="ta-v2-instructor-attendance-days-value">
            {scheduleUnavailable
              ? "—"
              : formatNumber(attendanceDaysSummary.totalDays)}
          </span>{" "}
          <span>{attendanceDaysSummary.totalDays === 1 ? "يوم" : "أيام"}</span>
          {attendanceDaysSummary.perInstructor.length > 1 && (
            <span className="ms-1 text-sm font-medium text-muted-foreground">
              ({formatNumber(attendanceDaysSummary.perInstructor.length)} محاضرين)
            </span>
          )}
        </p>
      </div>
    </Card>
  );
}
