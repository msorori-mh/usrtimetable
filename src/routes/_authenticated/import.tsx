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
import {
  listImportUiEntities,
  suggestedTemplateFilename,
  OFFICIAL_IMPORT_ORDER,
} from "@/lib/excel-import/registry";
import type { ImportEntity, ImportMode, ParsedRow, RowError } from "@/lib/excel-import/types";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "استيراد البيانات من Excel" }, { name: "description", content: "تنزيل القوالب الرسمية ورفع ملفات Excel وتحليلها ثم تأكيد الاستيراد." }] }),
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
  const [preview, setPreview] = useState<{
    valid: ParsedRow[];
    invalid: ParsedRow[];
    errors: RowError[];
    jobId: string | null;
    total: number;
    missingHeaders: string[];
  } | null>(null);

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
            مسار التشغيل الجديد فقط — بدون نماذج الشعب أو التسجيل الفردي. Commit عبر RPC ذري.{" "}
            <Link to="/data-templates" className="text-primary underline-offset-4 hover:underline">
              مركز القوالب ←
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
