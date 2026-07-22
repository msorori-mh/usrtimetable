import { supabase } from "@/integrations/supabase/client";
import { categorizeInstructor } from "@/lib/instructor-category";

/**
 * Readiness Dashboard checks — 100% READ-ONLY (A4-READINESS-DASHBOARD-DESIGN-01).
 * Every check is a SELECT under the caller's RLS. No RPC calls, no mutations.
 * Fail-closed: any schema gap (table/column missing pre-migration-apply)
 * degrades the check to UNKNOWN ("غير متاح") instead of silently passing.
 *
 * Workflow order (locked): plan → cohort → electives → cohort courses →
 * optional shared groups → delivery groups → teaching assignment → working
 * days/slots → availability → build → review/approve/publish.
 */

export type CheckStatus = "PASS" | "BLOCKED" | "UNKNOWN";
export type CheckSeverity = "BLOCKER" | "WARN" | "INFO";

export interface CheckOutcome {
  status: CheckStatus;
  total: number | null;
  missing: number | null;
  note?: string;
}

export interface ReadinessCheckDef {
  id: string;
  title: string;
  severity: CheckSeverity;
  /** Exact next step — a verb + owning route (or null when there is no in-app route). */
  nextStep: { label: string; to: string | null };
  /** Whether the next-step action requires can_manage (UX hint only; RLS/RPC is the boundary). */
  requiresManage: boolean;
  /** Lane 1 (workflow rail) vs Lane 3 (system/migration blockers). */
  lane: 1 | 3;
  run: (collegeId: string) => Promise<CheckOutcome>;
}

const UNAVAILABLE = (note: string): CheckOutcome => ({
  status: "UNKNOWN",
  total: null,
  missing: null,
  note,
});

const pass = (total: number, note?: string): CheckOutcome => ({
  status: "PASS",
  total,
  missing: 0,
  note,
});

const blocked = (missing: number, total: number, note?: string): CheckOutcome => ({
  status: "BLOCKED",
  total,
  missing,
  note,
});

