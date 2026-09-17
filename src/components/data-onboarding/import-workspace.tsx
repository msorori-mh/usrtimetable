import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { useCurrentUser } from "@/hooks/use-current-user";
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
import {
  commitImport,
  createJobAndPersistErrors,
  type CommitResult,
} from "@/lib/excel-import/commit";
import { listImportUiEntities, suggestedTemplateFilename } from "@/lib/excel-import/registry";
import type { ImportEntity, ImportMode, ParsedRow, RowError } from "@/lib/excel-import/types";
import {
  detectWorkbookMode,
  previewSourceWorkbookImport,
} from "@/lib/excel-import/teaching-assignments-source-import";
import { parseSourceWorkbookFile } from "@/lib/excel-import/teaching-assignments-source-parser";
import {
  SOURCE_STUDY_SYSTEM_OPTIONS,
  type SourceStudySystemScope,
  type TeachingImportWorkbookMode,
} from "@/lib/excel-import/teaching-assignments-source-schema";
import type { SourceResolutionPreview } from "@/lib/excel-import/teaching-assignments-source-resolver";
import { READ_ONLY_VIEW_BADGE_AR, isInstitutionalReadOnlyViewer } from "@/lib/unauthorized-access";
import { preparationLabel } from "@/lib/data-onboarding/preparation";
import { instructorStatusLabel } from "@/lib/excel-import/instructor-sheet";
import { HeadcountImportWorkspace } from "./headcount-import-workspace";

const ENTITIES = listImportUiEntities().map((m) => ({
  value: m.entity,
  label: m.label,
  group: m.group,
  description: m.description,
  dependsOn: m.dependsOn,
}));

const MODES: { value: ImportMode; label: string; desc: string }[] = [
  { value: "insert_only", label: "إدراج فقط", desc: "تجاهل الصفوف الموجودة" },
  { value: "update_existing", label: "تحديث الموجود فقط", desc: "تجاهل الصفوف الجديدة" },
  { value: "upsert", label: "إدراج وتحديث", desc: "إدراج جديد + تحديث موجود" },
];

interface ImportWorkspaceProps {
  entities: ImportEntity[];
  onCommitted?: () => void;
  onEntityChange?: (entity: ImportEntity) => void;
}

export function ImportWorkspace(props: ImportWorkspaceProps) {
  const { active } = useActiveCollege();
  if (!active || props.entities.length === 0) return null;
  return <ImportChoice key={`${active.id}:${props.entities.join(",")}`} {...props} />;
}

function ImportChoice(props: ImportWorkspaceProps) {
  const [headcounts, setHeadcounts] = useState(false);
  if (!props.entities.includes("academic_cohorts")) return <ImportForm {...props} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" aria-label="نوع استيراد الدفعات">
        <Button variant={headcounts ? "outline" : "default"} onClick={() => setHeadcounts(false)}>
          الدفعات واختياراتها
        </Button>
        <Button variant={headcounts ? "default" : "outline"} onClick={() => setHeadcounts(true)}>
          أعداد الطلاب للجدولة
        </Button>
      </div>
      {headcounts ? (
        <HeadcountImportWorkspace onCommitted={props.onCommitted} />
      ) : (
        <ImportForm {...props} />
      )}
    </div>
  );
}

