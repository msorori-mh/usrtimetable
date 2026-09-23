import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { withUniversityNumbers } from "@/lib/instructors/university-number";
import { summarizeFacultySessions, type FacultyReport } from "@/lib/instructors/university-report";
import { FacultyIdentityLink } from "@/components/faculty-identity-link";
import { Button } from "@/components/ui/button";

type Api = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      get_faculty_university_report: {
        Args: {
          p_instructor_id: string;
          p_term_id: string;
          p_version_ids: string[];
        };
        Returns: FacultyReport;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
const api = supabase as unknown as SupabaseClient<Api>;
const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const cell = "border p-2 text-right";
export function FacultyUniversityReport() {
  const [instructor, setInstructor] = useState("");
  const [term, setTerm] = useState("");
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const choices = useQuery({
    queryKey: ["faculty-university-choices"],
    queryFn: async () => {
      const rows: { id: string; full_name: string; college_id: string }[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from("instructors")
          .select("id,full_name,college_id")
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
      }
      const [numbered, colleges, terms] = await Promise.all([
        withUniversityNumbers(rows),
        supabase.from("colleges").select("id,name"),
        supabase.from("academic_terms").select("id,name,academic_year,term_type,college_id"),
      ]);
      if (colleges.error) throw colleges.error;
      if (terms.error) throw terms.error;
      return {
        instructors: numbered,
        colleges: colleges.data ?? [],
        terms: terms.data ?? [],
      };
    },
  });
  const report = useQuery({
    queryKey: ["faculty-university-report", instructor, term, versions],
    enabled: !!instructor && !!term,
    queryFn: async () => {
      const { data, error } = await api.rpc("get_faculty_university_report", {
        p_instructor_id: instructor,
        p_term_id: term,
        p_version_ids: Object.values(versions).filter(Boolean),
      });
      if (error) throw error;
      return data;
    },
  });
  const data = report.data;
  const summary = summarizeFacultySessions(data?.sessions ?? []);
  const selectedVersionIds = data?.selected_version_ids ?? Object.values(versions);
  const chosen = choices.data?.instructors.find((i) => i.id === instructor);
  const changeInstructor = (id: string) => {
    setInstructor(id);
    setTerm("");
    setVersions({});
  };
  const scheduleColleges = [
    ...new Map((data?.versions ?? []).map((v) => [v.college_id, v.college])).entries(),
  ];
  return (
    <section dir="rtl" className="space-y-4 rounded-lg border bg-card p-4">
      <h1 className="text-xl font-bold">النصاب والجدول الجامعي الموحّد للمحاضر</h1>
      <p>
        يجمع السجلات المرتبطة بهوية جامعية معتمدة فقط. النصاب يُحتسب مرة واحدة، والساعات حسب قواعد
        الإسناد الحالية. تُعرض النسخة المنشورة لكل كلية تلقائيًا، أو نسخة التنسيق عند غيابها.
      </p>
      <div className="grid gap-3 md:grid-cols-3 print:hidden">
        <label>
          بحث بالاسم أو الرقم الجامعي
          <input
            className="w-full rounded border p-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          المحاضر
          <select
            aria-label="المحاضر للتقرير الجامعي"
            className="w-full rounded border p-2"
            value={instructor}
            onChange={(e) => changeInstructor(e.target.value)}
          >
            <option value="">اختر المحاضر</option>
            {(choices.data?.instructors ?? [])
              .filter(
                (i) =>
                  i.id === instructor ||
                  [i.full_name, i.university_number].join(" ").includes(search),
              )
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.full_name} — {i.university_number} —{" "}
                  {choices.data?.colleges.find((c) => c.id === i.college_id)?.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          الفصل الدراسي
          <select
            aria-label="الفصل للتقرير الجامعي"
            className="w-full rounded border p-2"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setVersions({});
            }}
          >
            <option value="">اختر الفصل</option>
            {(choices.data?.terms ?? [])
              .filter((t) => t.college_id === chosen?.college_id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      {choices.isLoading && <p>جارٍ تحميل دليل المحاضرين…</p>}
      {(choices.error || report.error) && (
        <p role="alert" className="text-destructive">
          تعذر عرض التقرير: {(choices.error ?? report.error)?.message}. يتطلب التجميع صلاحية الاطلاع
          على جميع الكليات المرتبطة وبيانات العام والفصل.
        </p>
      )}
      {report.isFetching && <p>جارٍ تحديث التقرير…</p>}
      {data && !report.isFetching && !report.error && (
        <>
          <h2 className="text-lg font-bold">
            {chosen?.full_name} — {data.university_number} — {data.academic_year}
          </h2>
          <p>
            السجلات المرتبطة: {data.members.map((m) => m.name + " (" + m.college + ")").join("، ")}
          </p>
          <div className="print:hidden">
            {chosen && (
              <FacultyIdentityLink
                instructorId={instructor}
                collegeId={chosen.college_id}
                name={chosen.full_name}
              />
            )}
          </div>
          {data.members.length === 1 && (
            <p>
              لا توجد سجلات أخرى مرتبطة بهذه الهوية حاليًا؛ لا تُضاف سجلات الأسماء المتشابهة
              تلقائيًا.
            </p>
          )}
          {data.quota_status !== "ok" && (
            <p role="status">
              {data.quota_status === "conflict"
                ? "الساعات الزائدة بانتظار توحيد بيانات النصاب المتعارضة بين السجلات"
                : "الساعات الزائدة بانتظار استكمال بيانات النصاب"}
            </p>
          )}
          {data.allocation_pending && (
            <p role="status">
              إجمالي الإسناد غير نهائي: توجد حصص مشتركة أو إسنادات تحتاج استكمالًا أو مراجعة. حساب
              الزيادة والعجز معلّق.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {[
                    "النصاب الجامعي",
                    "الساعات المسندة المحتسبة",
                    "إشراف المشاريع المنفصل",
                    "الساعات الزائدة",
                    "العجز",
                  ].map((s) => (
                    <th key={s} className={cell}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {[
                    data.quota,
                    data.assigned_hours,
                    data.project_hours,
                    data.overload,
                    data.deficit,
                  ].map((n, i) => (
                    <td key={i} className={cell}>
                      {n ?? "بانتظار الاستكمال"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {["الكلية", "الساعات المسندة", "إشراف المشاريع"].map((s) => (
                    <th key={s} className={cell}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.colleges.map((c) => (
                  <tr key={c.college_id}>
                    <td className={cell}>{c.college}</td>
                    <td className={cell}>{c.assigned_hours}</td>
                    <td className={cell}>{c.project_hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data.unscheduled?.length ?? 0) > 0 && (
            <section className="rounded border p-3">
              <h2 className="font-bold">إسنادات بانتظار التسكين في النسخ المعروضة</h2>
              <table className="w-full">
                <thead>
                  <tr>
                    {["الكلية", "المقرر", "المجموعة", "الساعات"].map((t) => (
                      <th className={cell} key={t}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.unscheduled?.map((a) => (
                    <tr key={a.id}>
                      <td className={cell}>{a.college}</td>
                      <td className={cell}>{a.course}</td>
                      <td className={cell}>{a.group_name ?? "—"}</td>
                      <td className={cell}>{a.hours ?? "غير محددة"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <h2 className="font-bold">الجدول الموحّد</h2>
          <div className="grid gap-3 md:grid-cols-2 print:hidden">
            {scheduleColleges.map(([id, name]) => (
              <label key={id}>
                {name}
                <select
                  aria-label={"نسخة جدول " + name}
                  className="w-full rounded border p-2"
                  value={
                    versions[id] ??
                    data.selected_version_ids?.find((v) =>
                      data.versions.some((s) => s.id === v && s.college_id === id),
                    ) ??
                    ""
                  }
                  onChange={(e) =>
                    setVersions({
                      ...Object.fromEntries(
                        data.versions
                          .filter((v) => selectedVersionIds.includes(v.id))
                          .map((v) => [v.college_id, v.id]),
                      ),
                      [id]: e.target.value,
                    })
                  }
                >
                  <option value="" disabled>
                    لم تتوفر نسخة معتمدة لهذه الكلية
                  </option>
                  {data.versions
                    .filter((v) => v.college_id === id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} — {v.status === "published" ? "منشورة" : "مسودة"}
                        {v.is_coordination ? " — تنسيق" : ""}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <p>
            النسخ المحددة:{" "}
            {data.versions
              .filter((v) => selectedVersionIds.includes(v.id))
              .map((v) => v.college + ": " + v.name)
              .join("؛ ") || "لم تُحدد نسخ بعد"}
          </p>
          {scheduleColleges.some(
            ([id]) =>
              !data.versions.some((v) => v.college_id === id && selectedVersionIds.includes(v.id)),
          ) && <p>الجدول جزئي حتى اختيار نسخة لكل كلية.</p>}
          <p>
            الساعات الزمنية في النسخ المحددة: نظري {summary.theory}، عملي {summary.practical}،
            الإجمالي {summary.total}. قد تختلف عن ساعات الإسناد المحتسبة، خصوصًا عند التدريس
            المشترك.
          </p>
          {summary.conflicts.length > 0 && (
            <div role="alert" className="text-destructive">
              تعارضات زمنية تحتاج المراجعة: {summary.conflicts.length}
              {summary.conflicts.map(([a, b]) => (
                <p key={a.id + b.id}>
                  {a.course} ({a.college}) مع {b.course} ({b.college}) — {days[a.day]}{" "}
                  {a.start.slice(0, 5)} / {b.start.slice(0, 5)}
                </p>
              ))}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {[
                    "اليوم",
                    "الوقت",
                    "الكلية",
                    "المقرر",
                    "البرنامج / المجموعة",
                    "النوع",
                    "النظام",
                    "القاعة",
                  ].map((s) => (
                    <th key={s} className={cell}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.sessions.map((s) => (
                  <tr key={s.id}>
                    {[
                      days[s.day],
                      s.start.slice(0, 5) + "–" + s.end.slice(0, 5),
                      s.college,
                      s.course,
                      [s.program, s.group_name].filter(Boolean).join(" / ") || "—",
                      s.type === "lab" ? "عملي" : "نظري",
                      s.study_system === "parallel" ? "موازي" : "عام",
                      s.room ?? "غير محددة",
                    ].map((v, i) => (
                      <td key={i} className={cell}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button className="print:hidden" onClick={() => window.print()}>
            طباعة التقرير والجدول الموحّد
          </Button>
        </>
      )}
    </section>
  );
}
