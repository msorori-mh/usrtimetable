import { RepeatingPrintHeader } from "@/components/reports/repeating-print-header";
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

/** Paper clock: omit zero minutes and use the 12-hour clock without AM/PM suffixes. */
function compactClock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  return String(hour % 12 || 12) + (match[2] === "00" ? "" : ":" + match[2]);
}

/** The room column supplies context; retain the lab discipline and number. */
function compactRoomLabel(value: string): string {
  return value.replace(/^معمل\s+(?:ال)?حاسوب\s+/u, "حاسوب ");
}


/** Short student-facing label; never infer a group number from an import code. */
function compactPrintGroupLabel(value: string): string {
  const label = value.trim();
  if (/^(?:all|الكل|جميع المجموعات)$/iu.test(label)) return "جميع المجموعات";
  const gender = /(?:^|[\s—–-])(طالبات|طلاب)(?=$|[\s—–-])/u.exec(label)?.[1];
  const numbered = /(?:مجموعة|المجموعة)\s*([0-9٠-٩۰-۹]+)(?=$|[\s—–-])/u.exec(label)
    ?? /^G\s*([0-9٠-٩۰-۹]+)$/iu.exec(label);
  if (numbered) return [gender, `مجموعة ${numbered[1]}`].filter(Boolean).join(" — ");
  // Imported labels such as "قائم — BA20" keep their distinguishing code.
  return label.replace(/^(?:(طلاب|طالبات)\s*[—–-]\s*)?قائم\s*[—–-]\s*/u,
    (_match, audience) => audience ? `${audience} — ` : "");
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
  /** Larger A4 portrait layout for current student schedules. */
  readable?: boolean;
}) {
  const { page, meta, visibility, labels, readable = false } = props;
  const cohortId = page.sessions[0]?.cohort_id;
  const commonCohort =
    readable && cohortId && page.sessions.every((s) => s.cohort_id === cohortId)
      ? labels?.cohorts.get(cohortId)
      : undefined;
  const studyLabel =
    meta.studySystem && meta.studySystem !== "all"
      ? (STUDY_SYSTEM_LABELS[meta.studySystem as PrintStudySystem] ?? String(meta.studySystem))
      : page.studySystem
        ? (STUDY_SYSTEM_LABELS[page.studySystem as PrintStudySystem] ?? String(page.studySystem))
        : null;
  const statusLabel = meta.versionStatus ? STATUS_LABEL_AR[meta.versionStatus] : null;
  const isDraft = meta.versionStatus === "draft";
  // day, time, course name, component, group + optional instructor / room
  const columnCount = 5 + (visibility.showInstructor ? 1 : 0) + (visibility.showRoom ? 1 : 0);

  const endorsement = (
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
  );

  return (
    <section
      className={`print-center-page break-after-page${readable ? " print-center-page--readable" : ""}`}
    >
      <RepeatingPrintHeader
        header={
          <div className="print-sheet-identity-row">
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
                  <h2>{readable ? page.title : "الجدول الدراسي"}</h2>
                </div>
                {visibility.showQr && meta.qrUrl && (
                  <div className="print-header-verification">
                    <PrintQrCode value={meta.qrUrl} size={72} title="رابط الطباعة" />
                    <span>رابط التحقق</span>
                  </div>
                )}
              </div>

              {isDraft && (
                <p
                  data-testid="print-draft-notice"
                  style={{
                    margin: "3mm 0",
                    padding: "3mm 4mm",
                    border: "2px solid #a16207",
                    borderRadius: "2mm",
                    color: "#422006",
                    backgroundColor: "#fde047",
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust: "exact",
                    fontSize: "14pt",
                    fontWeight: 900,
                    lineHeight: 1.5,
                    textAlign: "center",
                    breakInside: "avoid",
                  }}
                >
                  {PRINT_DRAFT_WATERMARK_AR} — للمراجعة فقط
                </p>
              )}

              <div className="print-header-details">
                {visibility.showDepartment && (page.departmentName || meta.departmentName) && (
                  <HeaderField
                    label="القسم"
                    value={page.departmentName || meta.departmentName || ""}
                  />
                )}
                {!readable && visibility.showProgram && (page.programName || meta.programName) && (
                  <HeaderField
                    label="البرنامج"
                    value={page.programName || meta.programName || ""}
                  />
                )}
                {!readable && visibility.showLevel && (page.levelName || meta.levelName) && (
                  <HeaderField label="المستوى" value={page.levelName || meta.levelName || ""} />
                )}
                {!readable && visibility.showStudySystem && studyLabel && (
                  <HeaderField label="النظام الدراسي" value={studyLabel} />
                )}
                {meta.termName && <HeaderField label="الفصل / العام" value={meta.termName} />}
                {commonCohort && <HeaderField label="الدفعة" value={commonCohort} />}
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
              {readable && endorsement}
            </header>
          </div>
        }
      >
        <Table className={readable ? "readable-schedule-table" : undefined}>
          {readable && (
            <colgroup>
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "24%" }} />
              {visibility.showInstructor && <col style={{ width: "20%" }} />}
              {visibility.showRoom && <col style={{ width: "17%" }} />}
              <col style={{ width: "7%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
          )}
          <TableHeader>
            {/* Repeats on every physical sheet the group spans (thead is a running header),
              so a continuation page still identifies which schedule it belongs to. */}
            {!readable && (
              <TableRow className="print-center-context-row">
                <TableHead colSpan={columnCount} className="text-right font-semibold">
                  {page.title}
                </TableHead>
              </TableRow>
            )}
            <TableRow>
              <TableHead>اليوم</TableHead>
              <TableHead>الزمن</TableHead>
              <TableHead>المقرر</TableHead>
              {visibility.showInstructor && <TableHead>اسم المحاضر</TableHead>}
              {visibility.showRoom && <TableHead>القاعة</TableHead>}
              <TableHead>النوع</TableHead>
              <TableHead>المجموعة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.sessions.map((s, index) => {
              const row = sessionToExportRow(s, labels, page.title);
              const deliveryGroup = s.delivery_group_id
                ? (labels?.deliveryGroups.get(s.delivery_group_id) ?? s.delivery_group_id)
                : "";
              // The report header already carries cohort, level, and study-system context.
              // Keep the final column limited to the actual delivery group.
              const groupText = compactPrintGroupLabel(deliveryGroup);
              return (
                <TableRow
                  key={s.id}
                  data-day-start={
                    index > 0 && page.sessions[index - 1].day_of_week !== s.day_of_week
                      ? "true"
                      : undefined
                  }
                >
                  <TableCell className="schedule-day">{row.day}</TableCell>
                  <TableCell className={readable ? "schedule-time" : "whitespace-nowrap"}>
                    <bdi dir="ltr" className="whitespace-nowrap">
                      {compactClock(s.start_time)}-{compactClock(s.end_time)}
                    </bdi>
                  </TableCell>
                  <TableCell>{row.course_name}</TableCell>
                  {visibility.showInstructor && <TableCell>{row.instructor}</TableCell>}
                  {visibility.showRoom && (
                    <TableCell className={readable ? "schedule-room" : undefined}>
                      <span title={row.room} aria-label={row.room}>
                        {readable ? compactRoomLabel(row.room) : row.room}
                      </span>
                    </TableCell>
                  )}
                  <TableCell>{row.component}</TableCell>
                  <TableCell>{groupText}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {!readable && endorsement}
      </RepeatingPrintHeader>
    </section>
  );
}
