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
  printGroupCounterLabelAr,
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

function HeaderField(props: { label: string; value: string }) {
  return (
    <div className="print-header-field">
      <span className="print-header-label">{props.label}</span>
      <span className="print-header-value">{props.value}</span>
    </div>
  );
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
  // day, time, code, name, component, group + optional instructor / room
  const columnCount = 6 + (visibility.showInstructor ? 1 : 0) + (visibility.showRoom ? 1 : 0);

  return (
    <section className="print-center-page break-after-page">
      {isDraft && (
        <div className="print-draft-watermark" aria-hidden>
          {PRINT_DRAFT_WATERMARK_AR}
        </div>
      )}

      <header className="print-center-header mb-3" data-print-header="compact">
        <div className="print-header-identity-band">
          <div className="print-header-institution">
            {visibility.showUniversityLogo && (
              <img
                src={USR_UNIVERSITY_LOGO_SRC}
                alt={USR_UNIVERSITY_NAME_AR}
                className="print-header-logo"
              />
            )}
            <div className="print-header-institution-copy">
              <p className="print-header-university">{USR_UNIVERSITY_NAME_AR}</p>
              {visibility.showCollege && (
                <p className="print-header-college">
                  {meta.collegeName || REPORT_COLLEGE_NAME_FALLBACK_AR}
                </p>
              )}
            </div>
          </div>
          <div className="print-header-title-block">
            <p className="print-header-kicker">الجدول الأسبوعي</p>
            <h2>الجدول الدراسي</h2>
          </div>
          {visibility.showQr && meta.qrUrl && (
            <div className="print-header-verification">
              <PrintQrCode value={meta.qrUrl} size={72} title="رابط الطباعة" />
              <span>رابط التحقق</span>
            </div>
          )}
        </div>

        <div className="print-header-details">
          {visibility.showDepartment && (page.departmentName || meta.departmentName) && (
            <HeaderField label="القسم" value={page.departmentName || meta.departmentName || ""} />
          )}
          {visibility.showProgram && (page.programName || meta.programName) && (
            <HeaderField label="البرنامج" value={page.programName || meta.programName || ""} />
          )}
          {visibility.showLevel && (page.levelName || meta.levelName) && (
            <HeaderField label="المستوى" value={page.levelName || meta.levelName || ""} />
          )}
          {visibility.showStudySystem && studyLabel && (
            <HeaderField label="النظام الدراسي" value={studyLabel} />
          )}
          {meta.termName && <HeaderField label="الفصل / العام" value={meta.termName} />}
        </div>

        {(visibility.showVersionStatus ||
          visibility.showVersionNumber ||
          visibility.showExportDate) && (
          <div className="print-header-meta">
            {visibility.showVersionStatus && statusLabel && (
              <span>
                <b>الحالة:</b> {statusLabel}
              </span>
            )}
            {visibility.showVersionNumber && (meta.versionNumber || meta.versionName) && (
              <span>
                <b>النسخة:</b> {meta.versionNumber || meta.versionName}
              </span>
            )}
            {visibility.showExportDate && (
              <span>
                <b>تاريخ التصدير:</b> {formatDateTime(meta.exportAt)}
              </span>
            )}
          </div>
        )}
      </header>

      <Table>
        <TableHeader>
          {/* Repeats on every physical sheet the group spans (thead is a running header),
              so a continuation page still identifies which schedule it belongs to. */}
          <TableRow className="print-center-context-row">
            <TableHead colSpan={columnCount} className="text-right font-semibold">
              {page.title}
            </TableHead>
          </TableRow>
          <TableRow>
            <TableHead>اليوم</TableHead>
            <TableHead>الوقت</TableHead>
            <TableHead>رمز المقرر</TableHead>
            <TableHead>اسم المقرر</TableHead>
            <TableHead>المحاضرة</TableHead>
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
          <span>{printGroupCounterLabelAr(meta.pageIndex, meta.pageCount)}</span>
          {meta.lastUpdate && (
            <span>آخر تحديث: {new Date(meta.lastUpdate).toLocaleString("ar")}</span>
          )}
        </div>
        <p className="mt-1">
          {meta.versionStatus === "published"
            ? PRINT_PUBLISHED_ENDORSEMENT_AR
            : "نسخة للمراجعة والطباعة — ليست جدولاً منشوراً معتمداً."}
        </p>
        {meta.isDemo && (
          <p className="mt-1 font-semibold text-amber-800 print:text-black" role="status">
            {PRINT_DEMO_FOOTER_WARNING_AR}
          </p>
        )}
      </footer>
    </section>
  );
}
