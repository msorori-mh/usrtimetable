import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CollegeSourceTimetable } from "@/components/data-onboarding/college-source-timetable";
import { ReportShell } from "@/components/reports/report-shell";
import { useActiveCollege } from "@/hooks/use-colleges";
import { supabase } from "@/integrations/supabase/client";

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

  return (
    <ReportShell
      title="جدول كلية التربية والعلوم من ملفات الأقسام"
      description="صفوف الأقسام العشرة للفصل الأول 2026–2027، مع حالة ربط كل صف بالمسودة التشغيلية."
      headerMeta={{ versionStatus: "draft", termName: "الفصل الأول 2026–2027" }}
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
        status: row.schedule_session_id ? "جلسة في المسودة" : "بانتظار الربط",
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
      isLoading={allowed && source.isLoading}
      error={source.error}
      onRetry={() => void source.refetch()}
      emptyMessage="لا توجد صفوف مصدر مستوردة لهذا الفصل."
    >
      <CollegeSourceTimetable
        rows={source.data ?? []}
        onBack={() => void navigate({ to: "/data-onboarding" })}
      />
    </ReportShell>
  );
}
