import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Gauge, BookOpen, Users, CalendarClock, AlertTriangle, CheckCircle2, XCircle, CalendarCheck } from "lucide-react";
import { categorizeInstructor, type InstructorCategory, CATEGORY_LABEL_AR } from "@/lib/instructor-category";

export const Route = createFileRoute("/_authenticated/data-readiness")({
  head: () => ({ meta: [{ title: "جاهزية البيانات" }] }),
  component: DataReadinessPage,
});

type Metric = { label: string; total: number; missing: number; critical?: boolean };

async function fetchReadiness(collegeId: string) {
  const eq = (q: any) => q.eq("college_id", collegeId);

  const [
    courses,
    planCourses,
    instructors,
    rooms,
    offerings,
    assignments,
    sessions,
    roomTypes,
    availability,
  ] = await Promise.all([
    eq(supabase.from("courses").select("id, code, name", { count: "exact" })),
    eq(supabase.from("plan_courses").select("id, level_id, semester, lectures_per_week, labs_per_week, lecture_session_duration, lab_session_duration, course_id", { count: "exact" })),
    eq(supabase.from("instructors").select("id, specialization, department_id, instructor_type_id, instructor_types:instructor_type_id ( code, is_external )", { count: "exact" })),
    eq(supabase.from("rooms").select("id, capacity, room_type_id, room_type", { count: "exact" })),
    eq(supabase.from("course_offerings").select("id, expected_students", { count: "exact" })),
    eq(supabase.from("teaching_assignments").select("id, instructor_id, course_offering_id", { count: "exact" })),
    eq(supabase.from("schedule_sessions").select("id, room_id, start_time, end_time, day_of_week", { count: "exact" })),
    eq(supabase.from("room_types").select("id, default_capacity")),
    eq(supabase.from("instructor_availability").select("instructor_id")),
  ]);

  const coursesRows = courses.data ?? [];
  const planRows = planCourses.data ?? [];
  const instructorsRows = instructors.data ?? [];
  const roomsRows = rooms.data ?? [];
  const offeringsRows = offerings.data ?? [];
  const assignmentsRows = assignments.data ?? [];
  const sessionsRows = sessions.data ?? [];
  const roomTypeMap = new Map((roomTypes.data ?? []).map((r: any) => [r.id, r.default_capacity]));
  const instructorsWithAvail = new Set(((availability.data ?? []) as any[]).map((a) => a.instructor_id));

  const linkedCourseIds = new Set(planRows.map((p: any) => p.course_id));
  const offeringsWithAssignments = new Set(assignmentsRows.map((a: any) => a.course_offering_id));

  // Study Plan metrics
  const sp: Metric[] = [
    { label: "مقررات غير مرتبطة بأي خطة دراسية", total: coursesRows.length, missing: coursesRows.filter((c: any) => !linkedCourseIds.has(c.id)).length },
    { label: "صفوف الخطة بدون مستوى", total: planRows.length, missing: planRows.filter((p: any) => !p.level_id).length },
    { label: "صفوف الخطة بدون فصل (semester)", total: planRows.length, missing: planRows.filter((p: any) => !p.semester).length },
    { label: "بدون عدد محاضرات أسبوعية", total: planRows.length, missing: planRows.filter((p: any) => !p.lectures_per_week).length },
    { label: "بدون عدد مختبرات أسبوعية", total: planRows.length, missing: planRows.filter((p: any) => p.labs_per_week === null || p.labs_per_week === undefined).length },
    { label: "بدون مدة جلسة محاضرة", total: planRows.length, missing: planRows.filter((p: any) => !p.lecture_session_duration).length },
    { label: "بدون مدة جلسة مختبر", total: planRows.length, missing: planRows.filter((p: any) => p.labs_per_week > 0 && !p.lab_session_duration).length },
  ];

  // Resource metrics
  const res: Metric[] = [
    { label: "محاضرون بدون تخصص", total: instructorsRows.length, missing: instructorsRows.filter((i: any) => !i.specialization).length },
    { label: "محاضرون بدون قسم", total: instructorsRows.length, missing: instructorsRows.filter((i: any) => !i.department_id).length },
    { label: "قاعات بسعة افتراضية (مطابقة للنوع)", total: roomsRows.length, missing: roomsRows.filter((r: any) => r.room_type_id && r.capacity === roomTypeMap.get(r.room_type_id)).length },
    { label: "قاعات بدون نوع قاعة", total: roomsRows.length, missing: roomsRows.filter((r: any) => !r.room_type_id && !r.room_type).length },
    { label: "قاعات بسعة ≤ 0", total: roomsRows.length, missing: roomsRows.filter((r: any) => !r.capacity || r.capacity <= 0).length, critical: true },
  ];

  // Instructor availability — per category (Phase 1.5A)
  const byCategory: Record<InstructorCategory, { total: number; configured: number }> = {
    permanent: { total: 0, configured: 0 },
    external: { total: 0, configured: 0 },
    other_college: { total: 0, configured: 0 },
  };
  for (const i of instructorsRows as any[]) {
    const cat = categorizeInstructor(i.instructor_types);
    byCategory[cat].total += 1;
    if (instructorsWithAvail.has(i.id)) byCategory[cat].configured += 1;
  }
  // Availability readiness rules:
  //   permanent → informational (no penalty, default working week assumed)
  //   external / other_college → critical (mandatory before scheduling)
  const avail: Metric[] = [
    {
      label: `محاضرون دائمون (افتراضي): ${byCategory.permanent.configured} / ${byCategory.permanent.total} مُعرَّف صراحة`,
      total: 0, // informational only — excluded from score
      missing: 0,
    },
    {
      label: "محاضرون خارجيون بدون أوقات توفّر",
      total: byCategory.external.total,
      missing: byCategory.external.total - byCategory.external.configured,
      critical: true,
    },
    {
      label: "محاضرون من كلية أخرى بدون أوقات توفّر",
      total: byCategory.other_college.total,
      missing: byCategory.other_college.total - byCategory.other_college.configured,
      critical: true,
    },
  ];

  // Scheduling metrics
  const sch: Metric[] = [
    { label: "عروض مقررات بأعداد طلاب ≤ 0", total: offeringsRows.length, missing: offeringsRows.filter((o: any) => !o.expected_students || o.expected_students <= 0).length },
    { label: "عروض مقررات بدون تكليفات تدريسية", total: offeringsRows.length, missing: offeringsRows.filter((o: any) => !offeringsWithAssignments.has(o.id)).length },
    { label: "تكليفات بدون محاضر", total: assignmentsRows.length, missing: assignmentsRows.filter((a: any) => !a.instructor_id).length, critical: true },
    { label: "جلسات بدون قاعة", total: sessionsRows.length, missing: sessionsRows.filter((s: any) => !s.room_id).length },
    { label: "جلسات بدون وقت", total: sessionsRows.length, missing: sessionsRows.filter((s: any) => !s.start_time || !s.end_time || s.day_of_week === null).length },
  ];

  const score = (items: Metric[]) => {
    const denom = items.reduce((s, m) => s + (m.total || 0), 0);
    const miss = items.reduce((s, m) => s + (m.missing || 0), 0);
    if (denom === 0) return 100;
    return Math.max(0, Math.min(100, Math.round(100 - (miss * 100) / denom)));
  };

  const studyPlanScore = score(sp);
  const resourcesScore = score([...res, ...avail]);
  const schedulingScore = score(sch);
  const overall = Math.round((studyPlanScore + resourcesScore + schedulingScore) / 3);

  return {
    totals: {
      courses: courses.count ?? 0,
      planCourses: planCourses.count ?? 0,
      instructors: instructors.count ?? 0,
      rooms: rooms.count ?? 0,
      offerings: offerings.count ?? 0,
      assignments: assignments.count ?? 0,
      sessions: sessions.count ?? 0,
    },
    studyPlan: sp,
    resources: res,
    availability: avail,
    availabilityByCategory: byCategory,
    scheduling: sch,
    scores: { studyPlanScore, resourcesScore, schedulingScore, overall },
  };
}

