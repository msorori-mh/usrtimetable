import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { AdminExportMenu } from "@/components/admin-export-menu";
import { headcountsExportDataset } from "@/lib/admin-export/datasets";
import { ACADEMIC_STUDY_SYSTEM_LABELS } from "@/lib/study-systems";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HeadcountImportWorkspace } from "@/components/data-onboarding/headcount-import-workspace";
import { Label } from "@/components/ui/label";
import {
  approveSchedulingCohortTermHeadcount,
  listSchedulingHeadcountRevisions,
  upsertSchedulingCohortTermHeadcount,
} from "@/lib/scheduling-headcount/api";
import {
  differsMateriallyFromEligible,
  validateHeadcountValues,
} from "@/lib/scheduling-headcount/rules";
import type { SchedulingHeadcount } from "@/lib/scheduling-headcount/types";

export const Route = createFileRoute("/_authenticated/scheduling-headcounts")({
  head: () => ({ meta: [{ title: "أعداد الدفعات المعتمدة للجدولة" }] }),
  component: SchedulingHeadcountsPage,
});

type Cohort = { id: string; code: string | null; term_id: string; study_system: string };
type Term = { id: string; name: string };

function SchedulingHeadcountsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SchedulingHeadcount | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const { data: cohorts = [] } = useQuery({
    queryKey: ["scheduling-headcount-cohorts", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_cohorts")
        .select("id, code, term_id, study_system")
        .eq("college_id", active!.id)
        .eq("active", true);
      if (error) throw error;
      return data as Cohort[];
    },
  });
  const { data: terms = [] } = useQuery({
    queryKey: ["scheduling-headcount-terms", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, name")
        .eq("college_id", active!.id);
      if (error) throw error;
      return data as Term[];
    },
  });
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["scheduling-headcounts", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduling_cohort_term_headcounts" as never)
        .select("*")
        .eq("college_id", active!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as SchedulingHeadcount[];
    },
  });
  const { data: history } = useQuery({
    queryKey: ["scheduling-headcount-history", historyId],
    enabled: Boolean(historyId),
    queryFn: async () => listSchedulingHeadcountRevisions(historyId!),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["scheduling-headcounts", active?.id] });
  const save = useMutation({
    mutationFn: upsertSchedulingCohortTermHeadcount,
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.message);
      toast.success("تم حفظ عدد الدفعة كمسودة.");
      setEditing(null);
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const approve = useMutation({
    mutationFn: (id: string) => approveSchedulingCohortTermHeadcount(id),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.message);
      toast.success("تم اعتماد العدد للجدولة.");
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const termName = new Map(terms.map((term) => [term.id, term.name]));
  const cohortName = new Map(
    cohorts.map((cohort) => [cohort.id, cohort.code ?? cohort.id.slice(0, 8)]),
  );
  const missing = cohorts.filter(
    (cohort) =>
      !rows.some(
        (row) =>
          row.cohort_id === cohort.id &&
          row.term_id === cohort.term_id &&
          row.approval_status === "approved",
      ),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Calculator className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">أعداد الدفعات المعتمدة للجدولة</h1>
          <p className="text-sm text-muted-foreground">
            مصدر العدد النهائي لتقسيم مجموعات التدريس والجدولة.
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <AdminExportMenu
          testId="headcounts-export"
          disabled={!active || rows.length === 0}
          dataset={() =>
            headcountsExportDataset({
              rows,
              collegeName: active?.name ?? null,
              cohortLabel: (id) => cohortName.get(id ?? "") ?? "",
              termLabel: (id) => termName.get(id ?? "") ?? "",
              systemLabel: (v) =>
                (v
                  ? ACADEMIC_STUDY_SYSTEM_LABELS[v as keyof typeof ACADEMIC_STUDY_SYSTEM_LABELS]
                  : "") ??
                v ??
                "",
            })
          }
        />
        {canManage && (
          <Button
            onClick={() =>
              setEditing({
                cohort_id: cohorts[0]?.id ?? "",
                term_id: cohorts[0]?.term_id ?? "",
                registered_student_count: 0,
                eligible_student_count: 0,
                expected_attendance_count: 0,
                reserve_margin: 0,
                scheduling_headcount: 0,
                exam_eligible_count: 0,
                source: "",
                notes: null,
              } as SchedulingHeadcount)
            }
          >
            إضافة عدد
          </Button>
        )}
      </div>
      {missing.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
          الخطوة التالية: اعتمد أعداد {missing.length} دفعة نشطة قبل توليد مجموعات المحاضرات
          والمعامل. التوليد مرفوض عند غياب الاعتماد.
        </Card>
      )}
      <HeadcountImportWorkspace />
      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">جاري التحميل…</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right">الدفعة</th>
                <th className="px-3 py-2 text-right">الفصل</th>
                <th className="px-3 py-2 text-right">النظام</th>
                <th className="px-3 py-2 text-right">مسجل/مؤهل/حضور/جدولة</th>
                <th className="px-3 py-2 text-right">المصدر</th>
                <th className="px-3 py-2 text-right">الاعتماد</th>
                <th className="px-3 py-2 text-right">ملاحظات</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{cohortName.get(row.cohort_id) ?? "—"}</td>
                  <td className="px-3 py-2">{termName.get(row.term_id) ?? "—"}</td>
                  <td className="px-3 py-2">{row.study_system}</td>
                  <td className="px-3 py-2">
                    {row.registered_student_count} / {row.eligible_student_count} /{" "}
                    {row.expected_attendance_count} / <strong>{row.scheduling_headcount}</strong>
                    {differsMateriallyFromEligible(
                      row.scheduling_headcount,
                      row.eligible_student_count,
                    ) && <span className="ms-1 text-amber-700">تحذير &gt;20%</span>}
                  </td>
                  <td className="px-3 py-2">{row.source}</td>
                  <td className="px-3 py-2">
                    {row.approval_status}
                    {row.approved_at ? ` · ${new Date(row.approved_at).toLocaleDateString()}` : ""}
                  </td>
                  <td className="px-3 py-2">{row.notes ?? "—"}</td>
                  <td className="space-x-1 px-3 py-2">
                    {canManage && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                        تعديل
                      </Button>
                    )}
                    {canManage && row.approval_status !== "approved" && (
                      <Button size="sm" onClick={() => approve.mutate(row.id)}>
                        اعتماد
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setHistoryId(row.id)}>
                      السجل
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">
              لا توجد أعداد معتمدة أو مسودات لهذه الكلية.
            </p>
          )}
        </Card>
      )}
      {editing && (
        <HeadcountForm
          value={editing}
          cohorts={cohorts}
          canManage={canManage}
          busy={save.isPending}
          onCancel={() => setEditing(null)}
          onSave={(input) => save.mutate(input)}
        />
      )}
      {historyId && (
        <Card className="space-y-2 p-4">
          <div className="flex justify-between">
            <h2 className="font-semibold">سجل التعديلات</h2>
            <Button size="sm" variant="ghost" onClick={() => setHistoryId(null)}>
              إغلاق
            </Button>
          </div>
          {history?.ok ? (
            (
              (history.revisions ?? []) as Array<{
                id: string;
                revision_kind: string;
                changed_at: string;
                notes: string | null;
              }>
            ).map((revision) => (
              <p key={revision.id} className="text-sm">
                {revision.revision_kind} · {new Date(revision.changed_at).toLocaleString()} ·{" "}
                {revision.notes ?? "—"}
              </p>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          )}
        </Card>
      )}
      <Card className="p-4 text-sm">
        <h2 className="font-semibold">الاستثناءات الخاصة بالمقرر أو المكوّن</h2>
        <p className="mt-1 text-muted-foreground">
          تُدار الاستثناءات المعتمدة عبر API الجدولة؛ لها أولوية على عدد الدفعة المعتمد عند مطابقة
          المقرر أو المكوّن.
        </p>
      </Card>
    </div>
  );
}

