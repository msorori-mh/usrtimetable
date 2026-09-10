import { USR_UNIVERSITY_LOGO_SRC, USR_UNIVERSITY_NAME_AR } from "@/lib/branding/usr";
import { REPORT_COLLEGE_NAME_FALLBACK_AR } from "@/lib/reports/branding";
import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import { STATUS_LABEL_AR, type SVStatus } from "@/lib/schedule-versions/lifecycle";
import {
  PRINT_DEMO_FOOTER_WARNING_AR,
  PRINT_DRAFT_WATERMARK_AR,
  PRINT_PUBLISHED_ENDORSEMENT_AR,
  type PrintPageGroup,
  type PrintVisibilityOptions,
  type PrintStudySystem,
} from "@/lib/print-center";
import { PrintQrCode } from "./print-qr-code";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { sessionToExportRow, type CohortDgLabels } from "@/lib/print-center/export-rows";

export interface PrintSheetMeta {
  collegeName?: string | null;
  departmentName?: string | null;
  programName?: string | null;
  levelName?: string | null;
  studySystem?: PrintStudySystem | string | null;
  termName?: string | null;
  versionName?: string | null;
  versionStatus?: SVStatus | null;
  versionNumber?: string | null;
  exportAt: Date;
  lastUpdate?: string | null;
  qrUrl: string;
  isDemo: boolean;
  pageIndex: number;
  pageCount: number;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
}

export function PrintSheet(props: {
  page: PrintPageGroup;
  meta: PrintSheetMeta;
  visibility: PrintVisibilityOptions;
  labels?: CohortDgLabels;
}) {
  const { page, meta, visibility, labels } = props;
  const studyLabel =
    meta.studySystem && meta.studySystem !== "all"
      ? (STUDY_SYSTEM_LABELS[meta.studySystem as PrintStudySystem] ?? String(meta.studySystem))
      : page.studySystem
        ? (STUDY_SYSTEM_LABELS[page.studySystem as PrintStudySystem] ?? String(page.studySystem))
        : null;
  const statusLabel = meta.versionStatus ? STATUS_LABEL_AR[meta.versionStatus] : null;
  const isDraft = meta.versionStatus === "draft";
  const columnCount =
    6 + (visibility.showInstructor ? 1 : 0) + (visibility.showRoom ? 1 : 0) - 0;
  const contextSuffix = [
    visibility.showLevel ? page.levelName || meta.levelName : null,
    studyLabel,
    PRINT_GROUP_CONTINUATION_AR,
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <section className="print-center-page break-after-page">
      {isDraft && (
        <div className="print-draft-watermark" aria-hidden>
          {PRINT_DRAFT_WATERMARK_AR}
        </div>
      )}

      <header className="print-center-header mb-4 border-b border-border pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {visibility.showUniversityLogo && (
              <img
                src={USR_UNIVERSITY_LOGO_SRC}
                alt={USR_UNIVERSITY_NAME_AR}
                className="h-14 w-14 object-contain print:h-16 print:w-16"
              />
            )}
            <div className="space-y-1 text-sm">
              <p className="font-bold text-base">{USR_UNIVERSITY_NAME_AR}</p>
              {visibility.showCollege && (
                <p className="font-semibold">
                  {meta.collegeName || REPORT_COLLEGE_NAME_FALLBACK_AR}
                </p>
              )}
              {visibility.showDepartment && (page.departmentName || meta.departmentName) && (
                <p>القسم: {page.departmentName || meta.departmentName}</p>
              )}
              {visibility.showProgram && (page.programName || meta.programName) && (
                <p>البرنامج: {page.programName || meta.programName}</p>
              )}
              {visibility.showLevel && (page.levelName || meta.levelName) && (
                <p>المستوى: {page.levelName || meta.levelName}</p>
              )}
              {visibility.showStudySystem && studyLabel && <p>النظام الدراسي: {studyLabel}</p>}
              {meta.termName && <p>الفصل / العام: {meta.termName}</p>}
              {visibility.showVersionStatus && statusLabel && <p>حالة النسخة: {statusLabel}</p>}
              {visibility.showVersionNumber && (meta.versionNumber || meta.versionName) && (
                <p>رقم / اسم النسخة: {meta.versionNumber || meta.versionName}</p>
              )}
              {visibility.showExportDate && <p>تاريخ التصدير: {formatDateTime(meta.exportAt)}</p>}
            </div>
          </div>
          {visibility.showQr && meta.qrUrl && (
            <PrintQrCode value={meta.qrUrl} size={88} title="رابط الطباعة" />
          )}
        </div>
        <h2 className="mt-3 text-lg font-bold">{page.title}</h2>
      </header>

      <Table>
        <TableHeader>
          {/* Repeats on every physical sheet the group spans (thead is a running header),
              so a continuation page still identifies which schedule it belongs to. */}
          <TableRow className="print-center-context-row">
            <TableHead colSpan={columnCount} className="text-right font-semibold">
              {page.title}
              {contextSuffix ? ` — ${contextSuffix}` : ""}
            </TableHead>
          </TableRow>
          <TableRow>
            <TableHead>اليوم</TableHead>
            <TableHead>الوقت</TableHead>
            <TableHead>رمز المقرر</TableHead>
            <TableHead>اسم المقرر</TableHead>
            <TableHead>المكوّن</TableHead>
            {visibility.showInstructor && <TableHead>المدرس</TableHead>}
            {visibility.showRoom && <TableHead>القاعة</TableHead>}
            <TableHead>المجموعة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.sessions.map((s) => {
            const row = sessionToExportRow(s, labels, page.title);
            return (
              <TableRow key={s.id}>
                <TableCell>{row.day}</TableCell>
                <TableCell className="whitespace-nowrap">{row.time}</TableCell>
                <TableCell>{row.course_code}</TableCell>
                <TableCell>{row.course_name}</TableCell>
                <TableCell>{row.component}</TableCell>
                {visibility.showInstructor && <TableCell>{row.instructor}</TableCell>}
                {visibility.showRoom && <TableCell>{row.room}</TableCell>}
                <TableCell>{row.group}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <footer className="print-center-footer mt-4 border-t border-border pt-2 text-xs text-muted-foreground print:text-foreground">
        <div className="flex flex-wrap justify-between gap-2">
          <span>
            صفحة {meta.pageIndex} من {meta.pageCount}
          </span>
          {meta.lastUpdate && (
            <span>آخر تحديث: {new Date(meta.lastUpdate).toLocaleString("ar")}</span>
          )}
        </div>
        <p className="mt-1">{PRINT_PUBLISHED_ENDORSEMENT_AR}</p>
        {meta.isDemo && (
          <p className="mt-1 font-semibold text-amber-800 print:text-black" role="status">
            {PRINT_DEMO_FOOTER_WARNING_AR}
          </p>
        )}
      </footer>
    </section>
  );
}
