import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { commitHeadcountImport, getHeadcountImportContext } from "@/lib/scheduling-headcount/api";
import { COUNT_COLUMNS, previewHeadcounts, type HeadcountPreview, type ImportCohort } from "@/lib/scheduling-headcount/import";
import { downloadHeadcountWorkbook, readHeadcountWorkbook } from "@/lib/scheduling-headcount/import-workbook";

export function HeadcountImportWorkspace({ onCommitted }: { onCommitted?: () => void }) {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  if (!active || !canManage) return null;
  return <HeadcountImportForm key={active.id} collegeId={active.id} onCommitted={onCommitted} />;
}

function HeadcountImportForm({ collegeId, onCommitted }: { collegeId: string; onCommitted?: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sameCounts, setSameCounts] = useState(false);
  const [allowOverEligible, setAllowOverEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<HeadcountPreview | null>(null);
  const [cohorts, setCohorts] = useState<ImportCohort[]>([]);
  const [sheetInfo, setSheetInfo] = useState("");
  const [stage, setStage] = useState<"preview" | "saved" | "approved">("preview");
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  const alive = useRef(true), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reset = () => { setPreview(null); setStage("preview"); setApprovalConfirmed(false); setSheetInfo(""); };
  const run = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true);
    try { await task(); } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : "تعذر تنفيذ العملية.");
    } finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const download = (populated: boolean) => run(async () => {
    const context = populated ? await getHeadcountImportContext(collegeId) : [];
    if (alive.current) await downloadHeadcountWorkbook(context, populated);
  });
  const inspect = () => run(async () => {
    if (!file) return;
    reset();
    const book = await readHeadcountWorkbook(file);
    const context = await getHeadcountImportContext(collegeId);
    if (!alive.current) return;
    setCohorts(context);
    setSheetInfo(`ورقة البيانات: ${book.name}${book.ignored.length ? ` · الأوراق الأخرى غير مستوردة: ${book.ignored.join("، ")}` : ""}`);
    setPreview(previewHeadcounts(book.matrix, context, { sameCounts, allowOverEligible, source: file.name }));
  });
  const commit = (action: "save" | "approve") => run(async () => {
    if (!preview?.rows.length || preview.errors.length || (action === "approve" && (stage !== "saved" || !approvalConfirmed))) return;
    try {
      const result = await commitHeadcountImport(collegeId, preview.rows, action);
      // Refresh both the numbers page and every readiness query scoped to this college.
      void qc.invalidateQueries({ predicate: (query) => query.queryKey.some((part) => part === collegeId) });
      if (!alive.current) return;
      setPreview({ ...preview, rows: preview.rows.map((row) => {
        const saved = result.rows.find((r) => r.cohort_id === row.cohort_id && r.term_id === row.term_id);
        if (!saved) throw new Error("تعذر مطابقة نتيجة الحفظ؛ أعد المعاينة.");
        return { ...row, expected_version: saved.expected_version };
      }) });
      setStage(action === "save" ? "saved" : "approved");
      setApprovalConfirmed(false);
      onCommitted?.();
      toast.success(action === "save" ? `تم حفظ الملف؛ ${result.changed} صف تغير. راجع الأعداد ثم اعتمدها.` : `تم الاعتماد؛ ${result.changed} صف اعتمد الآن.`);
    } catch (error) {
      // A timeout may follow a committed transaction. Require a fresh snapshot
      // before retrying, so a second click never overwrites newer work.
      if (alive.current) reset();
      throw error;
    }
  });
  return <Card className="space-y-4 p-4" dir="rtl" aria-label="استيراد أعداد الطلاب للجدولة">
    <div>
      <h3 className="font-bold">استيراد أعداد الطلاب للجدولة</h3>
      <p className="mt-1 text-sm text-muted-foreground">ارفع الأعداد، راجع كل فئة، ثم احفظ واعتمد الدفعات جماعيًا. يجب أن تكون الدفعات والفصول مسجلة مسبقًا.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void download(false)}>تنزيل القالب التفصيلي</Button>
      <Button variant="outline" disabled={busy} onClick={() => void download(true)}>تنزيل دفعات الكلية وأعدادها الحالية</Button>
    </div>
    <fieldset disabled={busy} className="space-y-3">
      <label className="block space-y-2 text-sm">
        <span>ملف أعداد الطلاب (XLSX)</span>
        <input type="file" accept=".xlsx" className="block w-full rounded border p-2" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={sameCounts} onChange={(e) => { setSameCounts(e.target.checked); reset(); }} />
        <span>لملف الدفعات السابق: أؤكد أن الطلاب المتوقعين = المسجلين = المؤهلين = الحضور = عدد الجدولة = المؤهلين للاختبار، وهامش الاحتياط صفر.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={allowOverEligible} onChange={(e) => { setAllowOverEligible(e.target.checked); reset(); }} />
        <span>السماح بتجاوز عدد المؤهلين عند وجود سبب مكتوب في ملاحظات كل صف متأثر.</span>
      </label>
    </fieldset>
    <Button disabled={!file || busy} onClick={() => void inspect()}>{busy ? "جارٍ التنفيذ…" : "فحص الملف ومعاينة الأعداد"}</Button>
    {preview && <div className="space-y-3" aria-live="polite">
      <p className="text-sm text-muted-foreground">{sheetInfo}</p>
      <p className="text-sm">الصفوف: {preview.total} · الصالحة: {preview.rows.length} · الأخطاء: {preview.errors.length} · مجموع أعداد الجدولة الصالحة: {preview.rows.reduce((sum, r) => sum + r.scheduling_headcount, 0)}</p>
      {preview.errors.length > 0 && <div className="max-h-64 overflow-auto rounded border border-destructive p-3 text-sm text-destructive">
        <p className="mb-2 font-semibold">صحح جميع الأخطاء ثم أعد الفحص. لم يُحفظ أي صف.</p>
        {preview.errors.map((e, i) => <p key={i}>الصف {e.row} · {e.column}: {e.message}</p>)}
      </div>}
      {preview.rows.length > 0 && <div className="max-h-96 overflow-auto rounded border">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-0 bg-muted"><tr>{["الصف", "الدفعة", "الفصل", "البرنامج / المستوى / النظام", ...COUNT_COLUMNS.map((c) => c[1].replaceAll("_", " ")), "المصدر", "ملاحظات"].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
          <tbody>{preview.rows.map((row) => {
            const c = cohorts.find((item) => item.id === row.cohort_id);
            return <tr className="border-t" key={row.row}>
              <td className="p-2">{row.row}</td><td className="p-2">{c?.code}</td><td className="p-2">{c?.term_code}</td>
              <td className="p-2">{c?.program_name} / {c?.level_number} / {c?.study_system}</td>
              {COUNT_COLUMNS.map(([key]) => <td key={key} className="p-2">{row[key]}</td>)}
              <td className="p-2">{row.source}</td><td className="p-2">{row.notes ?? "—"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      {!preview.errors.length && preview.rows.length > 0 && stage === "preview" && <div className="space-y-2">
        <p className="text-sm text-muted-foreground">تغيير أعداد معتمدة يعيدها إلى مسودة. الأعداد المطابقة تمامًا تحتفظ باعتمادها.</p>
        <Button disabled={busy} onClick={() => void commit("save")}>حفظ الأعداد كمسودات ({preview.rows.length})</Button>
      </div>}
      {stage === "saved" && <div className="space-y-3 rounded border p-3">
        <p className="text-sm">تم الحفظ. اعتماد الأعداد يجعلها مرجع تقسيم مجموعات التدريس والجدولة.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={approvalConfirmed} onChange={(e) => setApprovalConfirmed(e.target.checked)} />راجعت جميع الأعداد الظاهرة وأوافق على اعتمادها للجدولة.</label>
        <Button disabled={busy || !approvalConfirmed} onClick={() => void commit("approve")}>اعتماد الأعداد جماعيًا ({preview.rows.length})</Button>
      </div>}
      {stage === "approved" && <p className="font-semibold text-emerald-700">تم اعتماد جميع صفوف هذا الملف للجدولة. جرى تحديث فحص جاهزية الكلية.</p>}
    </div>}
  </Card>;
}
