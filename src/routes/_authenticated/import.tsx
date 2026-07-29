import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
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
import {
  listImportUiEntities,
  suggestedTemplateFilename,
  OFFICIAL_IMPORT_ORDER,
} from "@/lib/excel-import/registry";
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

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "استيراد البيانات من Excel" },
      {
        name: "description",
        content: "تنزيل القوالب الرسمية ورفع ملفات Excel وتحليلها ثم تأكيد الاستيراد.",
      },
    ],
  }),
  component: ImportPage,
});

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

function ImportPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [entity, setEntity] = useState<ImportEntity>("academic_terms");
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

  const previewMut = useMutation({
    mutationFn: async () => {
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
      if (r.replay) {
        toast.success(
          `إعادة تشغيل آمنة: ${r.inserted} إدراج، ${r.updated} تحديث، ${r.skipped} تجاهل`,
        );
      } else {
        toast.success(
          `تم: ${r.inserted} إدراج، ${r.updated} تحديث، ${r.skipped} تجاهل، ${r.failed} فشل`,
        );
      }
      setFile(null);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["import-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reset = () => {
    setFile(null);
    setPreview(null);
    setWorkbookMode(null);
    setSheetTermMap({});
  };

  const onFileSelected = async (next: File | null) => {
    setFile(next);
    setPreview(null);
    setSheetTermMap({});
    if (next && entity === "teaching_assignments_v2") {
      try {
        const detected = await detectWorkbookMode(next);
        setWorkbookMode(detected);
      } catch {
        setWorkbookMode(null);
      }
    } else {
      setWorkbookMode(null);
    }
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
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <FileSpreadsheet className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">استيراد البيانات من Excel</h1>
          <p className="text-sm text-muted-foreground">
            تنزيل القوالب الرسمية ورفع ملفات Excel وتحليلها ثم تأكيد الاستيراد.{" "}
            <Link to="/data-templates" className="text-primary underline-offset-4 hover:underline">
              دليل تجهيز البيانات ←
            </Link>
          </p>
        </div>
        <CollegeSwitcher />
      </header>

      <Card className="p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">ترتيب الاستيراد الرسمي (مختصر)</p>
        <ol className="list-decimal list-inside space-y-0.5">
          {OFFICIAL_IMPORT_ORDER.filter((s) => s.kind === "import")
            .slice(0, 8)
            .map((s) => (
              <li key={s.step}>
                {s.label}
                {s.notes ? ` — ${s.notes}` : ""}
              </li>
            ))}
        </ol>
        <p>
          delivery_groups و course_offerings في المسار الجديد مولَّدة من النظام — ليست قوالب
          تشغيلية. نماذج Legacy (sections / V1) مخفية هنا.
        </p>
      </Card>

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
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <p>{selectedMeta.description}</p>
                {selectedMeta.dependsOn.length > 0 && (
                  <p>الاعتماديات: {selectedMeta.dependsOn.join(" · ")}</p>
                )}
              </div>
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
          {entity === "teaching_assignments_v2" && (
            <div>
              <Label>نظام الدراسة (دفتر الإسناد الأكاديمي)</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={studySystemScope}
                onChange={(e) => setStudySystemScope(e.target.value as SourceStudySystemScope)}
              >
                {SOURCE_STUDY_SYSTEM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={downloadTemplate}>
              <Download className="ml-2 h-4 w-4" /> تنزيل قالب Excel
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
              void onFileSelected(e.target.files?.[0] ?? null);
            }}
          />
          <label htmlFor="xfile" className="flex cursor-pointer flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <span className="font-medium">{file ? file.name : "اختر ملف .xlsx أو اسحبه هنا"}</span>
            <span className="text-xs text-muted-foreground">
              الكيان: {tpl.label} · المفتاح الفريد: {tpl.uniqueKeyLabel}
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

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => previewMut.mutate()}
            disabled={!file || previewMut.isPending || (isSourceMode && !allSheetTermsSelected)}
          >
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

          {preview.sourceResolution && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="مصدر — متجاهل" value={preview.sourceResolution.totals.ignored} />
              <Stat
                label="مصدر — matched"
                value={preview.sourceResolution.totals.matched}
                tone="ok"
              />
              <Stat
                label="مصدر — BLOCKED"
                value={preview.sourceResolution.totals.blocked}
                tone={preview.sourceResolution.totals.blocked ? "err" : "ok"}
              />
              <Stat
                label="توسيع الإسنادات"
                value={preview.sourceResolution.totals.expandedAssignments}
                tone="ok"
              />
              <Stat label="صفوف المصدر READY" value={preview.sourceReadyRows ?? 0} tone="ok" />
              <Stat
                label="عمليات الاستيراد canonical"
                value={preview.canonicalOperations ?? 0}
                tone="ok"
              />
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
              disabled={
                preview.valid.length === 0 ||
                commitMut.isPending ||
                preview.missingHeaders.length > 0 ||
                (preview.teachingHoursContractBlockers ?? 0) > 0
              }
            >
              {commitMut.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}
              تأكيد الاستيراد ({preview.valid.length} عملية canonical)
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
                {t.code} — {t.name}
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
