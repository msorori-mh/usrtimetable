/** Shared Arabic explanations for both preparation actions and inline errors. */
const messages: Record<string, string> = {
  STUDY_PLAN_MISSING_FOR_COHORT_PROGRAM: "لا توجد خطة نشطة لهذا البرنامج. أضف خطة البرنامج أولًا.",
  STUDY_PLAN_MISSING_FOR_COHORT_LEVEL_TERM:
    "لا توجد خطة تحتوي مقررات لهذا المستوى والفصل. راجع ربط مقررات الخطة بالمستوى والفصل.",
  STUDY_PLAN_AMBIGUOUS_FOR_COHORT_LEVEL_TERM:
    "توجد أكثر من خطة نشطة لهذا المستوى والفصل. حدّد الخطة المعتمدة قبل التوليد.",
  COHORT_CURRICULUM_EMPTY:
    "لم تُوجد مقررات قابلة للتوليد لهذه الدفعة. راجع الخطة واختيارات المقررات الاختيارية.",
  COHORT_TIMETABLED_COMPONENTS_EMPTY:
    "لا توجد محاضرات أو معامل مجدولة ضمن مقررات الدفعة. راجع محاضرات المقررات وساعاتها.",
  COHORT_EXISTING_PLAN_CONFLICT:
    "توجد مقررات مطروحة للدفعة مرتبطة بخطة مختلفة. راجعها قبل إعادة التوليد.",
  ELECTIVE_DECISION_NOT_APPROVED: "يلزم اعتماد اختيارات المقررات الاختيارية لهذه الدفعة.",
  ELECTIVE_PLAN_COURSE_MISSING:
    "المقرر الاختياري المحدد غير مربوط بالخطة والمستوى والفصل. أكمل بياناته أولًا.",
  SCHEDULING_HEADCOUNT_MISSING: "يلزم اعتماد عدد طلاب الدفعة للجدولة قبل توليد المجموعات.",
  INVALID_STUDENT_COUNT: "عدد الطلاب المستخدم للجدولة يجب أن يكون أكبر من صفر.",
  DELIVERY_GROUP_CAPACITY_INVALID:
    "تعذّر التوليد: راجع نوع القاعة وسعتها لمحاضرات المقررات، وحجم مجموعة المشروع إن كان مجدولًا.",
  COHORT_INACTIVE: "هذه الدفعة غير نشطة. فعّلها قبل التوليد.",
  COHORT_TERM_TYPE_UNSUPPORTED: "التوليد متاح للفصل الدراسي الأول أو الثاني. راجع فصل الدفعة.",
  COHORT_NOT_FOUND_OR_FORBIDDEN: "الدفعة غير متاحة أو ليست لديك صلاحية إدارتها.",
};

export function generationErrorMessage(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  return (
    Object.entries(messages).find(([code]) => raw.includes(code))?.[1] ||
    raw ||
    "تعذّر توليد بيانات الدفعة. أعد المحاولة."
  );
}

export function uniqueMatchingStudyPlan(ids: string[], selectedPlanId?: string | null): string {
  const candidates = [...new Set(ids)].filter((id) => selectedPlanId == null || id === selectedPlanId);
  if (candidates.length === 0) throw new Error("STUDY_PLAN_MISSING_FOR_COHORT_LEVEL_TERM");
  if (candidates.length !== 1) throw new Error("STUDY_PLAN_AMBIGUOUS_FOR_COHORT_LEVEL_TERM");
  return candidates[0];
}
