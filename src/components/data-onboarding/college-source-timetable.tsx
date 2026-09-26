import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

type Source = Tables<"existing_schedule_source_rows">;

// The figures supplied with the ten departmental timetables are a comparison
// baseline. The rows below always come from the imported files, not a study plan.
const DEPARTMENTS = [
  {
    name: "الجيولوجيا التطبيقية",
    file: "جدول قسم الجيولوجيا الفصل الاول 2026- 2027 (1).xlsx",
    levels: [24, 22, 32, 26],
  },
  {
    name: "علوم الحياة (الأحياء)",
    file: "جدول قسم علوم الحياة للفصل الأول2026-2027م.docx",
    levels: [22, 20, 24, 18],
  },
  {
    name: "الفيزياء",
    file: "جدول قسم الفيزياء للفصل الاول 1111 2027.docx",
    levels: [18, 20, 21, 19],
  },
  { name: "الكيمياء", file: "كيمياء.docx", levels: [19, 24, 18, 15] },
  {
    name: "القرآن الكريم وعلومه",
    file: "جدول_الفصل_الأول_2026_ـ_2027م-2.docx",
    levels: [20, 18, 18, 16],
  },
  {
    name: "اللغة الإنجليزية",
    file: "جدول انجليزي تربية فصل اول 2026- 2027-1.docx",
    levels: [19, 20, 16, 15],
  },
  {
    name: "الدراسات الإسلامية",
    file: "جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx",
    levels: [18, 22, 12, 18],
  },
  { name: "اللغة العربية", file: "جدول قسم اللغة العربية 2027.doc", levels: [16, 15, 19, 17] },
  {
    name: "معلم صف",
    file: "الجدول الدارسي الفصل الاول 27-نعمان_085037.xlsx",
    levels: [16, 16, 15, 14],
  },
  {
    name: "الرياضيات",
    file: "المعدل - جدول محاضرات الفصل الأول 2025-2026_١٠٢٦٥٤ (2)_٠٩٥١٥٥.docx",
    levels: [8, 12, 13, 9],
  },
] as const;

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const ISLAMIC_LEVEL_CORRECTIONS: Record<string, number> = {
  "EDU-2026F-ISL-R13-L2": 1, // العقيدة
  "EDU-2026F-ISL-R13-L3": 2, // علم البيان
  "EDU-2026F-ISL-R14-L3": 2, // فقه الأسرة
  "EDU-2026F-ISL-R19-L3": 2, // أصول الدعوة
};

function duration(row: Source): number {
  if (!row.start_time || !row.end_time) return 0;
  const [sh, sm] = row.start_time.split(":").map(Number);
  const [eh, em] = row.end_time.split(":").map(Number);
  return Math.max(0, eh + em / 60 - sh - sm / 60);
}

function sourceLevel(row: Source): number | null {
  return ISLAMIC_LEVEL_CORRECTIONS[row.source_id] ?? row.level_number;
}

function sourceRoomName(rawRoom: string | null): string | null {
  if (!rawRoom) return null;
  const compact = rawRoom.replace(/[\s.]/g, "");
  if (/^\d+$/.test(compact)) return `ق${compact}`;
  if (compact === "شط" || compact === "شطلاب") return "ق ش ط";
  if (compact === "مك") return "معمل الكيمياء";
  if (compact === "معملأحيا") return "معمل الأحياء";
  return rawRoom.trim();
}

function serviceLabel(row: Source): string | null {
  if (!row.notes?.startsWith("{")) return null;
  try {
    const note = JSON.parse(row.notes) as { raw_extraction?: { dept?: string } };
    const department = note.raw_extraction?.dept;
    if (row.source_file.includes("علوم الحياة") && department && department !== "علوم الحياة") {
      return `خدمة لبرنامج ${department}`;
    }
  } catch {
    // Some original notes have a human correction after the JSON body.
  }
  return null;
}

