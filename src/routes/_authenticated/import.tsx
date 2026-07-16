import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { useCurrentUser } from "@/hooks/use-current-user";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  FileSpreadsheet,
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { TEMPLATES, buildTemplateWorkbook, parseExcel } from "@/lib/excel-import/templates";
import { validate } from "@/lib/excel-import/validators";
import { commitImport, createJobAndPersistErrors } from "@/lib/excel-import/commit";
import { invokeGenerateAcademicDelivery } from "@/lib/academic-delivery-v2/invoke-generator";
import type { ImportEntity, ImportMode, ParsedRow, RowError } from "@/lib/excel-import/types";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "استيراد البيانات" }] }),
  component: ImportPage,
});

const ENTITIES: { value: ImportEntity; label: string; group: string; description: string }[] = [
  {
    value: "instructors",
    label: "المحاضرون",
    group: "موارد",
    description: "بيانات المحاضرين وأنواع التوظيف والحدود الأسبوعية.",
  },
  {
    value: "rooms",
    label: "القاعات والمعامل",
    group: "موارد",
    description: "الأماكن المادية المستخدمة لتقديم المحاضرات والتطبيقات.",
  },
  {
    value: "daily_breaks",
    label: "الاستراحات اليومية",
    group: "موارد",
    description: "فترات الاستراحة التي تؤثر على توليد أوقات الجدولة.",
  },
  {
    value: "sections",
    label: "المجموعات الدراسية",
    group: "موارد",
    description: "مجموعات الطلاب المرتبطة بالبرنامج والمستوى ونظام الدراسة.",
  },
  {
    value: "academic_terms",
    label: "الفصول الأكاديمية",
    group: "بيانات أكاديمية",
    description: "الفصل الأول أو الثاني ضمن العام الأكاديمي.",
  },
  {
    value: "study_plan_courses",
    label: "الخطط الدراسية",
    group: "بيانات أكاديمية",
    description:
      "مقررات الخطة حسب المستوى والفصل مع ساعات المكونات الصريحة (نظري/عملي/تمارين/مشروع/تدريب صيفي).",
  },
  {
    value: "full_study_plan",
    label: "خطة دراسية كاملة",
    group: "بيانات أكاديمية",
    description: "استيراد الخطة الأكاديمية الكاملة للبرنامج مع ساعات المكونات الصريحة.",
  },
  {
    value: "course_programs",
    label: "البرامج (ربط مقررات)",
    group: "بيانات أكاديمية",
    description: "ربط المقررات المشتركة بالبرامج.",
  },
  {
    value: "academic_cohorts",
    label: "الدفعات الأكاديمية",
    group: "نموذج التسليم V2",
    description:
      "استيراد الدفعات (برنامج + مستوى + نظام + فصل + عدد الطلاب). بعد النجاح استدعِ مولّد التسليم صراحةً.",
  },
  {
    value: "cohort_elective_selections",
    label: "اختيارات المقررات الاختيارية",
    group: "نموذج التسليم V2",
    description: "ربط كل دفعة بخانة اختيارية ومقرر فعلي مسموح داخل الخانة.",
  },
  {
    value: "teaching_assignments",
    label: "الإسناد التدريسي",
    group: "تحضير التدريس",
    description:
      "إسناد V2: دفعة + مقرر + مكوّن + مجموعة تسليم + محاضر. المسار القديم (نوع المحاضرة) يبقى للتوافق.",
  },
  {
    value: "section_groups",
    label: "المجموعات المرتبطة بالمقررات",
    group: "تحضير التدريس",
    description: "دمج مجموعات دراسية لمقرر مشترك.",
  },
];

const MODES: { value: ImportMode; label: string; desc: string }[] = [
  { value: "insert_only", label: "إدراج فقط", desc: "تجاهل الصفوف الموجودة" },
  { value: "update_existing", label: "تحديث الموجود فقط", desc: "تجاهل الصفوف الجديدة" },
  { value: "upsert", label: "إدراج وتحديث", desc: "إدراج جديد + تحديث موجود" },
];

function ImportPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [entity, setEntity] = useState<ImportEntity>("instructors");
  const [mode, setMode] = useState<ImportMode>("insert_only");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    valid: ParsedRow[];
    invalid: ParsedRow[];
    errors: RowError[];
    jobId: string | null;
    total: number;
    missingHeaders: string[];
  } | null>(null);
  const [pendingGeneratorCohortIds, setPendingGeneratorCohortIds] = useState<string[]>([]);
  const [generatorNote, setGeneratorNote] = useState<string | null>(null);

  const downloadTemplate = async () => {
    try {
      const blob = await buildTemplateWorkbook(entity);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `template_${entity}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!active || !file || !user) throw new Error("بيانات ناقصة");
      const { headers, rows } = await parseExcel(file);
      const result = await validate(entity, headers, rows, active.id);
      const jobId = await createJobAndPersistErrors(
        entity,
        mode,
        active.id,
        file.name,
        rows.length,
        result.validRows,
        result.errors,
        user.id,
      );
      return {
        valid: result.validRows,
        invalid: result.invalidRows,
        errors: result.errors,
        jobId,
        total: rows.length,
        missingHeaders: result.missingHeaders,
      };
    },
    onSuccess: (r) => {
      setPreview(r);
      toast.success(`تم تحليل ${r.total} صف`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const commitMut = useMutation({
    mutationFn: async () => {
      if (!active || !preview || !preview.jobId) throw new Error("لا توجد معاينة");
      const result = await commitImport(entity, mode, active.id, preview.jobId, preview.valid);
      let cohortIds: string[] = [];
      if (entity === "academic_cohorts" && result.failed === 0) {
        // Resolve cohort ids for explicit generator step (not auto-run)
        const keys = preview.valid
          .map((row) => {
            const v = row.values;
            return {
              program_id: v._program_id as string | undefined,
              level_id: v._level_id as string | undefined,
              study_system: v.study_system as string | undefined,
              entry_year: v.entry_year as number | undefined,
              term_id: v._term_id as string | undefined,
            };
          })
          .filter(
            (k) =>
              k.program_id && k.level_id && k.study_system && k.entry_year != null && k.term_id,
          );
        if (keys.length > 0) {
          const { data } = await supabase
            .from("academic_cohorts")
            .select("id, program_id, level_id, study_system, entry_year, term_id")
            .eq("college_id", active.id);
          const want = new Set(
            keys.map(
              (k) => `${k.program_id}|${k.level_id}|${k.study_system}|${k.entry_year}|${k.term_id}`,
            ),
          );
          cohortIds = (data ?? [])
            .filter((c) =>
              want.has(
                `${c.program_id}|${c.level_id}|${c.study_system}|${c.entry_year}|${c.term_id}`,
              ),
            )
            .map((c) => c.id);
        }
      }
      return { result, cohortIds };
    },
    onSuccess: ({ result: r, cohortIds }) => {
      toast.success(
        `تم: ${r.inserted} إدراج، ${r.updated} تحديث، ${r.skipped} تجاهل، ${r.failed} فشل`,
      );
      setFile(null);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["import-jobs"] });
      if (entity === "academic_cohorts" && r.failed === 0) {
        setPendingGeneratorCohortIds(cohortIds);
        setGeneratorNote(
          cohortIds.length > 0
            ? `استيراد الدفعات نجح. الخطوة التالية الصريحة: توليد نموذج التسليم V2 لـ ${cohortIds.length} دفعة (لا يعمل تلقائيًا).`
            : "استيراد الدفعات نجح. يمكنك لاحقًا استدعاء مولّد التسليم V2 صراحةً بعد تطبيق migration.",
        );
      } else {
        setPendingGeneratorCohortIds([]);
        setGeneratorNote(null);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateMut = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("لا توجد كلية نشطة");
      if (pendingGeneratorCohortIds.length === 0) {
        throw new Error("لا توجد دفعات محددة للتوليد");
      }
      return invokeGenerateAcademicDelivery({
        collegeId: active.id,
        cohortIds: pendingGeneratorCohortIds,
      });
    },
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(r.message_ar ?? "اكتمل توليد نموذج التسليم");
        setPendingGeneratorCohortIds([]);
        setGeneratorNote(
          `مولّد V2: عروض ${r.summary.offerings_created}/${r.summary.offerings_updated} · مجموعات ${r.summary.delivery_groups_created}/${r.summary.delivery_groups_updated}`,
        );
      } else {
        toast.error(r.message_ar ?? r.code ?? "فشل التوليد");
        setGeneratorNote(
          r.message_ar ?? "فشل استدعاء المولّد — تأكد من تطبيق migration Phase 9.2.",
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reset = () => {
    setFile(null);
    setPreview(null);
  };

  if (!active)
    return (
      <div className="p-6">
        <CollegeSwitcher />
        <p className="mt-4 text-muted-foreground">اختر كلّية للبدء.</p>
      </div>
    );
  if (!canManage)
    return (
      <div className="p-6">
        <CollegeSwitcher />
        <p className="mt-4 text-muted-foreground">لا تملك صلاحية الاستيراد لهذه الكلّية.</p>
      </div>
    );

  const tpl = TEMPLATES[entity];
  const selectedMeta = ENTITIES.find((e) => e.value === entity);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <FileSpreadsheet className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">استيراد البيانات من Excel</h1>
          <p className="text-sm text-muted-foreground">
            حمّل القالب، عبّئه، ارفعه، عاين، ثم احفظ.{" "}
            <Link to="/data-templates" className="text-primary underline-offset-4 hover:underline">
              عرض كل القوالب ←
            </Link>
          </p>
        </div>
        <CollegeSwitcher />
      </header>

      <Card className="p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>نوع البيانات</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as ImportEntity);
                reset();
              }}
            >
              {Array.from(new Set(ENTITIES.map((e) => e.group))).map((g) => (
                <optgroup key={g} label={g}>
                  {ENTITIES.filter((e) => e.group === g).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {selectedMeta && (
              <p className="mt-2 text-xs text-muted-foreground">{selectedMeta.description}</p>
            )}
          </div>
          <div>
            <Label>وضع الاستيراد</Label>
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as ImportMode)}
            >
              {MODES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} — {o.desc}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={downloadTemplate}>
              <Download className="ml-2 h-4 w-4" /> تنزيل القالب
            </Button>
          </div>
        </div>

        <div className="rounded-md border-2 border-dashed border-border p-6 text-center">
          <input
            id="xfile"
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
          <label htmlFor="xfile" className="flex cursor-pointer flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="font-medium">{file ? file.name : "اختر ملف .xlsx أو اسحبه هنا"}</span>
            <span className="text-xs text-muted-foreground">
              الكيان: {tpl.label} · المفتاح الفريد: {tpl.uniqueKeyLabel}
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => previewMut.mutate()} disabled={!file || previewMut.isPending}>
            {previewMut.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
            تحليل ومعاينة
          </Button>
          {file && (
            <Button variant="ghost" onClick={reset}>
              إلغاء
            </Button>
          )}
        </div>
      </Card>

      {(generatorNote || pendingGeneratorCohortIds.length > 0) && (
        <Card className="space-y-3 border-amber-500/40 bg-amber-500/5 p-4">
          <h2 className="font-semibold">خطوة صريحة: مولّد نموذج التسليم V2</h2>
          {generatorNote && <p className="text-sm text-muted-foreground">{generatorNote}</p>}
          <p className="text-xs text-muted-foreground">
            التوليد idempotent ومحدود بالدفعات المحددة فقط — ليس أثرًا جانبيًا عند الاستيراد.
          </p>
          {pendingGeneratorCohortIds.length > 0 && (
            <Button
              onClick={() => generateMut.mutate()}
              disabled={generateMut.isPending}
              variant="secondary"
            >
              {generateMut.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
              توليد نموذج التسليم للدفعات المستوردة ({pendingGeneratorCohortIds.length})
            </Button>
          )}
        </Card>
      )}

      {preview && (
        <Card className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="إجمالي الصفوف" value={preview.total} />
            <Stat label="صفوف صالحة" value={preview.valid.length} tone="ok" />
            <Stat
              label="صفوف خاطئة"
              value={preview.invalid.length}
              tone={preview.invalid.length ? "err" : "ok"}
            />
            <Stat
              label="عدد الأخطاء"
              value={preview.errors.length}
              tone={preview.errors.length ? "err" : "ok"}
            />
          </div>

          {preview.missingHeaders.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-semibold text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> القالب غير مطابق — أعمدة مطلوبة مفقودة
              </p>
              <p className="mt-1 text-destructive/90">
                الأعمدة الناقصة: {preview.missingHeaders.join("، ")}
              </p>
              <p className="mt-1 text-muted-foreground">
                نزّل القالب الرسمي وأعد الرفع. زر التأكيد معطّل.
              </p>
            </div>
          )}

          {preview.errors.length > 0 && (
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-semibold text-destructive">
                <AlertCircle className="h-4 w-4" /> تفاصيل الأخطاء (أول 50)
              </h3>
              <div className="max-h-72 overflow-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs">
                    <tr>
                      <th className="p-2 text-right">الصف</th>
                      <th className="p-2 text-right">العمود</th>
                      <th className="p-2 text-right">الخطأ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.slice(0, 50).map((e, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2">{e.rowNumber}</td>
                        <td className="p-2">{e.columnName ?? "—"}</td>
                        <td className="p-2 text-destructive">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.valid.length > 0 && (
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-semibold text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> معاينة الصفوف الصالحة (أول 20)
              </h3>
              <div className="max-h-72 overflow-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs">
                    <tr>
                      <th className="p-2 text-right">#</th>
                      {tpl.columns.slice(0, 6).map((c) => (
                        <th key={c.key} className="p-2 text-right">
                          {c.header}
                        </th>
                      ))}
                      <th className="p-2">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.valid.slice(0, 20).map((r) => (
                      <tr key={r.rowNumber} className="border-t border-border">
                        <td className="p-2">{r.rowNumber}</td>
                        {tpl.columns.slice(0, 6).map((c) => (
                          <td key={c.key} className="p-2">
                            {String(r.values[c.key] ?? "—")}
                          </td>
                        ))}
                        <td className="p-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs ${r.values._exists ? "bg-amber-500/15 text-amber-700" : "bg-emerald-500/15 text-emerald-700"}`}
                          >
                            {r.values._exists ? "موجود" : "جديد"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={reset}>
              إلغاء
            </Button>
            <Button
              onClick={() => commitMut.mutate()}
              disabled={preview.valid.length === 0 || commitMut.isPending}
            >
              {commitMut.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
              تأكيد الاستيراد ({preview.valid.length} صف)
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "err" }) {
  return (
    <div
      className={`rounded-lg border p-3 ${tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" : tone === "err" ? "border-destructive/30 bg-destructive/5" : "border-border"}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value.toLocaleString("ar-EG")}</p>
    </div>
  );
}
