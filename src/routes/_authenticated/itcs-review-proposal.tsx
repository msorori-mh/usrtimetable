import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/itcs-review-proposal")({
  head: () => ({ meta: [{ title: "مسودة مقترح الحاسوب 30/9 — مراجعة قبل النشر" }] }),
  component: ReviewProposalPage,
});

const PROFILE = "itcs_proposal16_review_20260930";
const DAYS: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
};
type Session = [
  string,
  number,
  string,
  string,
  string,
  number,
  string,
  string,
  string,
  string,
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  ...unknown[],
];
type Clash = {
  id: string;
  instructor: string;
  day: number;
  start_time: string;
  end_time: string;
  course: string;
  cohort: string;
  section: string;
  external_slots: { start: string; end: string }[];
};
type Report = {
  sessions: Session[];
  cohorts: [string, string, number][];
  parts: Record<string, string[]>;
  part_cohort: Record<string, string>;
};
type Proposal = {
  profile: string;
  saved: boolean;
  id: string | null;
  saved_at: string | null;
  source_version_id: string;
  source_snapshot: string;
  payload_hash: string;
  payload: {
    title: string;
    focus_instructor_ids: string[];
    review_notes: string;
    report_data: Report;
    requirements: { checks: { name: string; passed: boolean }[] };
  };
  current_checks: {
    checked_at: string;
    external_conflict_sessions: number;
    external_conflicts: Clash[];
  };
};
type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
const hours = (s: Session) => Number(s[3].slice(0, 2)) - Number(s[2].slice(0, 2));
const clock = (s: string) => s.slice(0, 5);
const dayOrder = (d: number) => (d === 6 ? 0 : d + 1);