function statusOf(score: number): { label: string; tone: "ok" | "warn" | "bad" } {
  if (score >= 80) return { label: "جاهز", tone: "ok" };
  if (score >= 50) return { label: "يحتاج مراجعة", tone: "warn" };
  return { label: "حرج", tone: "bad" };
}

function ScoreCard({ title, score, icon }: { title: string; score: number; icon: React.ReactNode }) {
  const s = statusOf(score);
  const tone = s.tone === "ok" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
    s.tone === "warn" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
    "bg-red-500/10 text-red-600 border-red-500/20";
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{icon}{title}</div>
        <Badge variant="outline" className={tone}>{s.label}</Badge>
      </div>
      <p className="text-3xl font-bold">{score}<span className="text-base text-muted-foreground">/100</span></p>
      <Progress value={score} className="mt-3" />
    </Card>
  );
}

function MetricRow({ m }: { m: Metric }) {
  const pct = m.total > 0 ? Math.round((m.missing * 100) / m.total) : 0;
  const tone = m.missing === 0 ? "text-emerald-600" : pct >= 50 ? "text-red-600" : pct >= 20 ? "text-amber-600" : "text-muted-foreground";
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5 last:border-0">
      <div className="flex items-center gap-2">
        {m.missing === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> :
          m.critical ? <XCircle className="h-4 w-4 text-red-500" /> :
          <AlertTriangle className="h-4 w-4 text-amber-500" />}
        <span className="text-sm">{m.label}</span>
      </div>
      <div className={`text-sm font-medium ${tone}`}>
        {m.missing} / {m.total} <span className="text-xs">({pct}%)</span>
      </div>
    </li>
  );
}