function ImportForm({ entities, onCommitted, onEntityChange }: ImportWorkspaceProps) {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const { data: user } = useCurrentUser();
  const viewOnly = isInstitutionalReadOnlyViewer(user);
  const qc = useQueryClient();
  const [entity, setEntity] = useState<ImportEntity>(entities[0]);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [detectingFile, setDetectingFile] = useState(false);
  const [downloadingCurrent, setDownloadingCurrent] = useState(false);
  const availableEntities = ENTITIES.filter((e) => entities.includes(e.value));
  const [mode, setMode] = useState<ImportMode>("insert_only");
  const [file, setFile] = useState<File | null>(null);
  const [workbookMode, setWorkbookMode] = useState<TeachingImportWorkbookMode | null>(null);
  const [studySystemScope, setStudySystemScope] = useState<SourceStudySystemScope>("regular_only");
  const [sheetTermMap, setSheetTermMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    valid: ParsedRow[];
    invalid: ParsedRow[];
    errors: RowError[];
    jobId: string | null;
    total: number;
    missingHeaders: string[];
    sourceResolution?: SourceResolutionPreview;
    sourceSheets?: string[];
    sourceReadyRows?: number;
    canonicalOperations?: number;
    teachingHoursContractBlockers?: number;
  } | null>(null);

  const { data: collegeTerms = [] } = useQuery({
    queryKey: ["import-academic-terms", active?.id],
    enabled: !!active && entity === "teaching_assignments_v2",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, code, name, term_type")
        .eq("college_id", active!.id)
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Programs can only resolve a department of the same college — block the upload
  // with a clear reason until at least one department exists.
  const { data: departmentCount } = useQuery({
    queryKey: ["import-department-count", active?.id],
    enabled: !!active && entity === "academic_programs",
    queryFn: async () => {
      const { count, error } = await supabase
        .from("departments")
        .select("id", { count: "exact", head: true })
        .eq("college_id", active!.id)
        .eq("is_archived", false);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const programsBlocked = entity === "academic_programs" && departmentCount === 0;

  const downloadTemplate = async () => {
    try {
      const blob = await buildTemplateWorkbook(entity);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedTemplateFilename(entity, {
        collegeCode: active?.code ?? undefined,
      });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const downloadCurrentInstructors = async () => {
    if (!active || !canManage || viewOnly) return;
    setDownloadingCurrent(true);
    try {
      const { buildCurrentInstructorWorkbook } =
        await import("@/lib/data-onboarding/instructor-workbook");
      const blob = await buildCurrentInstructorWorkbook(active.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "instructors-current.xlsx";
      anchor.click();
      URL.revokeObjectURL(url);
      setMode("update_existing");
      toast.success("عُدّل وضع الاستيراد إلى تحديث الموجود فقط. أكمل الكشف ثم ارفعه هنا.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تنزيل الكشف");
    } finally {
      setDownloadingCurrent(false);
    }
  };

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!canManage || viewOnly) throw new Error("لا تملك صلاحية الاستيراد لهذه الكلّية.");
      if (!active || !file || !user) throw new Error("بيانات ناقصة");

      if (entity === "teaching_assignments_v2") {
        const detectedMode = await detectWorkbookMode(file);
        setWorkbookMode(detectedMode);

        if (detectedMode === "academic_source_workbook") {
          const missingTerms = Object.keys(sheetTermMap).length === 0;
          const sourcePreview = await previewSourceWorkbookImport({
            file,
            collegeId: active.id,
            sheetTermMap,
            studySystemScope,
          });
          const sheetNames = sourcePreview.workbook.sheets.map((s) => s.sheetName);
          const unmappedSheets = sheetNames.filter((n) => !sheetTermMap[n]);
          if (unmappedSheets.length > 0) {
            throw new Error(`حدد الفصل الأكاديمي لكل ورقة: ${unmappedSheets.join("، ")}`);
          }
          if (missingTerms && sheetNames.length > 0) {
            throw new Error("حدد الفصل الأكاديمي لكل ورقة في الدفتر");
          }
          const jobId = await createJobAndPersistErrors(
            entity,
            mode,
            active.id,
            file.name,
            sourcePreview.resolution.totals.sourceRows,
            sourcePreview.validRows,
            sourcePreview.errors,
            user.id,
          );
          return {
            valid: sourcePreview.validRows,
            invalid: [],
            errors: sourcePreview.errors,
            jobId,
            total: sourcePreview.resolution.totals.sourceRows,
            missingHeaders: [],
            sourceResolution: sourcePreview.resolution,
            sourceSheets: sheetNames,
            sourceReadyRows: sourcePreview.sourceReadyRows,
            canonicalOperations: sourcePreview.canonicalOperations,
            teachingHoursContractBlockers: sourcePreview.teachingHoursContractBlockers,
          };
        }
      }

      const { headers, rows, rowNumbers, headerRowNumber } = await parseExcel(file, entity);
      const result = await validate(entity, headers, rows, active.id, rowNumbers, headerRowNumber);
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
      if (!canManage || viewOnly) throw new Error("لا تملك صلاحية الاستيراد لهذه الكلّية.");
      if (!active || !preview || !preview.jobId) throw new Error("لا توجد معاينة");
      // Atomic server commit: job_id (+ optional concurrency token) only.
      // Stored validated payload is authoritative; no client operational DML.
      const { data: jobRow, error: jobErr } = await supabase
        .from("import_jobs")
        .select("updated_at")
        .eq("id", preview.jobId)
        .eq("college_id", active.id)
        .maybeSingle();
      if (jobErr) throw jobErr;
      return commitImport({
        jobId: preview.jobId,
        expectedUpdatedAt: jobRow?.updated_at ?? null,
      });
    },
    onSuccess: (r) => {
      setResult(r);
      if (r.failed > 0) toast.warning(`اكتملت العملية مع تعذر استيراد ${r.failed} صف`);
      else toast.success(`تم الاستيراد: ${r.inserted} إضافة، ${r.updated} تحديث`);
      setFile(null);
      setPreview(null);
      void qc.invalidateQueries({ queryKey: ["import-jobs"] });
      void qc.invalidateQueries({ predicate: (query) => query.queryKey.includes(active?.id) });
      onCommitted?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reset = () => {
    setResult(null);
    setFile(null);
    setPreview(null);
    setWorkbookMode(null);
    setSheetTermMap({});
  };

  const onFileSelected = async (next: File | null) => {
    setResult(null);
    setFile(next);
    setPreview(null);
    setSheetTermMap({});
    if (next && entity === "teaching_assignments_v2") {
      setDetectingFile(true);
      try {
        const detected = await detectWorkbookMode(next);
        setWorkbookMode(detected);
      } catch {
        setWorkbookMode(null);
      } finally {
        setDetectingFile(false);
      }
    } else {
      setWorkbookMode(null);
    }
  };

  if (!active) return null;
  if (viewOnly) return <p role="note">{READ_ONLY_VIEW_BADGE_AR}</p>;
  if (!canManage) return <p role="note">لا تملك صلاحية الاستيراد لهذه الكلّية.</p>;

  const isSourceMode =
    entity === "teaching_assignments_v2" && workbookMode === "academic_source_workbook";
  const allSheetTermsSelected =
    !isSourceMode ||
    (Object.keys(sheetTermMap).length > 0 &&
      Object.values(sheetTermMap).every((v) => String(v).trim() !== ""));

  const tpl = TEMPLATES[entity];
  const selectedMeta = ENTITIES.find((e) => e.value === entity);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <FileSpreadsheet className="h-5 w-5" /> استيراد بيانات هذه الخطوة
        </h3>
        <ol
          className="flex flex-wrap gap-3 text-sm text-muted-foreground"
          aria-label="مراحل الاستيراد"
        >
          <li>١. نزّل القالب وعبّئه</li>
          <li>٢. ارفع الملف وافحصه</li>
          <li>٣. راجع النتيجة وأكّد الاستيراد</li>
        </ol>
      </div>
      {result && (
        <Card className="border-emerald-500/30 p-4" role="status">
          <p className="font-semibold">
            {result.failed > 0 ? "اكتمل الاستيراد مع ملاحظات" : "تم حفظ البيانات"}
          </p>
          <p className="mt-1 text-sm">
            أُضيف {result.inserted} · حُدّث {result.updated} · تُرك دون تغيير {result.skipped} ·
            تعذر {result.failed}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            تُحدّث جاهزية هذه الخطوة الآن. راجع حالتها قبل الانتقال للخطوة التالية.
          </p>
        </Card>
      )}
      <Card className="p-4 space-y-4">
        <fieldset
          disabled={
            previewMut.isPending || commitMut.isPending || detectingFile || downloadingCurrent
          }
          className="space-y-4 min-w-0"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="import-entity">نوع البيانات</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                id="import-entity"
                value={entity}
                onChange={(e) => {
                  setEntity(e.target.value as ImportEntity);
                  reset();
                  onEntityChange?.(e.target.value as ImportEntity);
                }}
              >
                {Array.from(new Set(availableEntities.map((e) => e.group))).map((g) => (
                  <optgroup key={g} label={preparationLabel(g)}>
                    {availableEntities
                      .filter((e) => e.group === g)
                      .map((o) => (
                        <option key={o.value} value={o.value}>
                          {preparationLabel(o.label)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              {selectedMeta && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>{preparationLabel(selectedMeta.description)}</p>
                  {selectedMeta.dependsOn.length > 0 && (
                    <p>يلزم تجهيز: {preparationLabel(selectedMeta.dependsOn.join(" · "))}</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="import-mode">طريقة حفظ الصفوف</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                id="import-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as ImportMode)}
              >
                {MODES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {preparationLabel(o.label)} — {o.desc}
                  </option>
                ))}
              </select>
            </div>
            {entity === "teaching_assignments_v2" && (
              <div>
                <Label htmlFor="import-study-system">نظام الدراسة</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  id="import-study-system"
                  value={studySystemScope}
                  onChange={(e) => setStudySystemScope(e.target.value as SourceStudySystemScope)}
                >
                  {SOURCE_STUDY_SYSTEM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {preparationLabel(o.label)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={downloadTemplate}>
                <Download className="ml-2 h-4 w-4" /> تنزيل قالب للإضافة
              </Button>
            </div>
          </div>

          {entity === "instructors" && (
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <p className="text-sm">
                يمكنك رفع كشف المدرسين الكامل: اسم المدرس، القسم (التخصص)، النصاب الأسبوعي، الرتبة
                الأكاديمية، الصفة والحالة. تُقبل العناوين والصفوف التمهيدية في الكشف.
              </p>
              <p className="text-sm text-muted-foreground">
                لتحديث المدرسين الحاليين اختر «تحديث الموجود فقط». إذا لم يتضمن الكشف رقم الموظف،
                تُطابق الأسماء الفريدة داخل الكلية الحالية؛ عمود «م» تسلسلي فقط. البيانات التي لا
                توجد أعمدتها في الكشف تحتفظ بقيمها الحالية.
              </p>
              <p className="text-sm text-muted-foreground">
                القسم في الكشف هو التخصص. النصاب يُحفظ كما ورد دون تخفيض إضافي. حالتا الابتعاث
                والإجازة المرضية تعنيان أن المدرس غير نشط للجدولة، ويُحفظ السبب.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void downloadCurrentInstructors()}
                disabled={downloadingCurrent}
              >
                {downloadingCurrent ? "جارٍ تجهيز الكشف…" : "تنزيل كشف المدرسين الحالي"}
              </Button>
            </div>
          )}
          <div className="rounded-md border-2 border-dashed border-border p-6 text-center">
            <input
              id="xfile"
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                void onFileSelected(e.target.files?.[0] ?? null);
              }}
            />
            <label htmlFor="xfile" className="flex cursor-pointer flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="font-medium">
                {file ? file.name : "اختر ملف Excel المعبّأ (.xlsx)"}
              </span>
              <span className="text-xs text-muted-foreground">
                البيانات: {preparationLabel(tpl.label)} · التعرّف على الصف بواسطة:{" "}
                {tpl.uniqueKeyLabel}
                {workbookMode === "academic_source_workbook"
                  ? " · وضع: دفتر إسناد أكاديمي"
                  : workbookMode === "official_template"
                    ? " · وضع: القالب الرسمي"
                    : ""}
              </span>
            </label>
          </div>

          {entity === "teaching_assignments_v2" &&
            file &&
            workbookMode === "academic_source_workbook" &&
            !preview && (
              <SourceSheetTermPicker
                file={file}
                terms={collegeTerms}
                sheetTermMap={sheetTermMap}
                onChange={setSheetTermMap}
              />
            )}

          {programsBlocked && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="font-semibold text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> لا توجد أقسام في هذه الكلية
              </p>
              <p className="mt-1 text-muted-foreground">
                البرنامج يجب أن يتبع قسمًا من نفس الكلية. أضف الأقسام الأكاديمية أولًا (استيراد أو
                إدخال يدوي) ثم أعد رفع ملف البرامج.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => previewMut.mutate()}
              disabled={
                !file ||
                detectingFile ||
                programsBlocked ||
                previewMut.isPending ||
                commitMut.isPending ||
                (isSourceMode && !allSheetTermsSelected)
              }
            >
              {previewMut.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
              فحص الملف ومعاينة البيانات
            </Button>
            {file && (
              <Button variant="ghost" onClick={reset}>
                إلغاء
              </Button>
            )}
          </div>
        </fieldset>
      </Card>

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

          {(entity === "departments" || entity === "academic_programs") && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="صفوف جديدة"
                value={
                  mode === "update_existing"
                    ? 0
                    : preview.valid.filter((r) => !r.values._exists).length
                }
                tone="ok"
              />
              <Stat
                label="صفوف ستُحدّث"
                value={
                  mode === "insert_only" ? 0 : preview.valid.filter((r) => r.values._exists).length
                }
                tone="ok"
              />
              <Stat
                label="صفوف ستُترك دون تغيير"
                value={
                  preview.valid.filter((r) =>
                    mode === "insert_only" ? r.values._exists : !r.values._exists,
                  ).length * (mode === "upsert" ? 0 : 1)
                }
              />
            </div>
          )}


          {entity === "instructors" && preview.valid.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold">معاينة المدرسين قبل الحفظ</h3>
              <p className="text-sm text-muted-foreground">
                {preview.valid.filter((row) => row.values._matched_by_name).length} مدرس تمت مطابقة
                اسمه برقم الموظف الحالي. راجع الأرقام والتخصص والنصاب والحالة قبل التأكيد.
              </p>
              <div className="max-h-80 overflow-auto rounded border">
                <table className="w-full text-right text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {[
                        "صف Excel",
                        "اسم المدرس",
                        "رقم الموظف",
                        "القسم (التخصص)",
                        "النصاب",
                        "الرتبة",
                        "الصفة",
                        "الحالة",
                        "الإجراء",
                      ].map((label) => (
                        <th key={label} className="p-2 whitespace-nowrap">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.valid.map((row) => (
                      <tr key={row.rowNumber} className="border-t">
                        <td className="p-2">{row.rowNumber}</td>
                        {[
                          "full_name",
                          "employee_number",
                          "specialization",
                          "max_weekly_hours",
                          "academic_rank",
                          "admin_tasks",
                        ].map((key) => (
                          <td key={key} className="p-2">
                            {String(row.values[key] ?? "—")}
                          </td>
                        ))}
                        <td className="p-2">
                          {instructorStatusLabel(
                            row.values.is_active !== false,
                            row.values.notes as string | null,
                          )}
                        </td>
                        <td className="p-2">
                          {row.values._exists
                            ? mode === "insert_only"
                              ? "تجاهل (موجود)"
                              : "تحديث"
                            : mode === "update_existing"
                              ? "تجاهل (جديد)"
                              : "إضافة"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.sourceResolution && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="صفوف متجاهلة" value={preview.sourceResolution.totals.ignored} />
              <Stat
                label="صفوف تمت مطابقتها"
                value={preview.sourceResolution.totals.matched}
                tone="ok"
              />
              <Stat
                label="صفوف تحتاج تصحيحًا"
                value={preview.sourceResolution.totals.blocked}
                tone={preview.sourceResolution.totals.blocked ? "err" : "ok"}
              />
              <Stat
                label="توسيع الإسنادات"
                value={preview.sourceResolution.totals.expandedAssignments}
                tone="ok"
              />
              <Stat label="صفوف جاهزة" value={preview.sourceReadyRows ?? 0} tone="ok" />
              <Stat label="عمليات الحفظ" value={preview.canonicalOperations ?? 0} tone="ok" />
            </div>
          )}

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
                        <td className="p-2 text-destructive">{preparationLabel(e.message)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.sourceResolution && (
            <details className="space-y-1">
              <summary className="cursor-pointer font-semibold">تفاصيل توزيع ساعات الإسناد</summary>
              <div className="max-h-96 overflow-auto rounded border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs">
                    <tr>
                      <th className="p-2 text-right">الورقة</th>
                      <th className="p-2 text-right">الصف</th>
                      <th className="p-2 text-right">النظام</th>
                      <th className="p-2 text-right">المحاضرة</th>
                      <th className="p-2 text-right">إجمالي ساعات المحاضرة</th>
                      <th className="p-2 text-right">الساعات المسندة للمدرس</th>
                      <th className="p-2 text-right">عدد المدرسين المشتركين</th>
                      <th className="p-2 text-right">إجمالي الساعات الموزعة</th>
                      <th className="p-2 text-right">نتيجة الفحص</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sourceResolution.assignments.map((assignment, index) => (
                      <tr
                        key={`${assignment.sourceSheet}-${assignment.sourceRowNumber}-${assignment.studySystem}-${assignment.deliveryGroupCode ?? ""}-${index}`}
                        className="border-t border-border"
                      >
                        <td className="p-2">{assignment.sourceSheet}</td>
                        <td className="p-2">{assignment.sourceRowNumber}</td>
                        <td className="p-2">{assignment.studySystem || "—"}</td>
                        <td className="p-2">{assignment.componentType ?? "—"}</td>
                        <td className="p-2">{assignment.componentTotalHours ?? "—"}</td>
                        <td className="p-2">{assignment.assignedComponentHours ?? "—"}</td>
                        <td className="p-2">{assignment.coTeacherCount ?? "—"}</td>
                        <td className="p-2">{assignment.coTeachingGroupTotal ?? "—"}</td>
                        <td className="p-2">{assignment.validationStatus ?? assignment.outcome}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
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

          {preview.errors.length > 0 && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              توجد أخطاء في الملف. تأكيد الاستيراد يحفظ الصفوف الصالحة فقط؛ صحّح الصفوف الأخرى وأعد
              رفعها.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
            <Button variant="outline" onClick={reset} disabled={commitMut.isPending}>
              إلغاء
            </Button>
            <Button
              onClick={() => commitMut.mutate()}
              disabled={
                preview.valid.length === 0 ||
                commitMut.isPending ||
                preview.missingHeaders.length > 0 ||
                (preview.teachingHoursContractBlockers ?? 0) > 0
              }
            >
              {commitMut.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
              تأكيد استيراد الصفوف الصالحة ({preview.valid.length})
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function SourceSheetTermPicker({
  file,
  terms,
  sheetTermMap,
  onChange,
}: {
  file: File;
  terms: Array<{ id: string; code: string; name: string; term_type: string | null }>;
  sheetTermMap: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const wb = await parseSourceWorkbookFile(file);
      if (cancelled) return;
      const names = wb.sheets.map((s) => s.sheetName);
      setSheetNames(names);
      const next: Record<string, string> = { ...sheetTermMap };
      for (const n of names) {
        if (!next[n]) next[n] = "";
      }
      onChange(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialize term map once per file
  }, [file]);

  if (sheetNames.length === 0) return null;

  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <p className="text-sm font-medium">ربط كل ورقة بالفصل الأكاديمي (لا تخلط الفصول)</p>
      {sheetNames.map((name) => (
        <div key={name} className="grid gap-2 md:grid-cols-2 items-center">
          <span className="text-sm text-muted-foreground">{name}</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={sheetTermMap[name] ?? ""}
            onChange={(e) => onChange({ ...sheetTermMap, [name]: e.target.value })}
          >
            <option value="">— اختر الفصل —</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.term_type ? ` (${t.term_type})` : ""}
              </option>
            ))}
          </select>
        </div>
      ))}
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
