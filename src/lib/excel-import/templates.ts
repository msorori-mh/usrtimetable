import type { TemplateDef } from "./types";

export const TEMPLATES: Record<string, TemplateDef> = {
  instructors: {
    entity: "instructors",
    label: "المحاضرون",
    sheetName: "instructors",
    uniqueKey: "employee_number",
    uniqueKeyLabel: "رقم الموظف",
    columns: [
      { key: "employee_number", header: "رقم_الموظف", required: true, example: "EMP001" },
      { key: "full_name", header: "الاسم_الكامل", required: true, example: "أحمد محمد" },
      { key: "full_name_ar", header: "الاسم_بالعربي", example: "أحمد محمد" },
      { key: "full_name_en", header: "الاسم_بالانجليزي", example: "Ahmed Mohamed" },
      { key: "email", header: "البريد_الالكتروني", example: "a@x.com" },
      { key: "phone", header: "الهاتف", example: "0555555555" },
      { key: "specialization", header: "التخصص", example: "أمن المعلومات" },
      { key: "academic_degree", header: "الدرجة_العلمية", example: "دكتوراه" },
      { key: "academic_rank", header: "الرتبة_الأكاديمية", example: "أستاذ مساعد" },
      { key: "instructor_type_code", header: "نوع_المحاضر_رمز", example: "PERM", enumValues: [] },
      { key: "department_code", header: "رمز_القسم", example: "CS" },
      { key: "employment_type", header: "نوع_التوظيف", example: "full_time", enumValues: ["full_time", "part_time", "visiting"] },
      { key: "max_weekly_hours", header: "أقصى_ساعات_أسبوعية", type: "number", example: "18" },
      { key: "max_hours_per_day", header: "أقصى_ساعات_يومية", type: "number", example: "6" },
      { key: "administrative_release_hours", header: "ساعات_إعفاء_إداري", type: "number", example: "0" },
      { key: "admin_tasks", header: "المهام_الإدارية", example: "" },
      { key: "external_source", header: "الجهة_الخارجية", example: "" },
      { key: "notes", header: "ملاحظات" },
      { key: "is_active", header: "نشط", type: "boolean", example: "true" },
    ],
  },
  rooms: {
    entity: "rooms",
    label: "القاعات والمختبرات",
    sheetName: "rooms",
    uniqueKey: "code",
    uniqueKeyLabel: "رمز القاعة",
    columns: [
      { key: "code", header: "رمز_القاعة", required: true, example: "R-101" },
      { key: "name", header: "اسم_القاعة", required: true, example: "قاعة 101" },
      { key: "capacity", header: "السعة", required: true, type: "number", example: "30" },
      { key: "room_type", header: "نوع_القاعة", example: "lecture_room" },
      { key: "room_type_code", header: "نوع_القاعة_رمز", example: "LEC" },
      { key: "building_code", header: "رمز_المبنى", example: "A" },
      { key: "floor", header: "الطابق", example: "1" },
      { key: "building", header: "المبنى_نص", example: "" },
      { key: "available_start_time", header: "متاح_من", type: "time", example: "08:00" },
      { key: "available_end_time", header: "متاح_إلى", type: "time", example: "14:00" },
      { key: "notes", header: "ملاحظات" },
      { key: "is_active", header: "نشط", type: "boolean", example: "true" },
    ],
  },
  academic_terms: {
    entity: "academic_terms",
    label: "الفصول الدراسية",
    sheetName: "terms",
    uniqueKey: "code",
    uniqueKeyLabel: "رمز الفصل",
    columns: [
      { key: "code", header: "الرمز", required: true, example: "2025-F" },
      { key: "name", header: "الاسم", required: true, example: "خريف 2025" },
      { key: "academic_year", header: "السنة_الأكاديمية", example: "2025-2026" },
      { key: "term_type", header: "نوع_الفصل", enumValues: ["fall", "spring", "summer"], example: "fall" },
      { key: "start_date", header: "تاريخ_البداية", example: "2025-09-01" },
      { key: "end_date", header: "تاريخ_النهاية", example: "2026-01-15" },
      { key: "teaching_weeks_count", header: "عدد_أسابيع_التدريس", type: "number", example: "15" },
      { key: "is_active", header: "نشط", type: "boolean", example: "false" },
    ],
  },
  daily_breaks: {
    entity: "daily_breaks",
    label: "الاستراحات اليومية",
    sheetName: "daily_breaks",
    uniqueKey: "name",
    uniqueKeyLabel: "الاسم",
    columns: [
      { key: "name", header: "الاسم", required: true, example: "استراحة الظهر" },
      { key: "start_time", header: "من_الساعة", required: true, type: "time", example: "12:00" },
      { key: "end_time", header: "إلى_الساعة", required: true, type: "time", example: "12:30" },
      { key: "days", header: "الأيام", type: "days_csv", example: "0,1,2,3,4", required: true },
      { key: "affects_scheduling", header: "يؤثر_على_الجدولة", type: "boolean", example: "true" },
    ],
  },
};

export async function buildTemplateWorkbook(entity: string): Promise<Blob> {
  const XLSX = await import("xlsx");
  const tpl = TEMPLATES[entity];
  if (!tpl) throw new Error("قالب غير معروف");
  const headers = tpl.columns.map((c) => c.header);
  const example = tpl.columns.map((c) => c.example ?? "");
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  ws["!cols"] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tpl.sheetName);
  // Add instructions sheet
  const notes = [
    ["تعليمات الاستيراد"],
    [""],
    [`الكيان: ${tpl.label}`],
    [`المفتاح الفريد: ${tpl.uniqueKeyLabel}`],
    [""],
    ["الأعمدة:"],
    ["الحقل", "العنوان", "إلزامي", "مثال", "قيم مسموحة"],
    ...tpl.columns.map((c) => [c.key, c.header, c.required ? "نعم" : "لا", c.example ?? "", (c.enumValues ?? []).join(" | ")]),
  ];
  const wsNotes = XLSX.utils.aoa_to_sheet(notes);
  wsNotes["!cols"] = [{ wch: 25 }, { wch: 22 }, { wch: 10 }, { wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsNotes, "تعليمات");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function parseExcel(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: false });
  const headers = json.length > 0 ? Object.keys(json[0]) : [];
  return { headers, rows: json };
}
