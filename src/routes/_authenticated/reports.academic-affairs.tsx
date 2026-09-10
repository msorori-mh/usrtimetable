import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTeachingAssignmentWorkspace } from "@/lib/academic-delivery/teaching-assignments-v2-service";
import { fetchAcademicTerms } from "@/lib/reports/queries/version-queries";
import {
  ACADEMIC_REPORT_HEADERS,
  ACADEMIC_REPORT_TITLES,
  buildAcademicReport,
  parseAcademicWorkload,
  type AcademicInstructor,
  type AcademicProgram,
  type AcademicReportKind,
  type AcademicWorkload,
} from "@/lib/reports/academic-affairs";

export const Route = createFileRoute("/_authenticated/reports/academic-affairs")({
  head: () => ({ meta: [{ title: "تقارير الشؤون الأكاديمية" }] }),
  component: Page,
});

/** Page every reference list, so colleges with more than 1,000 staff are not silently truncated. */
async function readAll<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 500) return rows;
  }
}

function Page() {
  const { active, isLoading } = useActiveCollege();
  if (isLoading) return <Card className="p-6">جارٍ تحميل الكليات…</Card>;
  if (!active) return <Card className="p-6">لا توجد كلية متاحة لهذا الحساب.</Card>;
  // Remount resets every dependent filter immediately when switching colleges.
  return <AcademicReports key={active.id} collegeId={active.id} collegeName={active.name} />;
}

