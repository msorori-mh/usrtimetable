import type { FacultyHome } from "@/lib/instructors/faculty-workflow";

type HomeAffiliation = Pick<FacultyHome, "home_college_id" | "home_college" | "home_department">;

export function InstructorHomeAffiliation({
  home,
  currentCollegeId,
  defaultCategoryLabel,
  isLoading = false,
  isError = false,
}: {
  home?: HomeAffiliation;
  currentCollegeId: string;
  defaultCategoryLabel: string;
  isLoading?: boolean;
  isError?: boolean;
}) {
  if (isLoading) {
    return <p className="text-xs text-muted-foreground">جارٍ تحميل التبعية الأصلية...</p>;
  }
  if (isError) {
    return <p className="text-xs text-destructive">تعذر تحميل التبعية الأصلية.</p>;
  }
  if (!home?.home_college_id) {
    return <p className="text-xs text-amber-800">التبعية الأصلية بحاجة إلى مراجعة.</p>;
  }
  const fromOtherCollege = home.home_college_id !== currentCollegeId;

  return (
    <div className="mt-1 space-y-1 text-xs">
      <p>
        الكلية الأصلية: <span className="font-medium">{home.home_college ?? "غير محددة"}</span>
      </p>
      <p>القسم الأصلي: {home.home_department ?? "غير محدد — يحتاج استكمالًا"}</p>
      <p className={fromOtherCollege ? "font-medium text-primary" : "text-muted-foreground"}>
        فئة المحاضر في الكلية الحالية:{" "}
        {fromOtherCollege ? "محاضر من كلية أخرى" : defaultCategoryLabel}
      </p>
    </div>
  );
}
