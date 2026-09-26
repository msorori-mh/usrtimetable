import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Tables } from "@/integrations/supabase/types";

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
  { name: "اللغة العربية", file: "جدول قسم اللغة العربية 2027.doc", levels: [18, 17, 17, 17] },
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

export function CollegeSourceTimetable({ rows, onBack }: { rows: Source[]; onBack: () => void }) {
  const [selected, setSelected] = useState<string>(DEPARTMENTS[0].file);
  const [level, setLevel] = useState<number | "all">("all");
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
          ظاهر هنا كما ورد في الملف، لكنه ليس جلسة تشغيلية محفوظة في المسودة. تصحيح مستويات أربع
          مواد في الدراسات الإسلامية مأخوذ من الحصر الذي زوّدته الكلية؛ يبقى المستوى الوارد في الملف
          ظاهراً بجانبه.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["ساعات الحصر بحسب الأقسام", "726"],
            ["ساعات صفوف الملفات، بما فيها الخدمات والتكرارات", String(totalImported)],
            ["صفوف المصادر", String(rows.length)],
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
                    <td className="border p-2">{duration(row)}</td>
                    <td className="border p-2">
                      {row.schedule_session_id ? "جلسة في المسودة" : "من الجدول، بانتظار الربط"}
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
