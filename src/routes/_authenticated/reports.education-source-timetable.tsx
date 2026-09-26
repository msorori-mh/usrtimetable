import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CollegeSourceTimetable } from "@/components/data-onboarding/college-source-timetable";
import { Card } from "@/components/ui/card";
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

  if (!allowed) {
    return (
      <Card className="p-5" dir="rtl">
        اختر كلية التربية والعلوم من محدد الكلية لعرض جدول الفصل الأول 2026–2027.
      </Card>
    );
  }
  if (source.isLoading)
    return (
      <Card className="p-5" dir="rtl">
        جارٍ تحميل جداول الأقسام…
      </Card>
    );
  if (source.error) {
    return (
      <Card className="p-5" dir="rtl" role="alert">
        تعذر تحميل جداول الأقسام: {source.error.message}
      </Card>
    );
  }
  return (
    <div className="mx-auto max-w-6xl" dir="rtl">
      <CollegeSourceTimetable
        rows={source.data ?? []}
        onBack={() => void navigate({ to: "/data-onboarding" })}
      />
    </div>
  );
}
