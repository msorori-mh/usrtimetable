/**
 * Table cells and column definitions for the academic-affairs reports
 * (moved from routes/_authenticated/reports.academic-affairs.tsx — L-14 size split,
 * no behaviour change).
 */
import type { ReportColumn } from "@/components/reports/report-section";
import { PENDING_SPLIT_AR } from "@/lib/existing-schedules/presentation";
import type { AcademicReportKind, AcademicReportRow } from "@/lib/reports/academic-affairs";

const valueText = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

const hourText = (value: string | number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${value} س` : valueText(value);

const numericValue = (value: string | number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function DataLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string | number | null | undefined;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-start gap-2 leading-5">
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <span
        className={
          strong ? "whitespace-nowrap font-semibold tabular-nums" : "whitespace-nowrap tabular-nums"
        }
      >
        {valueText(value)}
      </span>
    </div>
  );
}

function MemberCell({ row }: { row: AcademicReportRow }) {
  const meta = [row.rank, row.department].filter((value) => value && value !== "غير محدد");
  return (
    <div className="min-w-[170px] space-y-0.5 leading-5">
      <div className="font-semibold">{valueText(row.instructor)}</div>
      {row.university_number && row.university_number !== "—" && (
        <div className="text-[11px] tabular-nums text-muted-foreground">
          الرقم الجامعي: {valueText(row.university_number)}
        </div>
      )}
      {meta.length > 0 && (
        <div className="text-[11px] text-muted-foreground">{meta.map(valueText).join(" · ")}</div>
      )}
      {row.administrative_position && row.administrative_position !== "—" && (
        <div className="text-[11px] text-muted-foreground">
          {valueText(row.administrative_position)}
        </div>
      )}
    </div>
  );
}

function QuotaCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[125px] space-y-0.5">
      <DataLine label="الأساسي" value={hourText(row.base_required)} />
      <DataLine label="الإعفاء" value={hourText(row.release)} />
      <DataLine label="الصافي" value={hourText(row.required)} strong />
      {row.quota_source && (
        <div className="pt-0.5 text-[10px] text-muted-foreground">
          المصدر: {valueText(row.quota_source)}
        </div>
      )}
    </div>
  );
}

function AssignedLoadCell({ row }: { row: AcademicReportRow }) {
  const assigned = numericValue(row.assigned);
  const required = numericValue(row.required);
  const ratio =
    assigned !== null && required !== null && required > 0
      ? Math.round((assigned / required) * 100)
      : null;
  return (
    <div className="min-w-[120px] space-y-0.5">
      <DataLine label="التدريس" value={hourText(row.assigned)} strong />
      {numericValue(row.project) !== null && Number(row.project) > 0 && (
        <DataLine label="إشراف مشاريع" value={hourText(row.project)} />
      )}
      {ratio !== null && (
        <div className="pt-0.5 text-[10px] text-muted-foreground">تحقيق النصاب: {ratio}%</div>
      )}
    </div>
  );
}

function BalanceCell({ row, kind }: { row: AcademicReportRow; kind: AcademicReportKind }) {
  const overload = numericValue(row.overload);
  const deficit = numericValue(row.deficit);
  const pending = numericValue(row.shared_hours_pending);
  const focus =
    kind === "overload"
      ? `زائد ${hourText(row.overload)}`
      : kind === "deficit"
        ? `عجز ${hourText(row.deficit)}`
        : pending !== null && pending > 0
          ? `تدريس مشترك بانتظار التوزيع: ${hourText(pending)}`
          : row.status === PENDING_SPLIT_AR
            ? PENDING_SPLIT_AR
            : overload !== null && overload > 0
              ? `زائد ${hourText(overload)}`
              : deficit !== null && deficit > 0
                ? `عجز ${hourText(deficit)}`
                : overload !== null && deficit !== null
                  ? "متوازن"
                  : "غير محدد";
  return (
    <div className="min-w-[145px] space-y-1 leading-5">
      <div className="font-semibold">{focus}</div>
      <div className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium">
        {valueText(row.status)}
      </div>
    </div>
  );
}

function ContextCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[165px] space-y-0.5 leading-5">
      <div className="font-semibold">{valueText(row.program)}</div>
      <div className="text-[11px] text-muted-foreground">{valueText(row.department)}</div>
      <div className="text-[11px] text-muted-foreground">
        {valueText(row.cohort)} · {valueText(row.study_system)}
      </div>
    </div>
  );
}

function GroupCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[105px] space-y-0.5 leading-5">
      <div className="font-semibold">{valueText(row.group)}</div>
      <div className="text-[11px] text-muted-foreground">{valueText(row.component)}</div>
      {row.students !== undefined && (
        <div className="text-[10px] text-muted-foreground">
          {valueText(row.students)} طالب · السعة {valueText(row.capacity)}
        </div>
      )}
    </div>
  );
}

function AssignmentHoursCell({ row }: { row: AcademicReportRow }) {
  return (
    <div className="min-w-[105px] space-y-0.5">
      <DataLine label="المطلوب" value={hourText(row.required)} />
      <DataLine label="المسند" value={hourText(row.assigned)} strong />
    </div>
  );
}

function CoverageCell({ row }: { row: AcademicReportRow }) {
  const required = numericValue(row.required);
  const assigned = numericValue(row.assigned);
  const pending = numericValue(row.shared_hours_pending);
  const coverage =
    required !== null && required > 0 && assigned !== null
      ? Math.round((assigned / required) * 100)
      : null;
  return (
    <div className="min-w-[125px] space-y-0.5">
      <DataLine label="المطلوب" value={hourText(row.required)} />
      {pending !== null && pending > 0 ? (
        <>
          <DataLine label="مشترك غير موزع" value={hourText(pending)} strong />
          <div className="pt-0.5 text-[10px] font-medium">بانتظار توزيع ساعات التدريس المشترك</div>
        </>
      ) : (
        <>
          <DataLine label="المسند" value={hourText(row.assigned)} />
          <DataLine label="العجز" value={hourText(row.shortage)} strong />
          {coverage !== null && (
            <div className="pt-0.5 text-[10px] text-muted-foreground">
              نسبة التغطية: {coverage}%
            </div>
          )}
        </>
      )}
      {row.allocation_status && (
        <div className="text-[10px] text-muted-foreground">{valueText(row.allocation_status)}</div>
      )}
    </div>
  );
}

export function academicTableColumns(kind: AcademicReportKind): ReportColumn<AcademicReportRow>[] {
  const index: ReportColumn<AcademicReportRow> = {
    key: "__row",
    label: "م",
    numeric: true,
    sortable: false,
    className: "w-10",
    render: (_row, index) => index + 1,
  };

  if (kind === "workload" || kind === "overload" || kind === "deficit") {
    return [
      index,
      {
        key: "instructor",
        label: "عضو هيئة التدريس",
        className: "w-[28%]",
        render: (row) => <MemberCell row={row} />,
      },
      {
        key: "required",
        label: "النصاب الأسبوعي",
        className: "w-[21%]",
        render: (row) => <QuotaCell row={row} />,
      },
      {
        key: "assigned",
        label: "العبء المسند",
        className: "w-[20%]",
        render: (row) => <AssignedLoadCell row={row} />,
      },
      {
        key: kind === "deficit" ? "deficit" : kind === "overload" ? "overload" : "status",
        label:
          kind === "overload"
            ? "الساعات الزائدة والحالة"
            : kind === "deficit"
              ? "العجز والحالة"
              : "الرصيد والحالة",
        className: "w-[25%]",
        render: (row) => <BalanceCell row={row} kind={kind} />,
      },
    ];
  }

  if (kind === "assignments") {
    return [
      index,
      {
        key: "program",
        label: "البرنامج والدفعة",
        className: "w-[22%]",
        render: (row) => <ContextCell row={row} />,
      },
      { key: "course", label: "المقرر", className: "w-[22%]" },
      {
        key: "group",
        label: "المجموعة / النوع",
        className: "w-[15%]",
        render: (row) => <GroupCell row={row} />,
      },
      {
        key: "instructor",
        label: "عضو هيئة التدريس",
        className: "w-[18%]",
        render: (row) => (
          <div className="min-w-[130px] leading-5">
            <div className="font-semibold">{valueText(row.instructor)}</div>
            {row.employee_number && row.employee_number !== "—" && (
              <div className="text-[10px] tabular-nums text-muted-foreground">
                {valueText(row.employee_number)}
              </div>
            )}
          </div>
        ),
      },
      {
        key: "assigned",
        label: "الساعات",
        className: "w-[13%]",
        render: (row) => <AssignmentHoursCell row={row} />,
      },
      { key: "note", label: "ملاحظة", className: "w-[15%]" },
    ];
  }

  if (kind === "course_status") {
    return [
      index,
      {
        key: "program",
        label: "البرنامج والدفعة",
        className: "w-[20%]",
        render: (row) => <ContextCell row={row} />,
      },
      { key: "course", label: "المقرر", className: "w-[20%]" },
      {
        key: "group",
        label: "المجموعة / النوع",
        className: "w-[14%]",
        render: (row) => <GroupCell row={row} />,
      },
      {
        key: "allocation_status",
        label: "حالة الإسناد",
        className: "w-[19%]",
        render: (row) => <CoverageCell row={row} />,
      },
      {
        key: "instructors",
        label: "المحاضرون وتوزيع الساعات",
        className: "w-[21%]",
        render: (row) => (
          <div className="min-w-[160px] space-y-1 leading-5">
            <div>{valueText(row.instructors)}</div>
            {row.note && (
              <div className="text-[10px] text-muted-foreground">{valueText(row.note)}</div>
            )}
          </div>
        ),
      },
      { key: "conflicts", label: "ملاحظات التحقق", className: "w-[16%]" },
    ];
  }

  return [
    index,
    {
      key: "program",
      label: "البرنامج والدفعة",
      className: "w-[22%]",
      render: (row) => <ContextCell row={row} />,
    },
    { key: "course", label: "المقرر", className: "w-[22%]" },
    {
      key: "group",
      label: "المجموعة / النوع",
      className: "w-[16%]",
      render: (row) => <GroupCell row={row} />,
    },
    {
      key: "shortage",
      label: "تغطية الإسناد",
      className: "w-[18%]",
      render: (row) => <CoverageCell row={row} />,
    },
    {
      key: "instructors",
      label: "المكلفون حاليًا",
      className: "w-[20%]",
      render: (row) => (
        <div className="leading-5">
          <div>{valueText(row.instructors)}</div>
          {row.note && (
            <div className="mt-1 text-[10px] text-muted-foreground">{valueText(row.note)}</div>
          )}
        </div>
      ),
    },
  ];
}