function ReviewProposalPage() {
  const { data: me } = useCurrentUser();
  const [instructor, setInstructor] = useState("");
  const [cohort, setCohort] = useState("");
  const [room, setRoom] = useState("");
  const [saving, setSaving] = useState(false);
  const [checked, setChecked] = useState(false);
  const nativeQuery = useQuery({
    queryKey: ["itcs-native-draft", PROFILE, me?.id],
    enabled: !!me?.isSuperAdmin,
    queryFn: async () => {
      const r = await rpc("itcs_native_draft_preview", { p_profile: PROFILE });
      if (r.error) throw new Error(r.error.message);
      return r.data as {
        manifest_sha: string;
        version_id: string | null;
        receipt: { ok: boolean } | null;
      };
    },
  });
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["itcs-review-proposal", PROFILE, me?.id],
    enabled: !!me,
    queryFn: async () => {
      const r = await rpc("itcs_review_proposal_get", { p_profile: PROFILE });
      if (r.error) throw new Error(r.error.message);
      return r.data as Proposal;
    },
  });
  const proposal = query.data;
  const report = proposal?.payload.report_data;
  const teachers = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; hours: number; sessions: number; days: Set<number> }
    >();
    for (const s of report?.sessions ?? []) {
      const t = map.get(s[15]) ?? {
        id: s[15],
        name: s[16],
        hours: 0,
        sessions: 0,
        days: new Set<number>(),
      };
      t.hours += hours(s);
      t.sessions++;
      t.days.add(s[1]);
      map.set(t.id, t);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [report]);
  const visible = useMemo(
    () =>
      (report?.sessions ?? [])
        .filter(
          (s) =>
            (!instructor || s[15] === instructor) &&
            (!room || s[17] === room) &&
            (!cohort ||
              s[7] === cohort ||
              report?.parts[s[0]]?.some((p) => report.part_cohort[p] === cohort)),
        )
        .sort(
          (a, b) =>
            dayOrder(a[1]) - dayOrder(b[1]) ||
            a[2].localeCompare(b[2]) ||
            a[16].localeCompare(b[16], "ar"),
        ),
    [report, instructor, room, cohort],
  );

  async function save(stage: "review_check" | "review_save") {
    if (!proposal || !nativeQuery.data || saving) return;
    setSaving(true);
    setError("");
    try {
      const r = await rpc("itcs_cutover_execute", {
        p_stage: stage,
        p_version: proposal.source_version_id,
        p_published: proposal.source_version_id,
        p_manifest: { profile: PROFILE },
        p_manifest_sha: nativeQuery.data.manifest_sha,
        p_expected_published_snapshot: proposal.source_snapshot,
      });
      if (r.error) throw new Error(r.error.message);
      setChecked(stage === "review_check");
      await Promise.all([query.refetch(), nativeQuery.refetch()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  if (query.isError)
    return (
      <Card dir="rtl" className="p-6">
        <p role="alert">تعذر فتح مسودة المقترح: {query.error.message}</p>
        <Button onClick={() => void query.refetch()}>إعادة المحاولة</Button>
      </Card>
    );
  if (!proposal || !report)
    return (
      <p className="p-6" dir="rtl">
        جارٍ تحميل مسودة المقترح…
      </p>
    );
  const checks = proposal.current_checks;
  const clashIds = new Set(checks.external_conflicts.map((c) => c.id));
  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Badge variant="secondary">
            {nativeQuery.data?.version_id
              ? "مسودة جدولة محفوظة"
              : proposal.saved
                ? "مسودة مقترح محفوظة"
                : "معاينة قبل الحفظ"}
          </Badge>
          <h1 className="text-2xl font-bold">{proposal.payload.title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            نسخة الحاسوب المصححة للمراجعة قبل النشر. يجري الحفظ في نسخة جدولة مستقلة بعد فحص الخادم،
            مع الحفاظ على سجل الجدول المنشور.
          </p>
          {proposal.saved_at && (
            <p className="text-sm">
              حُفظت بتاريخ {new Date(proposal.saved_at).toLocaleString("ar-YE")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {me?.isSuperAdmin && !nativeQuery.data?.version_id && (
            <>
              <Button
                variant="outline"
                disabled={saving || !nativeQuery.data}
                onClick={() => void save("review_check")}
              >
                {saving ? "جارٍ التحقق…" : "فحص الحفظ دون تثبيت"}
              </Button>
              <Button disabled={saving || !checked} onClick={() => void save("review_save")}>
                {saving ? "جارٍ الحفظ…" : "حفظ نسخة جدولة مسودة"}
              </Button>
            </>
          )}
          {nativeQuery.data?.version_id && (
            <Button asChild>
              <Link to="/timetable/$versionId" params={{ versionId: nativeQuery.data.version_id }}>
                فتح مسودة الجدول
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            طباعة المراجعة
          </Button>
          <Button variant="outline" asChild>
            <Link to="/schedule-versions">مراجعة الجداول</Link>
          </Button>
        </div>
      </div>
      {checked && (
        <p role="status" className="rounded border p-3">
          نجح فحص الحفظ الكامل على الخادم؛ أُلغيت تجربة الفحص ولم تُحفظ أي تغييرات منها.
        </p>
      )}
      {(error || nativeQuery.error) && (
        <p role="alert" className="rounded border border-destructive p-3 text-destructive">
          لم يكتمل الإجراء: {error || nativeQuery.error?.message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [report.sessions.length, "محاضرة"],
          [report.sessions.reduce((n, s) => n + hours(s), 0), "ساعة تدريسية"],
          [teachers.length, "محاضرًا"],
          [3, "أيام للقاعة الكبرى"],
        ].map(([n, label]) => (
          <Card className="p-4" key={label}>
            <p className="text-3xl font-bold">{n}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>
      <Card className="space-y-3 border-amber-300 bg-amber-50/50 p-4 dark:bg-amber-950/20">
        <h2 className="font-bold">مطابقة التزامات الكليات</h2>
        <p className="text-sm">
          {checks.external_conflict_sessions === 0
            ? "لا توجد محاضرات متداخلة مع التزامات الكليات الأخرى في المطابقة الحالية. النسخة للمراجعة قبل النشر."
            : `${checks.external_conflict_sessions} محاضرات تتداخل مع التزامات مسجلة في كليات أخرى وتحتاج المعالجة قبل حفظ الجدول.`}
        </p>
        <p className="text-xs text-muted-foreground">
          آخر مطابقة مع المنصة: {new Date(checks.checked_at).toLocaleString("ar-YE")}. يشمل الفحص
          الحسابات المرتبطة للمحاضر نفسه.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">المحاضر والمقرر</th>
                <th className="p-2">المجموعة</th>
                <th className="p-2">الموعد المقترح</th>
                <th className="p-2">التزام خارجي متداخل</th>
              </tr>
            </thead>
            <tbody>
              {checks.external_conflicts.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-2">
                    <p className="font-medium">{c.instructor}</p>
                    <p>{c.course}</p>
                  </td>
                  <td className="p-2">
                    <span dir="ltr">{c.cohort}</span> · {c.section}
                  </td>
                  <td className="whitespace-nowrap p-2">
                    {DAYS[c.day]}{" "}
                    <span dir="ltr">
                      {clock(c.start_time)}–{clock(c.end_time)}
                    </span>
                  </td>
                  <td className="p-2">
                    {c.external_slots.map((x) => (
                      <p key={x.start + x.end} dir="ltr" className="text-right">
                        {clock(x.start)}–{clock(x.end)}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="font-bold">توزيع ساعات الرياضيات المعتمد للمراجعة</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {teachers
            .filter((t) => proposal.payload.focus_instructor_ids.includes(t.id))
            .map((t) => (
              <button
                className="rounded border p-3 text-right hover:bg-muted"
                key={t.id}
                onClick={() => {
                  setInstructor(t.id);
                  setRoom("");
                  setCohort("");
                }}
              >
                <p className="font-medium">{t.name}</p>
                <p className="text-sm">
                  {t.hours} ساعة · {t.days.size} أيام
                </p>
              </button>
            ))}
        </div>
        <p className="text-sm text-muted-foreground">{proposal.payload.review_notes}</p>
      </Card>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-bold">إسناد كل محاضر — {teachers.length}</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr>
                <th className="p-2">المحاضر</th>
                <th>الساعات</th>
                <th>المحاضرات</th>
                <th>الأيام</th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="p-2">
                    <button
                      className="text-primary underline"
                      onClick={() => {
                        setInstructor(t.id);
                        setCohort("");
                        setRoom("");
                      }}
                    >
                      {t.name}
                    </button>
                  </td>
                  <td>{t.hours}</td>
                  <td>{t.sessions}</td>
                  <td>
                    {[...t.days]
                      .sort((a, b) => dayOrder(a) - dayOrder(b))
                      .map((d) => DAYS[d])
                      .join("، ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <Card className="space-y-4 p-4">
        <h2 className="font-bold">
          المحاضرات المقترحة — {visible.length} من {report.sessions.length}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3 print:hidden">
          <label className="text-sm">
            المحاضر
            <select
              aria-label="تصفية المحاضر"
              className="mt-1 w-full rounded border bg-background p-2"
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
            >
              <option value="">كل المحاضرين</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            الدفعة
            <select
              aria-label="تصفية الدفعة"
              className="mt-1 w-full rounded border bg-background p-2"
              value={cohort}
              onChange={(e) => setCohort(e.target.value)}
            >
              <option value="">كل الدفعات</option>
              {report.cohorts.map((c) => (
                <option key={c[0]} value={c[0]}>
                  {c[1]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            القاعة أو المعمل
            <select
              aria-label="تصفية القاعة"
              className="mt-1 w-full rounded border bg-background p-2"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
            >
              <option value="">كل القاعات والمعامل</option>
              {[...new Set(report.sessions.map((s) => s[17]))]
                .sort((a, b) => a.localeCompare(b, "ar", { numeric: true }))
                .map((r) => (
                  <option key={r}>{r}</option>
                ))}
            </select>
          </label>
        </div>
        {(instructor || cohort || room) && (
          <Button
            variant="outline"
            onClick={() => {
              setInstructor("");
              setCohort("");
              setRoom("");
            }}
          >
            عرض جميع المحاضرات
          </Button>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">اليوم والوقت</th>
                <th className="p-2">المقرر والمحاضر</th>
                <th className="p-2">الدفعة والمجموعة</th>
                <th className="p-2">القاعة</th>
                <th className="p-2">الطلاب / السعة</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s[0]} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap p-2">
                    <p>{DAYS[s[1]]}</p>
                    <p dir="ltr">
                      {clock(s[2])}–{clock(s[3])}
                    </p>
                  </td>
                  <td className="p-2">
                    <p className="font-medium">
                      {s[14]}{" "}
                      <span className="font-normal text-muted-foreground">
                        ({s[4] === "lab" ? "عملي" : "نظري"})
                      </span>
                    </p>
                    <p>{s[16]}</p>
                    {clashIds.has(s[0]) && (
                      <span className="text-xs text-amber-800 dark:text-amber-300">
                        تداخل خارجي للمراجعة
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    <p>{s[12]}</p>
                    <p>
                      {s[9] === "parallel" ? "موازي" : "عام"} · المستوى {s[10]} · {s[6]}
                    </p>
                    <p dir="ltr" className="text-right text-xs text-muted-foreground">
                      {s[8]}
                    </p>
                  </td>
                  <td className="p-2">{s[17]}</td>
                  <td className="p-2">
                    {s[5]} / {s[18]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && <p>لا توجد محاضرات تطابق هذه التصفية.</p>}
      </Card>
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-bold">
          فحوص الملف الأصلي — {proposal.payload.requirements.checks.length} بندًا
        </summary>
        <p className="my-3 text-sm text-muted-foreground">
          تخص هذه النتائج الملف المقترح وقيوده الداخلية. التداخلات الخارجية الحالية موضحة أعلى
          الصفحة وتحتاج معالجة مستقلة.
        </p>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {proposal.payload.requirements.checks.map((c) => (
            <li key={c.name}>
              {c.passed ? "✓" : "—"} {c.name}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