function Section({ title, icon, metrics }: { title: string; icon: React.ReactNode; metrics: Metric[] }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">{icon}{title}</h2>
      <ul>{metrics.map((m, i) => <MetricRow key={i} m={m} />)}</ul>
    </Card>
  );
}

function DataReadinessPage() {
  const { active } = useActiveCollege();
  const { data, isLoading } = useQuery({
    queryKey: ["data-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchReadiness(active!.id),
  });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary"><Gauge className="h-5 w-5" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">جاهزية البيانات</h1>
          <p className="text-sm text-muted-foreground">تقييم جاهزية البيانات الأكاديمية لتوليد جدول واقعي (للقراءة فقط).</p>
        </div>
        <Link to="/data-templates" className="text-sm text-primary underline-offset-4 hover:underline">
          قوالب البيانات ←
        </Link>
      </header>

      <div className="mb-5"><CollegeSwitcher /></div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلّية للبدء.</Card>
      ) : isLoading || !data ? (
        <Card className="p-6 text-center text-muted-foreground">جارٍ حساب الجاهزية…</Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-4">
            <ScoreCard title="الجاهزية العامة" score={data.scores.overall} icon={<Gauge className="h-4 w-4" />} />
            <ScoreCard title="الخطط الدراسية" score={data.scores.studyPlanScore} icon={<BookOpen className="h-4 w-4" />} />
            <ScoreCard title="الموارد" score={data.scores.resourcesScore} icon={<Users className="h-4 w-4" />} />
            <ScoreCard title="الجدولة" score={data.scores.schedulingScore} icon={<CalendarClock className="h-4 w-4" />} />
          </div>

          <Card className="mb-5 p-5">
            <h2 className="mb-3 text-base font-semibold">ملخص سريع</h2>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><p className="text-muted-foreground">المقررات</p><p className="text-lg font-semibold">{data.totals.courses}</p></div>
              <div><p className="text-muted-foreground">صفوف الخطة</p><p className="text-lg font-semibold">{data.totals.planCourses}</p></div>
              <div><p className="text-muted-foreground">المحاضرون</p><p className="text-lg font-semibold">{data.totals.instructors}</p></div>
              <div><p className="text-muted-foreground">القاعات</p><p className="text-lg font-semibold">{data.totals.rooms}</p></div>
              <div><p className="text-muted-foreground">عروض المقررات</p><p className="text-lg font-semibold">{data.totals.offerings}</p></div>
              <div><p className="text-muted-foreground">التكليفات</p><p className="text-lg font-semibold">{data.totals.assignments}</p></div>
              <div><p className="text-muted-foreground">الجلسات</p><p className="text-lg font-semibold">{data.totals.sessions}</p></div>
            </div>
            <div className="mt-4 space-y-1 text-sm">
              {[...data.scheduling, ...data.resources, ...data.studyPlan]
                .filter((m) => m.missing > 0)
                .sort((a, b) => b.missing - a.missing)
                .slice(0, 4)
                .map((m, i) => (
                  <p key={i} className="text-muted-foreground">• {m.missing} {m.label}</p>
                ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Section title="جاهزية الخطط الدراسية" icon={<BookOpen className="h-4 w-4" />} metrics={data.studyPlan} />
            <Section title="جاهزية الموارد" icon={<Users className="h-4 w-4" />} metrics={data.resources} />
            <Section title="جاهزية الجدولة" icon={<CalendarClock className="h-4 w-4" />} metrics={data.scheduling} />
          </div>
        </>
      )}
    </div>
  );
}