function AcademicReports({ collegeId, collegeName }: { collegeId: string; collegeName: string }) {
  const [kind, setKind] = useState<AcademicReportKind>("workload");
  const [chosenTerm, setChosenTerm] = useState("");
  const [departmentId, setDepartmentId] = useState("all");
  const [programId, setProgramId] = useState("all");
  const [instructorId, setInstructorId] = useState("all");
  const [loadStatus, setLoadStatus] = useState("all");

  const references = useQuery({
    queryKey: ["academic-affairs-references", collegeId],
    queryFn: async () => {
      const [terms, departments, programs, instructors] = await Promise.all([
        fetchAcademicTerms(collegeId),
        readAll<{ id: string; name: string }>((from, to) =>
          supabase
            .from("departments")
            .select("id, name")
            .eq("college_id", collegeId)
            .order("id")
            .range(from, to),
        ),
        readAll<AcademicProgram>((from, to) =>
          supabase
            .from("academic_programs")
            .select("id, name, department_id")
            .eq("college_id", collegeId)
            .order("id")
            .range(from, to),
        ),
        readAll<AcademicInstructor>((from, to) =>
          supabase
            .from("instructors")
            .select("id, full_name, academic_rank, department_id")
            .eq("college_id", collegeId)
            .order("id")
            .range(from, to),
        ),
      ]);
      return { terms, departments, programs, instructors };
    },
  });
  const refs = references.data;
  const termId = refs?.terms.some((t) => t.id === chosenTerm)
    ? chosenTerm
    : (refs?.terms[0]?.id ?? "");
  const term = refs?.terms.find((t) => t.id === termId);
  const report = useQuery({
    queryKey: ["academic-affairs-data", collegeId, termId, kind === "workload", refs?.instructors],
    enabled: !!refs && !!termId,
    queryFn: async () => {
      const workspace = await listTeachingAssignmentWorkspace({
        collegeId,
        termId,
      });
      if (!workspace.ok || workspace.college_id !== collegeId)
        throw new Error("تعذر تحميل الإسناد التدريسي");
      const workloads: AcademicWorkload[] = [];
      if (kind === "workload") {
        const instructors = refs!.instructors;
        for (let offset = 0; offset < instructors.length; offset += 6) {
          workloads.push(
            ...(await Promise.all(
              instructors.slice(offset, offset + 6).map(async (i) => {
                const { data, error } = await supabase.rpc("compute_instructor_standard_workload", {
                  p_instructor_id: i.id,
                  p_term_id: termId,
                });
                if (error) throw new Error(error.message);
                return parseAcademicWorkload(data, i.id);
              }),
            )),
          );
        }
      }
      return { groups: workspace.rows, workloads };
    },
  });

  const error = references.error ?? report.error;
  const loading = references.isFetching || report.isFetching;
  const input =
    refs && report.data && termId && !error && !loading
      ? {
          scope: { collegeId, termId, departmentId, programId, instructorId },
          ...refs,
          ...report.data,
        }
      : null;
  const allRows = input ? buildAcademicReport(input, kind) : [];
  const rows =
    kind === "workload" && loadStatus !== "all"
      ? allRows.filter((r) =>
          loadStatus === "missing"
            ? r.required === null
            : loadStatus === "overload"
              ? Number(r.overload) > 0
              : Number(r.deficit) > 0,
        )
      : allRows;
  const headers = ACADEMIC_REPORT_HEADERS[kind];
  const programs =
    refs?.programs.filter((p) => departmentId === "all" || p.department_id === departmentId) ?? [];
  const filterSummary = [
    `الكلية: ${collegeName}`,
    `الفصل: ${term?.name ?? "غير محدد"}`,
    `القسم: ${refs?.departments.find((d) => d.id === departmentId)?.name ?? "الكل"}`,
    `البرنامج: ${refs?.programs.find((p) => p.id === programId)?.name ?? "الكل"}`,
    `عضو هيئة التدريس: ${refs?.instructors.find((i) => i.id === instructorId)?.full_name ?? "الكل"}`,
    kind === "workload"
      ? `الحالة: ${loadStatus === "overload" ? "ساعات زائدة" : loadStatus === "deficit" ? "نقص النصاب" : loadStatus === "missing" ? "سياسة غير محددة" : "الكل"}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReportShell
      title={ACADEMIC_REPORT_TITLES[kind]}
      description="تقارير الشؤون الأكاديمية بحسب الكلية والقسم والبرنامج وعضو هيئة التدريس."
      filename={`academic_affairs_${kind}_${collegeName}_${term?.name ?? ""}`}
      headers={headers}
      rows={rows}
      isLoading={loading}
      filterSummary={filterSummary}
      headerMeta={{ termName: term?.name, note: filterSummary }}
      emptyMessage={
        !termId
          ? "أضف فصلاً دراسياً للكلية لعرض التقارير."
          : error
            ? "تعذر إعداد التقرير؛ حدّث الصفحة للمحاولة مجدداً."
            : "لا توجد بيانات بهذه المعايير."
      }
      filters={
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Filter
            label="نوع التقرير"
            value={kind}
            onChange={(v) => setKind(v as AcademicReportKind)}
            items={Object.entries(ACADEMIC_REPORT_TITLES).map(([id, name]) => ({
              id,
              name,
            }))}
          />
          <Filter
            label="الفصل الدراسي"
            value={termId}
            onChange={setChosenTerm}
            items={refs?.terms ?? []}
          />
          <Filter
            label="القسم"
            value={departmentId}
            onChange={(v) => {
              setDepartmentId(v);
              setProgramId("all");
              setInstructorId("all");
            }}
            items={[{ id: "all", name: "كل الأقسام" }, ...(refs?.departments ?? [])]}
          />
          <Filter
            label="البرنامج"
            value={programId}
            onChange={(v) => {
              setProgramId(v);
              setInstructorId("all");
            }}
            items={[{ id: "all", name: "كل البرامج" }, ...programs]}
          />
          <Filter
            label="عضو هيئة التدريس"
            value={instructorId}
            onChange={setInstructorId}
            items={[
              { id: "all", name: "كل أعضاء هيئة التدريس" },
              ...(refs?.instructors.map((i) => ({
                id: i.id,
                name: i.full_name,
              })) ?? []),
            ]}
          />
          {kind === "workload" && (
            <Filter
              label="حالة النصاب"
              value={loadStatus}
              onChange={setLoadStatus}
              items={[
                { id: "all", name: "الكل" },
                { id: "overload", name: "الساعات الزائدة" },
                { id: "deficit", name: "نقص النصاب" },
                { id: "missing", name: "سياسة النصاب غير محددة" },
              ]}
            />
          )}
        </div>
      }
      leading={
        <>
          {error && (
            <Card role="alert" className="border-destructive p-4 text-destructive">
              تعذر تحميل بيانات التقرير. لا تُعتمد أرقام جزئية.
            </Card>
          )}
          {kind === "workload" && (
            <Card className="p-3 text-sm">
              يُقارن النصاب بالساعات المسندة في الكلية خلال الفصل المحدد، ويظهر إشراف المشاريع
              منفصلاً. مرشح البرنامج يحدد أعضاء هيئة التدريس المرتبطين به، مع إبقاء نصابهم وساعاتهم
              الكلية في الفصل. عند غياب سياسة نصاب معتمدة تظهر شرطة في النصاب والزيادة والنقص؛ ولا
              تُعامل كصفر.
            </Card>
          )}
          {kind === "shortages" && (
            <Card className="p-3 text-sm">
              عجز الإسناد هو ساعات مجموعات التدريس النشطة التي لم تُستكمل تغطيتها؛ وهو مستقل عن نقص
              نصاب عضو هيئة التدريس.
            </Card>
          )}
        </>
      }
    >
      <Card className="min-w-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((h) => (
                <TableHead key={h.key}>{h.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, index) => (
              <TableRow key={index}>
                {headers.map((h) => (
                  <TableCell key={h.key}>{r[h.key] ?? "—"}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </ReportShell>
  );
}

function Filter({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { id: string; name: string }[];
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="اختر" />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
