import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  deactivateFacultyWorkloadPolicy,
  listFacultyWorkloadAssignedHours,
  listFacultyWorkloadOverloadWarnings,
  resolveFacultyWorkloadPolicy,
  upsertFacultyWorkloadPolicy,
} from "@/lib/faculty-workload/api";
import {
  remainingHours,
  studySystemLabel,
  validateWorkloadPolicyValues,
  warningCodeLabel,
  workloadStatusLabel,
  WORKLOAD_RULE_MESSAGES,
  WORKLOAD_STUDY_SYSTEMS,
} from "@/lib/faculty-workload/rules";
import type {
  FacultyWorkloadPolicy,
  WorkloadPolicyInput,
  WorkloadStudySystem,
} from "@/lib/faculty-workload/types";

export const Route = createFileRoute("/_authenticated/workload-policies")({
  head: () => ({ meta: [{ title: "النصاب التدريسي حسب الدرجة الأكاديمية" }] }),
  component: WorkloadPoliciesPage,
});

type Term = { id: string; name: string };

function WorkloadPoliciesPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FacultyWorkloadPolicy | null>(null);
  const [creating, setCreating] = useState(false);
  const [termFilter, setTermFilter] = useState<string>("");
  const [systemFilter, setSystemFilter] = useState<string>("");
  const [resolveId, setResolveId] = useState<string | null>(null);

  const { data: terms = [] } = useQuery({
    queryKey: ["workload-policy-terms", active?.id],
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

  const { data: policies = [], isLoading: policiesLoading } = useQuery({
    queryKey: ["faculty-workload-policies", active?.id],
    enabled: Boolean(active),
    queryFn: async () => {
      // Read-only RLS SELECT (SELECT stays granted; writes are RPC-only).
      const { data, error } = await supabase
        .from("faculty_workload_policies")
        .select("*")
        .eq("college_id", active!.id)
        .order("rank_code");
      if (error) throw error;
      return data as unknown as FacultyWorkloadPolicy[];
    },
  });

  const scope = {
    termId: termFilter || null,
    studySystem: (systemFilter || null) as WorkloadStudySystem | null,
  };

  const assignedQuery = useQuery({
    queryKey: ["faculty-workload-assigned", active?.id, termFilter, systemFilter],
    enabled: Boolean(active),
    queryFn: async () => {
      const result = await listFacultyWorkloadAssignedHours({
        collegeId: active!.id,
        ...scope,
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
  });

  const warningsQuery = useQuery({
    queryKey: ["faculty-workload-warnings", active?.id, termFilter, systemFilter],
    enabled: Boolean(active),
    queryFn: async () => {
      const result = await listFacultyWorkloadOverloadWarnings({
        collegeId: active!.id,
        ...scope,
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
  });

  const resolvedQuery = useQuery({
    queryKey: ["faculty-workload-resolve", resolveId, termFilter, systemFilter],
    enabled: Boolean(resolveId),
    queryFn: async () => {
      const result = await resolveFacultyWorkloadPolicy({
        instructorId: resolveId!,
        ...scope,
      });
      if (!result.ok) throw new Error(result.message);
      return result;
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["faculty-workload-policies", active?.id] });
    void queryClient.invalidateQueries({ queryKey: ["faculty-workload-assigned"] });
    void queryClient.invalidateQueries({ queryKey: ["faculty-workload-warnings"] });
  };

  const save = useMutation({
    mutationFn: upsertFacultyWorkloadPolicy,
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.message);
      toast.success("تم حفظ سياسة النصاب.");
      setEditing(null);
      setCreating(false);
      refresh();
    },
    onError: (error: Error) =>
      toast.error(`تعذر الحفظ — طبقة RPCs غير مطبقة بعد أو خطأ آخر: ${error.message}`),
  });

  const deactivate = useMutation({
    mutationFn: (id: string) => deactivateFacultyWorkloadPolicy(id),
    onSuccess: (result) => {
      if (!result.ok) return toast.error(result.message);
      toast.success("تم إيقاف السياسة.");
      refresh();
    },
    onError: (error: Error) =>
      toast.error(`تعذر الإيقاف — طبقة RPCs غير مطبقة بعد أو خطأ آخر: ${error.message}`),
  });

  const termName = new Map(terms.map((term) => [term.id, term.name]));
  const assignedRows = assignedQuery.data?.ok ? assignedQuery.data.rows : [];
  const warnings = warningsQuery.data?.ok ? warningsQuery.data.warnings : [];
  const rpcUnavailable = assignedQuery.isError || warningsQuery.isError;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Gauge className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">النصاب التدريسي حسب الدرجة الأكاديمية</h1>
          <p className="text-sm text-muted-foreground">
            إدارة سياسات النصاب ومتابعة الساعات المسندة من الإسناد التدريسي.
          </p>
        </div>
      </header>

      <Card className="border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
        طبقة RPCs الخاصة بسياسات النصاب مصدرية فقط (SOURCE ONLY — NOT APPLIED) ولن تعمل عمليات
        الحفظ والحساب حتى اعتماد الترحيل وتطبيقه (APPROVE_DB_MIGRATION_APPLY) — انحراف تشغيلي
        موثق كمانع جاهزية. تجاوز النصاب تحذير استشاري وليس حظرًا على الكتابة.
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            إضافة سياسة نصاب
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded border p-2"
          value={termFilter}
          onChange={(event) => setTermFilter(event.target.value)}
          aria-label="الفصل الدراسي"
        >
          <option value="">كل الفصول</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </select>
        <select
          className="rounded border p-2"
          value={systemFilter}
          onChange={(event) => setSystemFilter(event.target.value)}
          aria-label="نظام الدراسة"
        >
          <option value="">كل الأنظمة</option>
          {WORKLOAD_STUDY_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {studySystemLabel(system)}
            </option>
          ))}
        </select>
      </div>

      {!active ? (
        <p className="text-sm text-muted-foreground">اختر كلية.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right">الدرجة الأكاديمية</th>
                <th className="px-3 py-2 text-right">رمز الدرجة</th>
                <th className="px-3 py-2 text-right">نظام الدراسة</th>
                <th className="px-3 py-2 text-right">الفصل</th>
                <th className="px-3 py-2 text-right">النصاب المطلوب</th>
                <th className="px-3 py-2 text-right">الأدنى/الأعلى</th>
                <th className="px-3 py-2 text-right">تجاوز مسموح</th>
                <th className="px-3 py-2 text-right">الحالة</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.id} className="border-t">
                  <td className="px-3 py-2">{policy.rank_label_ar ?? "—"}</td>
                  <td className="px-3 py-2" dir="ltr">
                    {policy.rank_code}
                  </td>
                  <td className="px-3 py-2">{studySystemLabel(policy.study_system)}</td>
                  <td className="px-3 py-2">
                    {policy.term_id ? (termName.get(policy.term_id) ?? "—") : "الكل"}
                  </td>
                  <td className="px-3 py-2">
                    <strong>{policy.required_load_hours}</strong>
                  </td>
                  <td className="px-3 py-2">
                    {policy.min_load_hours ?? "—"} / {policy.max_load_hours ?? "—"}
                  </td>
                  <td className="px-3 py-2">{policy.overload_allowed ? "نعم" : "لا"}</td>
                  <td className="px-3 py-2">{policy.active ? "نشطة" : "موقوفة"}</td>
                  <td className="space-x-1 px-3 py-2">
                    {canManage && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(policy)}>
                        تعديل
                      </Button>
                    )}
                    {canManage && policy.active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deactivate.mutate(policy.id)}
                      >
                        إيقاف
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!policiesLoading && policies.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">
              لا توجد سياسات نصاب لهذه الكلية بعد.
            </p>
          )}
        </Card>
      )}

      {rpcUnavailable && active && (
        <Card className="border-amber-500/40 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
          تعذر جلب الساعات المسندة والتحذيرات — طبقة RPCs غير مطبقة بعد (NOT APPLIED).
        </Card>
      )}

      {active && assignedRows.length > 0 && (
        <Card className="overflow-x-auto">
          <h2 className="px-3 pt-3 font-semibold">الساعات المسندة مقابل النصاب</h2>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-right">المحاضر</th>
                <th className="px-3 py-2 text-right">الرقم الوظيفي</th>
                <th className="px-3 py-2 text-right">الدرجة</th>
                <th className="px-3 py-2 text-right">المسند</th>
                <th className="px-3 py-2 text-right">المطلوب</th>
                <th className="px-3 py-2 text-right">المتبقي</th>
                <th className="px-3 py-2 text-right">الحالة</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {assignedRows.map((row) => {
                const remaining = remainingHours(row);
                const warn =
                  row.status === "overload" ||
                  row.status === "over_max" ||
                  row.status === "below_min";
                return (
                  <tr key={row.instructor_id} className="border-t">
                    <td className="px-3 py-2">{row.full_name}</td>
                    <td className="px-3 py-2">{row.employee_number ?? "—"}</td>
                    <td className="px-3 py-2">{row.academic_rank ?? "—"}</td>
                    <td className="px-3 py-2">{row.standard_assigned_hours}</td>
                    <td className="px-3 py-2">{row.required_load_hours ?? "—"}</td>
                    <td className="px-3 py-2">{remaining ?? "—"}</td>
                    <td className={`px-3 py-2 ${warn ? "text-amber-700" : ""}`}>
                      {workloadStatusLabel(row.status)}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResolveId(row.instructor_id)}
                      >
                        السياسة
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {active && warnings.length > 0 && (
        <Card className="space-y-2 p-4">
          <h2 className="font-semibold">تحذيرات النصاب (استشارية — ليست حظرًا)</h2>
          {warnings.map((warning) => (
            <p key={`${warning.instructor_id}-${warning.warning_code}`} className="text-sm">
              {warning.full_name} — {warningCodeLabel(warning.warning_code)} · المسند{" "}
              {warning.standard_assigned_hours}
              {warning.required_load_hours !== null
                ? ` / المطلوب ${warning.required_load_hours}`
                : ""}
              {warning.blocking ? " · يتطلب انتباه مدير الكلية" : ""}
            </p>
          ))}
        </Card>
      )}

      {resolveId && (
        <Card className="space-y-2 p-4">
          <div className="flex justify-between">
            <h2 className="font-semibold">السياسة المطبقة على المحاضر</h2>
            <Button size="sm" variant="ghost" onClick={() => setResolveId(null)}>
              إغلاق
            </Button>
          </div>
          {resolvedQuery.data?.ok ? (
            resolvedQuery.data.policy_missing ? (
              <p className="text-sm text-muted-foreground">
                لا توجد سياسة مطابقة لدرجة هذا المحاضر ضمن النطاق المحدد.
              </p>
            ) : (
              <p className="text-sm">
                {resolvedQuery.data.policy?.rank_label_ar ??
                  resolvedQuery.data.policy?.rank_code}{" "}
                — المطلوب {resolvedQuery.data.policy?.required_load_hours} ·{" "}
                {studySystemLabel(resolvedQuery.data.policy?.study_system)} ·{" "}
                {resolvedQuery.data.policy?.term_id
                  ? (termName.get(resolvedQuery.data.policy.term_id) ?? "—")
                  : "كل الفصول"}
              </p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              {resolvedQuery.isError
                ? "تعذر الاستعلام — طبقة RPCs غير مطبقة بعد."
                : "جاري التحميل…"}
            </p>
          )}
        </Card>
      )}

      {(creating || editing) && active && (
        <PolicyForm
          value={editing}
          collegeId={active.id}
          terms={terms}
          busy={save.isPending}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={(input) => save.mutate(input)}
        />
      )}
    </div>
  );
}

function PolicyForm({
  value,
  collegeId,
  terms,
  busy,
  onCancel,
  onSave,
}: {
  value: FacultyWorkloadPolicy | null;
  collegeId: string;
  terms: Term[];
  busy: boolean;
  onCancel: () => void;
  onSave: (input: WorkloadPolicyInput) => void;
}) {
  const [rankCode, setRankCode] = useState(value?.rank_code ?? "");
  const [rankLabelAr, setRankLabelAr] = useState(value?.rank_label_ar ?? "");
  const [aliases, setAliases] = useState((value?.rank_aliases ?? []).join("، "));
  const [studySystem, setStudySystem] = useState<string>(value?.study_system ?? "");
  const [termId, setTermId] = useState<string>(value?.term_id ?? "");
  const [requiredHours, setRequiredHours] = useState<number>(value?.required_load_hours ?? 0);
  const [minHours, setMinHours] = useState<number | null>(value?.min_load_hours ?? null);
  const [maxHours, setMaxHours] = useState<number | null>(value?.max_load_hours ?? null);
  const [overloadAllowed, setOverloadAllowed] = useState(value?.overload_allowed ?? false);
  const [notes, setNotes] = useState(value?.notes ?? "");

  const submit = () => {
    const issues = validateWorkloadPolicyValues({
      rankCode,
      requiredLoadHours: requiredHours,
      studySystem: studySystem || null,
      minLoadHours: minHours,
      maxLoadHours: maxHours,
    });
    if (issues.length) return toast.error(WORKLOAD_RULE_MESSAGES[issues[0]]);
    onSave({
      collegeId,
      rankCode,
      requiredLoadHours: requiredHours,
      rankLabelAr: rankLabelAr.trim() || null,
      rankAliases: aliases
        .split(/[،,]/)
        .map((alias) => alias.trim())
        .filter(Boolean),
      studySystem: (studySystem || null) as WorkloadStudySystem | null,
      termId: termId || null,
      minLoadHours: minHours,
      maxLoadHours: maxHours,
      overloadAllowed,
      notes: notes.trim() || null,
    });
  };

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">{value ? "تعديل سياسة النصاب" : "إضافة سياسة نصاب"}</h2>
      <div className="grid gap-2 md:grid-cols-2">
        <input
          className="rounded border p-2"
          placeholder="رمز الدرجة (snake_case مثل assistant_professor)"
          dir="ltr"
          value={rankCode}
          onChange={(event) => setRankCode(event.target.value)}
          disabled={Boolean(value)}
        />
        <input
          className="rounded border p-2"
          placeholder="الدرجة الأكاديمية (مثل: أستاذ مساعد)"
          value={rankLabelAr}
          onChange={(event) => setRankLabelAr(event.target.value)}
        />
      </div>
      <input
        className="w-full rounded border p-2"
        placeholder="ألقاب بديلة مطابقة لدرجة المحاضر (افصل بفاصلة)"
        value={aliases}
        onChange={(event) => setAliases(event.target.value)}
      />
      <div className="grid gap-2 md:grid-cols-2">
        <select
          className="rounded border p-2"
          value={studySystem}
          onChange={(event) => setStudySystem(event.target.value)}
          aria-label="نظام الدراسة"
          disabled={Boolean(value)}
        >
          <option value="">كل الأنظمة</option>
          {WORKLOAD_STUDY_SYSTEMS.map((system) => (
            <option key={system} value={system}>
              {studySystemLabel(system)}
            </option>
          ))}
        </select>
        <select
          className="rounded border p-2"
          value={termId}
          onChange={(event) => setTermId(event.target.value)}
          aria-label="الفصل الدراسي"
          disabled={Boolean(value)}
        >
          <option value="">كل الفصول</option>
          {terms.map((term) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span>النصاب المطلوب (ساعات)</span>
          <input
            type="number"
            className="w-full rounded border p-2"
            value={requiredHours}
            onChange={(event) => setRequiredHours(Number(event.target.value))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>الحد الأدنى (اختياري)</span>
          <input
            type="number"
            className="w-full rounded border p-2"
            value={minHours ?? ""}
            onChange={(event) =>
              setMinHours(event.target.value === "" ? null : Number(event.target.value))
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>الحد الأعلى (اختياري)</span>
          <input
            type="number"
            className="w-full rounded border p-2"
            value={maxHours ?? ""}
            onChange={(event) =>
              setMaxHours(event.target.value === "" ? null : Number(event.target.value))
            }
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={overloadAllowed}
          onChange={(event) => setOverloadAllowed(event.target.checked)}
        />
        إمكانية تجاوز النصاب (تحذير فقط — ليس حظرًا)
      </label>
      <textarea
        className="w-full rounded border p-2"
        placeholder="ملاحظات"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div className="flex gap-2">
        <Button disabled={busy || !rankCode.trim()} onClick={submit}>
          حفظ
        </Button>
        <Button variant="outline" onClick={onCancel}>
          إلغاء
        </Button>
      </div>
    </Card>
  );
}
