import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  previewSourceRows,
  type SourceImportInput,
} from "@/lib/existing-schedules/source-row-import";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ExistingRow = Parameters<typeof previewSourceRows>[1][number];

export function SourceRowsImport({
  collegeId,
  termId,
  versionId,
  existing,
  onSaved,
}: {
  collegeId: string;
  termId: string;
  versionId: string | null;
  existing: readonly ExistingRow[];
  onSaved: () => Promise<unknown>;
}) {
  const [preview, setPreview] = useState<ReturnType<
    typeof previewSourceRows
  > | null>(null);
  const [loading, setLoading] = useState(false);

  async function selectFile(file: File | undefined) {
    setPreview(null);
    if (!file) return;
    try {
      let matrix: Record<string, unknown>[];
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed: unknown = JSON.parse(await file.text());
        if (
          !Array.isArray(parsed) ||
          !parsed.every(
            (row) => row && typeof row === "object" && !Array.isArray(row),
          )
        )
          throw new Error("ملف JSON يجب أن يحتوي قائمة صفوف المصدر");
        matrix = parsed as Record<string, unknown>[];
      } else {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error("الملف لا يحتوي ورقة بيانات");
        matrix = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
        });
      }
      setPreview(previewSourceRows(matrix, existing));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function save() {
    if (!preview || preview.errors.length || !preview.rows.length || !versionId)
      return;
    setLoading(true);
    try {
      // Recheck stable identities immediately before inserting. A second editor
      // can add rows while this preview is open; never overwrite their work.
      const { data: current, error: readError } = await supabase
        .from("existing_schedule_source_rows")
        .select("source_id")
        .eq("college_id", collegeId)
        .eq("term_id", termId)
        .in(
          "source_id",
          preview.rows.map((row) => row.source_id),
        );
      if (readError) throw readError;
      if (current?.length)
        throw new Error("تغير المصدر بعد المعاينة؛ حدّث الصفحة وأعد المطابقة");
      for (let i = 0; i < preview.rows.length; i += 50) {
        const batch = preview.rows
          .slice(i, i + 50)
          .map((row: SourceImportInput) => {
            const { program: _program, ...source } = row;
            return {
              ...source,
              college_id: collegeId,
              term_id: termId,
              schedule_version_id: versionId,
              status: "pending",
            };
          });
        const { error } = await supabase
          .from("existing_schedule_source_rows")
          .insert(batch);
        if (error) throw error;
      }
      await onSaved();
      toast.success(`حُفظت ${preview.rows.length} من صفوف المصدر في المسودة`);
      setPreview(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      // A partial batch may have been committed; force a fresh preview.
      await onSaved();
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="space-y-3 p-4" aria-label="استيراد صفوف المصدر">
      <h3 className="font-semibold">استكمال صفوف ملفات الأقسام</h3>
      <p className="text-sm text-muted-foreground">
        استورد صفوف المواعيد من ملف JSON أو Excel أو CSV موثّق. يلزم الأعمدة:
        source_id, source_file, source_cell, program, level_number, raw_course,
        raw_teacher, raw_day, raw_time, raw_room, day_of_week, start_time,
        end_time. ترتيب الأيام: الأحد 0 إلى السبت 6. تُحفظ بيانات المصدر أولًا؛
        لا تُنشأ مقررات أو مجموعات أو جلسات تلقائيًا.
      </p>
      <input
        type="file"
        accept=".json,.xlsx,.xls,.csv"
        aria-label="ملف صفوف مواعيد الكلية"
        onChange={(event) => void selectFile(event.target.files?.[0])}
      />
      {preview && (
        <div className="space-y-2 text-sm" role="status">
          <p>
            جديد: {preview.rows.length} · موجود مطابق: {preview.skipped} ·
            أخطاء:
            {preview.errors.length}
          </p>
          {preview.errors.length > 0 && (
            <ul className="list-disc space-y-1 pr-5 text-destructive">
              {preview.errors.slice(0, 20).map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          <Button
            disabled={
              loading ||
              !versionId ||
              preview.errors.length > 0 ||
              preview.rows.length === 0
            }
            onClick={() => void save()}
          >
            {loading ? "جارٍ الحفظ…" : `حفظ ${preview.rows.length} صف مصدر`}
          </Button>
        </div>
      )}
    </Card>
  );
}
