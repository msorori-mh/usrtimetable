import { useMemo } from "react";
import { PrintSheet } from "@/components/print-center/print-sheet";
import { DEFAULT_PRINT_VISIBILITY } from "@/lib/print-center/types";
import { groupPrintPages, latestSessionUpdate, printPageStyleCss } from "@/lib/print-center";
import type { PrintSessionLike } from "@/lib/print-center/types";
import type { CohortDgLabels } from "@/lib/print-center/export-rows";
import type { ReportContext } from "@/lib/reports/types";
import type { ProgramReportReferences } from "@/lib/reports/program-timetable-filters";
import { isDeliveryDemoVersion } from "@/lib/schedule-versions/delivery-demo";

/** Reuse the existing branded print sheets with exactly the report's filtered rows. */
export function ProgramTimetablePrint(props: {
  context: ReportContext;
  collegeName?: string;
  references: ProgramReportReferences;
  sessions: PrintSessionLike[];
  labels?: CohortDgLabels;
  qrUrl: string;
}) {
  const { context: ctx, references, sessions, labels, qrUrl } = props;
  const exportedAt = useMemo(() => new Date(), []);
  const pages = useMemo(
    () =>
      references.programs.flatMap((program) => {
        const programSessions = sessions
          .filter((s) => s.course_offerings?.program_id === program.id)
          .map((s) =>
            s.study_system === "both" && ctx.studySystem !== "all"
              ? { ...s, study_system: ctx.studySystem }
              : s,
          );
        return groupPrintPages(programSessions, {
          reportType: "program",
          collegeId: ctx.collegeId ?? "",
          studySystem: ctx.studySystem,
        }).map((page) => ({
          ...page,
          key: `${program.id}:${page.key}`,
          departmentName: references.departments.find((d) => d.id === program.department_id)?.name,
          programName: program.name,
        }));
      }),
    [references, sessions, ctx.collegeId, ctx.studySystem],
  );
  return (
    <>
      <style>{printPageStyleCss("A3", "landscape")}</style>
      {pages.map((page, i) => (
        <PrintSheet
          key={page.key}
          page={page}
          labels={labels}
          visibility={DEFAULT_PRINT_VISIBILITY}
          meta={{
            collegeName: props.collegeName,
            departmentName: page.departmentName,
            programName: page.programName,
            levelName: page.levelName,
            studySystem: page.studySystem,
            termName: ctx.terms.find((t) => t.id === ctx.termId)?.name,
            versionName: ctx.selectedVersion?.name,
            versionStatus: ctx.selectedVersion?.status,
            versionNumber: ctx.selectedVersion?.name,
            exportAt: exportedAt,
            lastUpdate: latestSessionUpdate(sessions),
            qrUrl,
            isDemo: isDeliveryDemoVersion({ name: ctx.selectedVersion?.name }),
            pageIndex: i + 1,
            pageCount: pages.length,
          }}
        />
      ))}
    </>
  );
}