/** Count rows matching filters; null = query failed (fail-closed). */
async function countRows(
  table: string,
  collegeId: string,
  extra?: (q: any) => any,
): Promise<number | null> {
  try {
    let q: any = supabase.from(table as never).select("id", { count: "exact", head: true });
    q = q.eq("college_id", collegeId);
    if (extra) q = extra(q);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

async function selectRows(table: string, collegeId: string, columns: string): Promise<any[] | null> {
  try {
    const { data, error } = await supabase
      .from(table as never)
      .select(columns)
      .eq("college_id", collegeId);
    if (error) return null;
    return (data ?? []) as any[];
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- B1..B15 */

async function runB1(collegeId: string): Promise<CheckOutcome> {
  const activeTerms = await countRows("academic_terms", collegeId, (q) => q.eq("is_active", true));
  if (activeTerms === null) return UNAVAILABLE("تعذر الاستعلام عن الفصول الدراسية.");
  return activeTerms === 0
    ? blocked(1, 1, "لا يوجد فصل دراسي نشط.")
    : pass(activeTerms, "يوجد فصل دراسي نشط.");
}

async function runB2(collegeId: string): Promise<CheckOutcome> {
  const [departments, programs] = await Promise.all([
    countRows("departments", collegeId),
    countRows("academic_programs", collegeId),
  ]);
  if (departments === null || programs === null)
    return UNAVAILABLE("تعذر الاستعلام عن الأقسام/البرامج.");
  const missing = (departments === 0 ? 1 : 0) + (programs === 0 ? 1 : 0);
  return missing > 0
    ? blocked(missing, 2, `الأقسام: ${departments} · البرامج: ${programs}`)
    : pass(2, `الأقسام: ${departments} · البرامج: ${programs}`);
}

async function runB3(collegeId: string): Promise<CheckOutcome> {
  const cohorts = await countRows("academic_cohorts", collegeId, (q) => q.eq("active", true));
  if (cohorts === null) return UNAVAILABLE("تعذر الاستعلام عن الدفعات الدراسية.");
  return cohorts === 0
    ? blocked(1, 1, "لا توجد دفعة دراسية نشطة.")
    : pass(cohorts, `${cohorts} دفعة دراسية نشطة.`);
}

async function runB4(collegeId: string): Promise<CheckOutcome> {
  // Fail-closed link to scheduling headcount (migration 20260721180000 is
  // source-only, NOT APPLIED): if the table is missing this check degrades to
  // UNKNOWN instead of silently passing.
  const [cohorts, headcounts] = await Promise.all([
    countRows("academic_cohorts", collegeId, (q) => q.eq("active", true)),
    countRows("scheduling_cohort_term_headcounts", collegeId, (q) =>
      q.eq("approval_status", "approved"),
    ),
  ]);
  if (headcounts === null)
    return UNAVAILABLE(
      "جدول أعداد الدفعات المعتمدة للجدولة غير متاح — الترحيل 20260721180000 لم يُطبَّق (انظر B11).",
    );
  if (cohorts === null) return UNAVAILABLE("تعذر الاستعلام عن الدفعات الدراسية.");
  const missing = Math.max(0, cohorts - headcounts);
  return missing > 0
    ? blocked(missing, cohorts, `معتمد: ${headcounts} من ${cohorts} دفعة نشطة.`)
    : pass(cohorts, "كل الدفعات النشطة لديها أعداد معتمدة.");
}

async function runB5(collegeId: string): Promise<CheckOutcome> {
  // Cohort curriculum presence: cohorts linked to a plan must have plan_courses.
  // If the cohort→plan linkage column is absent the probe errors → UNKNOWN (fail-closed).
  const cohorts = await selectRows("academic_cohorts", collegeId, "id, plan_id, active");
  if (cohorts === null)
    return UNAVAILABLE("تعذر الاستعلام عن ربط الدفعة بالخطة (بنية غير مؤكدة).");
  const active = cohorts.filter((c) => c.active !== false);
  if (active.length === 0) return pass(0, "لا توجد دفعات نشطة بعد — يُحسم بعد B3.");
  const planIds = Array.from(new Set(active.map((c) => c.plan_id).filter(Boolean)));
  if (planIds.length === 0)
    return blocked(active.length, active.length, "لا توجد دفعة مرتبطة بخطة دراسية.");
  const planCourses = await selectRows("plan_courses", collegeId, "id, plan_id");
  if (planCourses === null) return UNAVAILABLE("تعذر الاستعلام عن مقررات الخطة.");
  const plansWithCourses = new Set(planCourses.map((p) => p.plan_id));
  const missing = active.filter((c) => !c.plan_id || !plansWithCourses.has(c.plan_id)).length;
  return missing > 0
    ? blocked(
        missing,
        active.length,
        "ولّد مقررات الدفعة من الخطة — يشمل ذلك المقررات الاختيارية المعتمدة.",
      )
    : pass(active.length, "مقررات الخطة متوفرة للدفعات النشطة.");
}

async function runB6(collegeId: string): Promise<CheckOutcome> {
  const [cohorts, groups] = await Promise.all([
    selectRows("academic_cohorts", collegeId, "id, active"),
    selectRows("delivery_groups", collegeId, "id, cohort_id"),
  ]);
  if (cohorts === null || groups === null)
    return UNAVAILABLE("تعذر الاستعلام عن الدفعات/المجموعات — بنية V2 غير مكتملة في هذه البيئة.");
  const active = cohorts.filter((c) => c.active !== false);
  if (active.length === 0) return pass(0, "لا توجد دفعات نشطة بعد — يُحسم بعد B3.");
  const withGroups = new Set(groups.map((g) => g.cohort_id));
  const missing = active.filter((c) => !withGroups.has(c.id)).length;
  return missing > 0
    ? blocked(missing, active.length, "دفعات نشطة بدون مجموعات المحاضرات والمعامل.")
    : pass(active.length, "كل الدفعات النشطة لديها مجموعات محاضرات ومعامل.");
}

async function runB7(collegeId: string): Promise<CheckOutcome> {
  const [groups, assignments] = await Promise.all([
    selectRows("delivery_groups", collegeId, "id"),
    selectRows("teaching_assignments", collegeId, "delivery_group_id, instructor_id"),
  ]);
  if (groups === null || assignments === null)
    return UNAVAILABLE("تعذر الاستعلام عن الإسناد التدريسي — بنية V2 غير مكتملة في هذه البيئة.");
  if (groups.length === 0) return pass(0, "لا توجد مجموعات بعد — يُحسم بعد B6.");
  const linked = assignments.filter((a) => a.delivery_group_id);
  const assignedGroups = new Set(linked.map((a) => a.delivery_group_id));
  const unassigned = groups.filter((g) => !assignedGroups.has(g.id)).length;
  const noInstructor = linked.filter((a) => !a.instructor_id).length;
  const missing = unassigned + noInstructor;
  return missing > 0
    ? blocked(
        missing,
        groups.length,
        `${unassigned} مجموعة بدون إسناد تدريسي · ${noInstructor} إسناد بدون محاضر.`,
      )
    : pass(groups.length, "الإسناد التدريسي مكتمل للمجموعات الحالية.");
}

async function runB8(collegeId: string): Promise<CheckOutcome> {
  const rooms = await selectRows("rooms", collegeId, "id, capacity, room_type_id, room_type");
  if (rooms === null) return UNAVAILABLE("تعذر الاستعلام عن القاعات.");
  if (rooms.length === 0) return blocked(1, 1, "لا توجد قاعات.");
  const noType = rooms.filter((r) => !r.room_type_id && !r.room_type).length;
  const badCapacity = rooms.filter((r) => !r.capacity || r.capacity <= 0).length;
  const missing = noType + badCapacity;
  return missing > 0
    ? blocked(missing, rooms.length, `${noType} قاعة بدون نوع · ${badCapacity} قاعة بسعة ≤ 0.`)
    : pass(rooms.length, `${rooms.length} قاعة معرّفة بنوع وسعة صحيحة.`);
}

async function runB9(collegeId: string): Promise<CheckOutcome> {
  const [groups, rooms] = await Promise.all([
    selectRows("delivery_groups", collegeId, "id, expected_students"),
    selectRows("rooms", collegeId, "id, capacity"),
  ]);
  if (groups === null || rooms === null)
    return UNAVAILABLE(
      "تعذر الاستعلام عن السعة المتوقعة للمجموعات (قد تكون البنية غير مطبقة بعد).",
    );
  if (groups.length === 0) return pass(0, "لا توجد مجموعات بعد — يُحسم بعد B6.");
  const maxCapacity = Math.max(0, ...rooms.map((r) => Number(r.capacity) || 0));
  const oversized = groups.filter(
    (g) => typeof g.expected_students === "number" && g.expected_students > maxCapacity,
  ).length;
  return oversized > 0
    ? blocked(
        oversized,
        groups.length,
        "مجموعات يتجاوز عددها المتوقع أكبر قاعة. اعتماد تقسيم السعة معلّق على الترحيل 20260715120000 (انظر B11).",
      )
    : pass(groups.length, "لا توجد مجموعة تتجاوز سعة أكبر قاعة.");
}

async function runB10(collegeId: string): Promise<CheckOutcome> {
  try {
    const { data, error } = await supabase
      .from("schedule_quality_runs")
      .select("hard_conflicts_count, created_at")
      .eq("college_id", collegeId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return UNAVAILABLE("تعذر الاستعلام عن نتائج جودة الجدول.");
    const latest = (data ?? [])[0] as any;
    if (!latest) return UNAVAILABLE("لا توجد نتيجة جودة محفوظة — شغّل فحص التعارضات أولًا.");
    const hard = Number(latest.hard_conflicts_count) || 0;
    return hard > 0
      ? blocked(hard, hard, "تعارضات إلزامية غير محلولة في آخر نتيجة جودة — تمنع النشر.")
      : pass(0, "آخر نتيجة جودة بدون تعارضات إلزامية.");
  } catch {
    return UNAVAILABLE("تعذر الاستعلام عن نتائج جودة الجدول.");
  }
}

function runB11(): CheckOutcome {
  return {
    status: "UNKNOWN",
    total: MIGRATION_MANIFEST.length,
    missing: MIGRATION_MANIFEST.filter((m) => m.status !== "APPLIED").length,
    note: "لا يُعتد بأي ترحيل كمطبَّق دون دليل عن بُعد. الحالة الحالية: UNKNOWN بدون دليل تطبيق.",
  };
}

async function runB12(collegeId: string): Promise<CheckOutcome> {
  const versions = await selectRows("schedule_versions", collegeId, "id, status");
  if (versions === null) return UNAVAILABLE("تعذر الاستعلام عن نسخ الجدول.");
  if (versions.length === 0)
    return blocked(1, 1, "لا توجد نسخة جدول — ابدأ نسخة جدول.");
  const byStatus = versions.reduce<Record<string, number>>((acc, v) => {
    const s = String(v.status ?? "unknown");
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byStatus)
    .map(([s, n]) => `${s}: ${n}`)
    .join(" · ");
  return pass(versions.length, summary);
}

async function runB13(collegeId: string): Promise<CheckOutcome> {
  const [instructors, availability] = await Promise.all([
    selectRows(
      "instructors",
      collegeId,
      "id, instructor_types:instructor_type_id ( code, is_external )",
    ),
    selectRows("instructor_availability", collegeId, "instructor_id"),
  ]);
  if (instructors === null || availability === null)
    return UNAVAILABLE("تعذر الاستعلام عن توفر المحاضرين.");
  const withAvailability = new Set(availability.map((a) => a.instructor_id));
  const external = instructors.filter(
    (i) => categorizeInstructor(i.instructor_types) !== "permanent",
  );
  const missing = external.filter((i) => !withAvailability.has(i.id)).length;
  return missing > 0
    ? blocked(missing, external.length, "محاضرون خارجيون/من كلية أخرى بدون أوقات توفر.")
    : pass(external.length, "كل المحاضرين الخارجيين لديهم أوقات توفر.");
}

async function runB14(collegeId: string): Promise<CheckOutcome> {
  const [settings, templates] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase
          .from("scheduling_settings")
          .select("id, working_days")
          .eq("college_id", collegeId)
          .maybeSingle();
        if (error) return null;
        return data as any;
      } catch {
        return null;
      }
    })(),
    countRows("time_slot_templates", collegeId),
  ]);
  if (templates === null)
    return UNAVAILABLE("تعذر الاستعلام عن قوالب الفترات الزمنية.");
  const settingsRow = settings as { id?: string; working_days?: unknown } | null;
  const settingsMissing =
    !settingsRow || !Array.isArray(settingsRow.working_days) || settingsRow.working_days.length === 0;
  const missing = (settingsMissing ? 1 : 0) + (templates === 0 ? 1 : 0);
  return missing > 0
    ? blocked(
        missing,
        2,
        `${settingsMissing ? "إعدادات أيام وفترات الدوام غير معرّفة" : "إعدادات الدوام معرّفة"} · قوالب الفترات: ${templates}`,
      )
    : pass(2, "أيام وفترات الدوام وقوالب الفترات معرّفة.");
}

function runB15(): CheckOutcome {
  // Read-only mirror of STATE.json production_facts (USER_CONFIRMED_PRODUCTION_FACT).
  return {
    status: "BLOCKED",
    total: LEGACY_RESIDUE.orphanTeachingAssignments + LEGACY_RESIDUE.orphanCourseOfferingSections,
    missing: LEGACY_RESIDUE.orphanTeachingAssignments + LEGACY_RESIDUE.orphanCourseOfferingSections,
    note: `بقايا Legacy موثقة في STATE.json: ${LEGACY_RESIDUE.orphanTeachingAssignments} إسنادًا تدريسيًا يتيمًا + ${LEGACY_RESIDUE.orphanCourseOfferingSections} سجلات course_offering_sections يتيمة. تصبح مانعًا لتطبيق 20260721090000.`,
  };
}

/* ------------------------------------------------------- static manifests */

/** B11: read-only mirror of STATE.json source_only_migrations_not_applied + expected order. */
export interface MigrationManifestItem {
  file: string;
  order: number | null;
  status: "UNKNOWN" | "HELD";
  gate: string;
  note: string;
}

export const MIGRATION_MANIFEST: MigrationManifestItem[] = [
  {
    file: "20260717050000_source_only_harden_cross_college_references.sql",
    order: 1,
    status: "UNKNOWN",
    gate: "APPROVE_DB_MIGRATION_APPLY",
    note: "المتطلب الأول لتطبيق أساس أعداد الدفعات (GAP-1).",
  },
  {
    file: "20260720143000_source_only_program_department_integrity.sql",
    order: 2,
    status: "UNKNOWN",
    gate: "APPROVE_DB_MIGRATION_APPLY",
    note: "عند تأكيد الحاجة والترتيب وفق STATE.json.",
  },
  {
    file: "20260721180000_source_only_scheduling_headcount_foundation.sql",
    order: 3,
    status: "UNKNOWN",
    gate: "APPROVE_DB_MIGRATION_APPLY",
    note: "أساس أعداد الدفعات المعتمدة للجدولة (GAP-3) — ثم إدخال الأعداد المعتمدة، ثم A2.",
  },
  {
    file: "20260715120000_approve_capacity_split_proposal.sql",
    order: null,
    status: "UNKNOWN",
    gate: "APPROVE_DB_MIGRATION_APPLY",
    note: "اعتماد مقترحات تقسيم السعة (B9).",
  },
  {
    file: "20260718183000_forward_harden_cohort_curriculum_runtime.sql",
    order: null,
    status: "UNKNOWN",
    gate: "APPROVE_DB_MIGRATION_APPLY",
    note: "تصليح وقت تشغيل منهج الدفعة (B5).",
  },
  {
    file: "20260720120000_source_only_availability_all_active_days.sql",
    order: null,
    status: "UNKNOWN",
    gate: "APPROVE_DB_MIGRATION_APPLY",
    note: "توفر كل أيام الدوام — حُكم التحقق PASS في WAVE-03؛ انزعاج runtime حتى يُطبَّق.",
  },
  {
    file: "20260721090000_source_only_legacy_write_hardening.sql",
    order: null,
    status: "HELD",
    gate: "APPROVE_LEGACY_DATA_REMEDIATION + APPROVE_DB_MIGRATION_APPLY",
    note: "مُعلَّق عمدًا: مشروط بمعالجة بقايا Legacy أولًا (A1.3b) — لا يُطبَّق الآن.",
  },
];

/** B15: production facts mirrored from STATE.json (USER_CONFIRMED_PRODUCTION_FACT). */
export const LEGACY_RESIDUE = {
  orphanTeachingAssignments: 174,
  orphanCourseOfferingSections: 5,
  remediationPlanDoc:
    "implementation-reports/A1-3B-LEGACY-ORPHAN-REMEDIATION-PLAN-01.md",
} as const;

export const DEPENDENCY_MAP_DOC =
  "implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md";

/** A2 not implemented — shared groups never combined by default (design lock). */
export const SHARED_GROUPS_NOTE =
  "المجموعات المشتركة للمحاضرات غير مفعّلة بعد (مسار A2) — لا يجوز دمج منتظم وموازٍ في مجموعة مشتركة واحدة افتراضيًا.";

/* ------------------------------------------------------------- registry */

export const READINESS_CHECKS: ReadinessCheckDef[] = [
  {
    id: "B1",
    title: "الفصل الدراسي النشط",
    severity: "BLOCKER",
    nextStep: { label: "أنشئ الفصل الدراسي وفعّله", to: "/terms" },
    requiresManage: true,
    lane: 1,
    run: runB1,
  },
  {
    id: "B2",
    title: "الأقسام والبرامج الأكاديمية",
    severity: "BLOCKER",
    nextStep: { label: "أنشئ قسمًا ثم برنامجًا (ثم انتقل إلى /programs)", to: "/departments" },
    requiresManage: true,
    lane: 1,
    run: runB2,
  },
  {
    id: "B3",
    title: "الدفعات الدراسية",
    severity: "BLOCKER",
    nextStep: { label: "أنشئ الدفعة الدراسية", to: "/academic-cohorts" },
    requiresManage: true,
    lane: 1,
    run: runB3,
  },
  {
    id: "B5",
    title: "منهج الدفعة (مقررات الخطة)",
    severity: "BLOCKER",
    nextStep: { label: "ولّد مقررات الدفعة من الخطة", to: "/academic-cohorts" },
    requiresManage: true,
    lane: 1,
    run: runB5,
  },
  {
    id: "B6",
    title: "مجموعات المحاضرات والمعامل",
    severity: "BLOCKER",
    nextStep: { label: "ولّد مجموعات المحاضرات والمعامل", to: "/academic-cohorts" },
    requiresManage: true,
    lane: 1,
    run: runB6,
  },
  {
    id: "B7",
    title: "الإسناد التدريسي",
    severity: "BLOCKER",
    nextStep: { label: "أكمل الإسناد التدريسي وعيّن المحاضرين", to: "/teaching-assignments" },
    requiresManage: true,
    lane: 1,
    run: runB7,
  },
  {
    id: "B8",
    title: "القاعات وأنواعها وسعاتها",
    severity: "BLOCKER",
    nextStep: { label: "أضف القاعات وأنواعها وسعاتها", to: "/rooms" },
    requiresManage: true,
    lane: 1,
    run: runB8,
  },
  {
    id: "B14",
    title: "أيام وفترات الدوام وقوالب الفترات",
    severity: "BLOCKER",
    nextStep: { label: "عرّف أيام وفترات الدوام وقوالب الفترات", to: "/scheduling-settings" },
    requiresManage: true,
    lane: 1,
    run: runB14,
  },
  {
    id: "B13",
    title: "توفر المحاضرين الخارجيين",
    severity: "BLOCKER",
    nextStep: { label: "أدخل أوقات توفر المحاضرين الخارجيين", to: "/availability" },
    requiresManage: true,
    lane: 1,
    run: runB13,
  },
  {
    id: "B4",
    title: "أعداد الدفعات المعتمدة للجدولة",
    severity: "BLOCKER",
    nextStep: {
      label: "أدخل واعتمد أعداد الدفعات المعتمدة للجدولة لكل دفعة/فصل (مع المصدر)",
      to: "/scheduling-headcounts",
    },
    requiresManage: true,
    lane: 1,
    run: runB4,
  },
  {
    id: "B9",
    title: "سعة القاعات مقابل أعداد المجموعات",
    severity: "BLOCKER",
    nextStep: { label: "اعتمد تقسيم السعة أو وفّر قاعة أكبر", to: "/delivery-groups" },
    requiresManage: true,
    lane: 1,
    run: runB9,
  },
  {
    id: "B10",
    title: "التعارضات الإلزامية",
    severity: "BLOCKER",
    nextStep: { label: "حل أو اعتمد استثناءات التعارض", to: "/conflict-checks" },
    requiresManage: true,
    lane: 1,
    run: runB10,
  },
  {
    id: "B12",
    title: "دورة حياة نسخ الجدول",
    severity: "WARN",
    nextStep: { label: "أرسل للمراجعة / اعتمد / انشر وفق الصلاحيات", to: "/schedule-versions" },
    requiresManage: true,
    lane: 1,
    run: runB12,
  },
  {
    id: "B11",
    title: "حواجز الترحيل ووقت التشغيل",
    severity: "BLOCKER",
    nextStep: {
      label: "اطلب APPROVE_DB_MIGRATION_APPLY وطبّق بالترتيب المعتمد",
      to: null,
    },
    requiresManage: false,
    lane: 3,
    run: async () => runB11(),
  },
  {
    id: "B15",
    title: "بقايا Legacy (أيتام section_id)",
    severity: "WARN",
    nextStep: {
      label: "أكمل تصنيف ومعالجة الأيتام (APPROVE_LEGACY_DATA_REMEDIATION)",
      to: null,
    },
    requiresManage: false,
    lane: 3,
    run: async () => runB15(),
  },
];

export interface ReadinessCheckResult extends CheckOutcome {
  def: ReadinessCheckDef;
}

export async function runAllChecks(collegeId: string): Promise<ReadinessCheckResult[]> {
  return Promise.all(
    READINESS_CHECKS.map(async (def) => ({ def, ...(await def.run(collegeId)) })),
  );
}

/** Overall status = worst BLOCKER-severity state (fail-closed, not an averaged score). */
export function overallStatus(results: ReadinessCheckResult[]): CheckStatus {
  const blockers = results.filter((r) => r.def.severity === "BLOCKER");
  if (blockers.some((r) => r.status === "BLOCKED")) return "BLOCKED";
  if (blockers.some((r) => r.status === "UNKNOWN")) return "UNKNOWN";
  return "PASS";
}
