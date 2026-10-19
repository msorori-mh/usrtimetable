import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { History, ChevronRight } from "lucide-react";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import { formatDateTime, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/import-history")({
  head: () => ({ meta: [{ title: "سجل الاستيراد" }] }),
  component: HistoryPage,
});

interface Job {
  id: string;
  target_entity: string;
  mode: string;
  status: string;
  file_name: string | null;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  inserted_rows: number;
  updated_rows: number;
  skipped_rows: number;
  created_at: string;
}
interface Err {
  id: string;
  row_number: number;
  column_name: string | null;
  error_code: string;
  message: string;
}

const ENTITY_LBL: Record<string, string> = {
  instructors: "المحاضرون",
  rooms: "القاعات والمعامل",
  academic_terms: "الفصول الأكاديمية",
  daily_breaks: "الاستراحات اليومية",
  sections: "المجموعات الدراسية",
  time_slot_templates: "قوالب أوقات المحاضرات",
};
const STATUS_LBL: Record<string, string> = {
  preview: "معاينة",
  committed: "مكتمل",
  failed: "فشل",
  cancelled: "ملغى",
};
const MODE_LBL: Record<string, string> = {
  insert_only: "إدراج فقط",
  update_existing: "تحديث فقط",
  upsert: "إدراج + تحديث",
};

function HistoryPage() {
  const { active } = useActiveCollege();
  const [openJob, setOpenJob] = useState<string | null>(null);

  const {
    data: jobs,
    isLoading,
    isError,
    error: jobsError,
    refetch,
  } = useQuery({
    queryKey: ["import-jobs", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("college_id", active!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Job[];
    },
  });

  const {
    data: errors,
    isLoading: errorsLoading,
    isError: errorsFailed,
    error: errorsError,
    refetch: refetchErrors,
  } = useQuery({
    queryKey: ["import-errors", openJob],
    enabled: !!openJob,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_errors")
        .select("id, row_number, column_name, error_code, message")
        .eq("job_id", openJob!)
        .order("row_number")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Err[];
    },
  });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <History className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">سجل الاستيراد</h1>
          <p className="text-sm text-muted-foreground">آخر 100 عملية استيراد لهذه الكلّية.</p>
        </div>
        <Link to="/import">
          <Button variant="outline">استيراد جديد</Button>
        </Link>
      </header>

      <div className="mb-3">
        <CollegeSwitcher />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : isError ? (
          <div className="p-4">
            <QueryErrorNotice error={jobsError} onRetry={() => void refetch()} />
          </div>
        ) : !jobs || jobs.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد عمليات بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  aria-expanded={openJob === j.id}
                  className="flex w-full items-center justify-between p-4 text-start hover:bg-muted/50"
                  onClick={() => setOpenJob(openJob === j.id ? null : j.id)}
                >
                  <div className="flex-1">
                    <p className="font-semibold">
                      {ENTITY_LBL[j.target_entity] ?? j.target_entity}{" "}
                      <span
                        className={`ms-2 rounded px-2 py-0.5 text-[11px] ${j.status === "committed" ? "bg-emerald-500/15 text-emerald-700" : j.status === "failed" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}
                      >
                        {STATUS_LBL[j.status]}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {j.file_name ?? "—"} · {MODE_LBL[j.mode]} · {formatDateTime(j.created_at)}
                    </p>
                    <p className="mt-1 text-xs">
                      إجمالي: {formatNumber(j.total_rows)} · صالحة: {formatNumber(j.valid_rows)} ·
                      خاطئة: {formatNumber(j.invalid_rows)} · أُدرج: {formatNumber(j.inserted_rows)}{" "}
                      · حُدث: {formatNumber(j.updated_rows)} · تُجوهل:{" "}
                      {formatNumber(j.skipped_rows)}
                    </p>
                  </div>
                  <ChevronRight
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${openJob === j.id ? "rotate-90" : ""}`}
                  />
                </button>
                {openJob === j.id && (
                  <div className="border-t border-border bg-muted/30 p-4">
                    <h4 className="mb-2 text-sm font-semibold">
                      الأخطاء ({formatNumber(errors?.length ?? 0)}
                      {errors && errors.length >= 500 ? " — تُعرض أول 500 فقط" : ""})
                    </h4>
                    {errorsLoading ? (
                      <p className="text-xs text-muted-foreground">جارٍ التحميل...</p>
                    ) : errorsFailed ? (
                      <QueryErrorNotice
                        title="تعذّر تحميل أخطاء العملية."
                        error={errorsError}
                        onRetry={() => void refetchErrors()}
                      />
                    ) : !errors || errors.length === 0 ? (
                      <p className="text-xs text-muted-foreground">لا توجد أخطاء مسجّلة.</p>
                    ) : (
                      <div className="max-h-60 overflow-auto rounded border border-border bg-background">
                        <table className="w-full text-xs">
                          <thead className="bg-muted">
                            <tr>
                              <th className="p-2 text-start">الصف</th>
                              <th className="p-2 text-start">العمود</th>
                              <th className="p-2 text-start">الكود</th>
                              <th className="p-2 text-start">الرسالة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {errors.map((e) => (
                              <tr key={e.id} className="border-t border-border">
                                <td className="p-2">{e.row_number}</td>
                                <td className="p-2">{e.column_name ?? "—"}</td>
                                <td className="p-2">
                                  <span dir="ltr">{e.error_code}</span>
                                </td>
                                <td className="p-2 text-destructive">{e.message}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
