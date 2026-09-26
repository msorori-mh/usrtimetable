import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CollegeSourceTimetable } from "@/components/data-onboarding/college-source-timetable";
import { ReportShell } from "@/components/reports/report-shell";
import { useActiveCollege } from "@/hooks/use-colleges";
import { supabase } from "@/integrations/supabase/client";
import { EDUCATION_SOURCE_PUBLICATION_NOTICE_AR } from "@/lib/schedule-versions/education-publication";
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";

const COLLEGE_ID = "1ee291b2-bec9-43d3-b42b-5a4f46946399";
const TERM_ID = "93705393-609d-4605-ae94-9572cd8b2090";
const VERSION_ID = "7430bad7-2de7-5c90-9368-b214a199d6c3";

export const Route = createFileRoute("/_authenticated/reports/education-source-timetable")({
  head: () => ({ meta: [{ title: "جدول كلية التربية والعلوم من ملفات الأقسام" }] }),
  component: Page,
});

function Page() {
  const { active } = useActiveCollege();
  const navigate = useNavigate();
  const allowed = active?.id === COLLEGE_ID;
  const source = useQuery({
    queryKey: ["education-source-timetable", COLLEGE_ID, TERM_ID, VERSION_ID],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("existing_schedule_source_rows")
        .select("*")
        .eq("college_id", COLLEGE_ID)
        .eq("term_id", TERM_ID)
        .eq("schedule_version_id", VERSION_ID)
        .order("source_id");
      if (error) throw error;
      return data ?? [];
    },
  });
  const version = useQuery({
    queryKey: ["education-source-timetable-version", VERSION_ID],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("status")
        .eq("id", VERSION_ID)
        .eq("college_id", COLLEGE_ID)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const published = version.data?.status === "published";
  const versionStatus: SVStatus =
    (["draft", "review", "approved", "published", "archived"] as const).find(
      (status) => status === version.data?.status,
    ) ?? "draft";

  return (
    <ReportShell
      title="جدول كلية التربية والعلوم من ملفات الأقسام"
      description="صفوف الأقسام العشرة للفصل الأول 2026–2027، مع حالة ربط كل صف بالجدول التشغيلي."
      headerMeta={{
        versionStatus,
        termName: "الفصل الأول 2026–2027",
      }}
      rows={(source.data ?? []).map((row) => ({
        source_id: row.source_id,
        source_file: row.source_file,
        level_number: row.level_number,
        raw_course: row.raw_course,
        raw_teacher: row.raw_teacher,
        raw_day: row.raw_day,
        start_time: row.start_time,
        end_time: row.end_time,
        raw_room: row.raw_room,
        status: row.schedule_session_id
          ? row.pending_reasons.length > 0
            ? published
              ? "جلسة منشورة استثنائياً؛ الاسم أو الإسناد بحاجة تحقق"
              : "جلسة مؤقتة؛ الاسم أو الإسناد بحاجة تحقق"
            : published
              ? "جلسة في الجدول المنشور"
              : "جلسة في المسودة"
          : row.delivery_group_id
            ? "مجموعة منشأة؛ موعد قيد المطابقة"
            : "بانتظار الربط",
      }))}
      headers={[
        { key: "source_id", label: "معرّف الصف" },
        { key: "source_file", label: "ملف القسم" },
        { key: "level_number", label: "المستوى في الملف" },
        { key: "raw_course", label: "المقرر" },
        { key: "raw_teacher", label: "المدرس" },
        { key: "raw_day", label: "اليوم" },
        { key: "start_time", label: "من" },
        { key: "end_time", label: "إلى" },
        { key: "raw_room", label: "القاعة" },
        { key: "status", label: "حالة الربط" },
      ]}
      filename="education_2026_2027_first_term_source_timetable"
      notReadyMessage={
        allowed ? undefined : "اختر كلية التربية والعلوم من محدد الكلية لعرض جدول هذا الفصل."
      }
      isLoading={allowed && (source.isLoading || version.isLoading)}
      error={source.error ?? version.error}
      onRetry={() => {
        void source.refetch();
        void version.refetch();
      }}
      emptyMessage="لا توجد صفوف مصدر مستوردة لهذا الفصل."
    >
      {published && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {EDUCATION_SOURCE_PUBLICATION_NOTICE_AR}
        </p>
      )}
      <CollegeSourceTimetable
        rows={source.data ?? []}
        published={published}
        onBack={() => void navigate({ to: "/data-onboarding" })}
      />
    </ReportShell>
  );
}