function HeadcountForm({
  value,
  cohorts,
  canManage,
  busy,
  onCancel,
  onSave,
}: {
  value: SchedulingHeadcount;
  cohorts: Cohort[];
  canManage: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: Parameters<typeof upsertSchedulingCohortTermHeadcount>[0]) => void;
}) {
  const [form, setForm] = useState(value);
  if (!canManage) return null;
  const submit = () => {
    const issues = validateHeadcountValues({
      registeredStudentCount: form.registered_student_count,
      eligibleStudentCount: form.eligible_student_count,
      expectedAttendanceCount: form.expected_attendance_count,
      reserveMargin: form.reserve_margin,
      schedulingHeadcount: form.scheduling_headcount,
      examEligibleCount: form.exam_eligible_count,
      notes: form.notes,
      allowOverEligible: true,
    });
    if (issues.length)
      return toast.error(
        issues[0] === "OVER_ELIGIBLE_REQUIRES_REASON"
          ? "يلزم سبب واضح لتجاوز العدد المؤهل."
          : "كل الأعداد يجب أن تكون أعدادًا صحيحة غير سالبة.",
      );
    onSave({
      cohortId: form.cohort_id,
      termId: form.term_id,
      registeredStudentCount: form.registered_student_count,
      eligibleStudentCount: form.eligible_student_count,
      expectedAttendanceCount: form.expected_attendance_count,
      reserveMargin: form.reserve_margin,
      schedulingHeadcount: form.scheduling_headcount,
      examEligibleCount: form.exam_eligible_count,
      source: form.source,
      notes: form.notes,
      allowOverEligible: true,
    });
  };
  const number = (key: keyof SchedulingHeadcount) => ({
    type: "number",
    value: Number(form[key] ?? 0),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: Number(event.target.value) }),
  });
  return (
    <Card className="space-y-3 p-4" dir="rtl">
      <h2 className="font-semibold">تعديل عدد الدفعة</h2>
      <select
        className="w-full rounded border p-2"
        value={form.cohort_id}
        onChange={(event) => {
          const cohort = cohorts.find((item) => item.id === event.target.value);
          setForm({
            ...form,
            cohort_id: event.target.value,
            term_id: cohort?.term_id ?? form.term_id,
          });
        }}
      >
        {cohorts.map((cohort) => (
          <option key={cohort.id} value={cohort.id}>
            {cohort.code ?? cohort.id}
          </option>
        ))}
      </select>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(
          [
            {
              key: "registered_student_count",
              id: "headcount-registered-student-count",
              label: "عدد المسجلين",
            },
            {
              key: "eligible_student_count",
              id: "headcount-eligible-student-count",
              label: "عدد المؤهلين",
            },
            {
              key: "expected_attendance_count",
              id: "headcount-expected-attendance-count",
              label: "الحضور المتوقع",
            },
            {
              key: "reserve_margin",
              id: "headcount-reserve-margin",
              label: "هامش الاحتياط",
            },
            {
              key: "scheduling_headcount",
              id: "headcount-scheduling-headcount",
              label: "العدد المعتمد للجدولة",
            },
            {
              key: "exam_eligible_count",
              id: "headcount-exam-eligible-count",
              label: "المؤهلون للاختبار",
            },
          ] as const
        ).map(({ key, id, label }) => (
          <div key={key} className="space-y-2">
            <Label className="block text-right" htmlFor={id}>
              {label}
            </Label>
            <input id={id} className="w-full rounded border p-2" {...number(key)} />
          </div>
        ))}
      </div>
      <input
        className="w-full rounded border p-2"
        placeholder="المصدر"
        value={form.source}
        onChange={(event) => setForm({ ...form, source: event.target.value })}
      />
      <textarea
        className="w-full rounded border p-2"
        placeholder="ملاحظات/سبب التجاوز"
        value={form.notes ?? ""}
        onChange={(event) => setForm({ ...form, notes: event.target.value })}
      />
      <div className="flex gap-2">
        <Button disabled={busy || !form.source.trim()} onClick={submit}>
          حفظ
        </Button>
        <Button variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </Card>
  );
}