export function CollegeSourceTimetable({
  rows,
  onBack,
  published = false,
}: {
  rows: Source[];
  onBack: () => void;
  published?: boolean;
}) {
  const [selected, setSelected] = useState<string>(DEPARTMENTS[0].file);
  const [level, setLevel] = useState<number | "all">("all");
  const operational = useQuery({
    queryKey: ["education-source-operational-slots", "7430bad7-2de7-5c90-9368-b214a199d6c3"],
    enabled: rows.length > 0,
    queryFn: async () => {
      const [sessions, rooms] = await Promise.all([
        supabase
          .from("schedule_sessions")
          .select("id,day_of_week,start_time,end_time,room_id")
          .eq("schedule_version_id", "7430bad7-2de7-5c90-9368-b214a199d6c3"),
        supabase
          .from("rooms")
          .select("id,name")
          .eq("college_id", "1ee291b2-bec9-43d3-b42b-5a4f46946399"),
      ]);
      if (sessions.error) throw sessions.error;
      if (rooms.error) throw rooms.error;
      return {
        sessions: new Map((sessions.data ?? []).map((session) => [session.id, session])),
        rooms: new Map((rooms.data ?? []).map((room) => [room.id, room.name])),
      };
    },
  });
  const selectedDepartment = DEPARTMENTS.find((item) => item.file === selected)!;
  const sourceRows = rows.filter((row) => row.source_file === selected);
  const shown = sourceRows
    .filter((row) => level === "all" || sourceLevel(row) === level)
    .sort(
      (a, b) =>
        (sourceLevel(a) ?? 0) - (sourceLevel(b) ?? 0) ||
        (a.day_of_week ?? 7) - (b.day_of_week ?? 7) ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
        a.source_id.localeCompare(b.source_id),
    );
  const importedHours = sourceRows.reduce((sum, row) => sum + duration(row), 0);
  const baselineHours = selectedDepartment.levels.reduce((sum, hours) => sum + hours, 0);
  const totalImported = rows.reduce((sum, row) => sum + duration(row), 0);
  const linked = rows.filter((row) => row.schedule_session_id != null).length;
  const grouped = rows.filter((row) => row.delivery_group_id != null).length;
  const levelTotals = [0, 1, 2, 3].map((index) =>
    DEPARTMENTS.reduce((sum, department) => sum + department.levels[index], 0),
  );
  const collegeBaselineHours = levelTotals.reduce((sum, hours) => sum + hours, 0);

  return (
    <section className="space-y-4" aria-label="جدول الكلية حسب ملفات الأقسام">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">
            جدول الكلية حسب ملفات الأقسام — الفصل الأول 2026–2027
          </h2>
          <Button variant="outline" onClick={onBack}>
            العودة إلى الجداول القائمة
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          المواعيد والمدرسون والقاعات أدناه مأخوذون من ملفات الجداول المستوردة. صف «بانتظار الربط»
          ظاهر هنا كما ورد في الملف، لكنه ليس جلسة تشغيلية محفوظة في النسخة. تصحيح مستويات أربع مواد
          في الدراسات الإسلامية مأخوذ من الحصر الذي زوّدته الكلية؛ يبقى المستوى الوارد في الملف
          ظاهراً بجانبه. يظهر الموعد التشغيلي بجوار موعد الملف عند نقله لحل تعارض، وتظهر أسماء
          المدرسين التي تحتاج تحققاً بوصفها مؤقتة لهذا الفصل.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["ساعات الحصر بحسب الأقسام", String(collegeBaselineHours)],
            ["ساعات صفوف الملفات، بما فيها الخدمات والتكرارات", String(totalImported)],
            ["صفوف المصادر", String(rows.length)],
            ["صفوف مرتبطة بمجموعة", String(grouped)],
            ["صفوف مرتبطة بجلسة", String(linked)],
          ].map(([label, value]) => (
            <div className="rounded-lg border p-3" key={label}>
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-sm">{label}</div>
            </div>
          ))}
        </div>
        <p className="text-sm">
          يختلف جمع صفوف الملفات عن الحصر التجميعي بسبب الخدمات والتوازي واختلاف تفصيل بعض الملفات.
          لا تُضاف ساعات الصفوف غير المرتبطة إلى الساعات التشغيلية تلقائياً.
        </p>
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[760px] border-collapse text-right text-sm"
            aria-label="ملخص ساعات أقسام كلية التربية والعلوم"
          >
            <caption className="py-2 text-right font-semibold">
              إجمالي ساعات الأقسام والمستويات بحسب حصر الكلية
            </caption>
            <thead>
              <tr>
                {["القسم", "الأول", "الثاني", "الثالث", "الرابع", "إجمالي القسم", "صفوف الملف"].map(
                  (heading) => (
                    <th key={heading} scope="col" className="border p-2">
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {DEPARTMENTS.map((department) => {
                const fileHours = rows
                  .filter((row) => row.source_file === department.file)
                  .reduce((sum, row) => sum + duration(row), 0);
                return (
                  <tr key={department.file}>
                    <th scope="row" className="border p-2 font-medium">
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => {
                          setSelected(department.file);
                          setLevel("all");
                        }}
                      >
                        {department.name}
                      </button>
                    </th>
                    {department.levels.map((hours, index) => (
                      <td key={index} className="border p-2">
                        {hours}
                      </td>
                    ))}
                    <td className="border p-2 font-semibold">
                      {department.levels.reduce((sum, hours) => sum + hours, 0)}
                    </td>
                    <td className="border p-2">{fileHours}</td>
                  </tr>
                );
              })}
              <tr className="bg-muted/50 font-bold">
                <th scope="row" className="border p-2">
                  إجمالي الكلية
                </th>
                {levelTotals.map((hours, index) => (
                  <td key={index} className="border p-2">
                    {hours}
                  </td>
                ))}
                <td className="border p-2">{collegeBaselineHours}</td>
                <td className="border p-2">{totalImported}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-3">
          <label className="space-y-1 text-sm">
            <span className="block">القسم</span>
            <select
              aria-label="القسم في جدول المصدر"
              className="rounded border bg-background p-2"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                setLevel("all");
              }}
            >
              {DEPARTMENTS.map((department) => (
                <option key={department.file} value={department.file}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block">المستوى</span>
            <select
              aria-label="المستوى في جدول المصدر"
              className="rounded border bg-background p-2"
              value={level}
              onChange={(event) =>
                setLevel(event.target.value === "all" ? "all" : Number(event.target.value))
              }
            >
              <option value="all">جميع المستويات</option>
              {[1, 2, 3, 4].map((value) => (
                <option key={value} value={value}>
                  المستوى {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <span>
            ساعات القسم في الحصر: <strong>{baselineHours}</strong>
          </span>
          <span>
            ساعات صفوف ملف القسم: <strong>{importedHours}</strong>
          </span>
          <span>
            مرتبطة بجلسة:{" "}
            <strong>
              {sourceRows.filter((row) => row.schedule_session_id).length}/{sourceRows.length}
            </strong>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse text-right text-sm"
            aria-label={`جدول ${selectedDepartment.name} من ملف القسم`}
          >
            <thead>
              <tr>
                {[
                  "المستوى",
                  "المقرر",
                  "المدرس كما ورد",
                  "اليوم والوقت",
                  "القاعة",
                  published ? "الموعد في الجدول المنشور" : "الموعد في المسودة",
                  "الساعات",
                  "حالة الإدخال",
                ].map((heading) => (
                  <th className="border p-2" key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const corrected = sourceLevel(row) !== row.level_number;
                const service = serviceLabel(row);
                const session = row.schedule_session_id
                  ? operational.data?.sessions.get(row.schedule_session_id)
                  : undefined;
                const bookedRoom = session?.room_id
                  ? operational.data?.rooms.get(session.room_id)
                  : undefined;
                const moved =
                  session &&
                  (session.day_of_week !== row.day_of_week ||
                    session.start_time !== row.start_time ||
                    session.end_time !== row.end_time ||
                    (bookedRoom && sourceRoomName(row.raw_room) !== bookedRoom));
                return (
                  <tr key={row.id} data-source-id={row.source_id} className="align-top">
                    <td className="border p-2">
                      {sourceLevel(row)}
                      {corrected && (
                        <div className="text-xs text-muted-foreground">
                          في الملف: {row.level_number}
                        </div>
                      )}
                    </td>
                    <td className="border p-2">
                      {row.raw_course || "غير مذكور"}
                      {service && <div className="text-xs text-muted-foreground">{service}</div>}
                    </td>
                    <td className="border p-2">{row.raw_teacher || "غير مذكور"}</td>
                    <td className="border p-2">
                      {row.day_of_week == null ? row.raw_day : DAYS[row.day_of_week]}
                      <div dir="ltr">
                        {row.start_time?.slice(0, 5) ?? "—"}–{row.end_time?.slice(0, 5) ?? "—"}
                      </div>
                    </td>
                    <td className="border p-2">{row.raw_room || "غير مذكورة"}</td>
                    <td className="border p-2">
                      {session ? (
                        <>
                          {DAYS[session.day_of_week]}
                          <div dir="ltr">
                            {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}
                          </div>
                          <div>{bookedRoom ?? "القاعة قيد التحديد"}</div>
                          {moved && <div className="text-xs text-amber-700">نقل لحل تعارض</div>}
                        </>
                      ) : row.schedule_session_id ? (
                        "جارٍ تحميل الجلسة"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="border p-2">{duration(row)}</td>
                    <td className="border p-2">
                      {row.schedule_session_id
                        ? row.pending_reasons.length > 0
                          ? published
                            ? "جلسة منشورة استثنائياً؛ الاسم أو الإسناد بحاجة تحقق"
                            : "جلسة مؤقتة؛ الاسم أو الإسناد بحاجة تحقق"
                          : published
                            ? "جلسة في الجدول المنشور"
                            : "جلسة في المسودة"
                        : row.delivery_group_id
                          ? "مجموعة منشأة؛ موعد قيد المطابقة"
                          : "من الجدول، بانتظار الربط"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <p className="text-sm text-muted-foreground">لا توجد صفوف في الملف لهذا الاختيار.</p>
        )}
      </Card>
    </section>
  );
}
