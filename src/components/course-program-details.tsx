import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { hoursConflict, type ProgramPlanLink } from "@/lib/course-program-plans";

export function useCourseProgramPlans(collegeId?: string) {
  return useQuery({
    queryKey: ["course-program-plans", collegeId],
    enabled: !!collegeId,
    queryFn: async () => {
      const rows: ProgramPlanLink[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from("plan_courses")
          .select(
            "id, course_id, semester, study_plans!inner(name, program_id, is_active, academic_programs(name)), academic_levels(level_number), plan_course_components(component_type, weekly_contact_hours)",
          )
          .eq("college_id", collegeId!)
          .eq("study_plans.is_active", true)
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        const page = data as unknown as ProgramPlanLink[];
        rows.push(...page);
        if (page.length < 500) return rows;
      }
    },
  });
}

const labels: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تدريب",
  project: "مشروع",
  summer_training: "تدريب صيفي",
};

export function CourseProgramDetails({
  rows,
  loading,
  error,
  retry,
}: {
  rows: ProgramPlanLink[];
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  return (
    <section aria-label="البرامج التي تدرس المقرر" className="space-y-2">
      <p className="font-medium">البرامج التي تدرس المقرر</p>
      <p className="text-sm text-muted-foreground">
        مستخرجة من الخطط النشطة المسجلة. لإضافة برنامج أو إزالته عدّل المقرر في خطته الدراسية.
      </p>
      {loading ? (
        <p>جارٍ تحميل البرامج...</p>
      ) : error ? (
        <p role="alert">
          تعذر تحميل البرامج.{" "}
          <Button variant="outline" onClick={retry}>
            إعادة المحاولة
          </Button>
        </p>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded border p-2">
          {!rows.length && <p>لا توجد خطة نشطة مرتبطة بهذا المقرر.</p>}
          {rows.map((r) => (
            <div key={r.id} className="rounded bg-secondary/40 p-2 text-sm">
              <p className="font-semibold">
                {r.study_plans?.academic_programs?.name ?? "برنامج غير متاح"}
              </p>
              <p>
                {r.study_plans?.name} — المستوى {r.academic_levels?.level_number ?? "غير محدد"}،
                الفصل {r.semester}
              </p>
              <p>
                {r.plan_course_components.length
                  ? r.plan_course_components
                      .map(
                        (c) =>
                          `${labels[c.component_type] ?? c.component_type}: ${c.weekly_contact_hours}`,
                      )
                      .join("، ")
                  : "الساعات غير محددة في مكونات الخطة؛ تحتاج مراجعة"}
              </p>
            </div>
          ))}
        </div>
      )}
      {!error && !loading && hoursConflict(rows) && (
        <p role="alert" className="text-sm text-destructive">
          تختلف ساعات المقرر بين الخطط؛ راجعها قبل اعتماد الدمج.
        </p>
      )}
      <p className="text-sm">
        اشتراك البرامج في المقرر لا يسمح تلقائيًا بدمج المحاضرات؛ يلزم توافق الفصل والساعات والسعة.
      </p>
      <a href="/study-plans" className="text-sm text-primary underline">
        فتح الخطط الدراسية لتعديل البرامج المرتبطة
      </a>
    </section>
  );
}
