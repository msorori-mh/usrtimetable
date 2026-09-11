import { supabase } from "@/integrations/supabase/client";
import { buildTemplateWorkbook } from "@/lib/excel-import/templates";

/** Export only importable fields under the active college's existing read permissions. */
export async function buildCurrentInstructorWorkbook(collegeId: string): Promise<Blob> {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("instructors")
      .select(
        "employee_number, full_name, full_name_ar, full_name_en, email, phone, specialization, academic_degree, academic_rank, instructor_type_id, department_id, employment_type, max_weekly_hours, max_hours_per_day, administrative_release_hours, admin_tasks, external_source, notes, is_active",
      )
      .eq("college_id", collegeId)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    const departmentIds = [
      ...new Set(data.flatMap((row) => (row.department_id ? [row.department_id] : []))),
    ];
    const typeIds = [
      ...new Set(data.flatMap((row) => (row.instructor_type_id ? [row.instructor_type_id] : []))),
    ];
    const [departments, types] = await Promise.all([
      departmentIds.length
        ? supabase
            .from("departments")
            .select("id, code")
            .eq("college_id", collegeId)
            .in("id", departmentIds)
        : Promise.resolve({ data: [], error: null }),
      typeIds.length
        ? supabase
            .from("instructor_types")
            .select("id, code")
            .eq("college_id", collegeId)
            .in("id", typeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (departments.error) throw departments.error;
    if (types.error) throw types.error;
    const departmentCodes = new Map(departments.data?.map((d) => [d.id, d.code]));
    const typeCodes = new Map(types.data?.map((t) => [t.id, t.code]));
    for (const row of data) {
      if (row.department_id && !departmentCodes.get(row.department_id))
        throw new Error("أكمل رموز الأقسام قبل تنزيل كشف المدرسين للتحديث.");
      if (row.instructor_type_id && !typeCodes.get(row.instructor_type_id))
        throw new Error("أكمل رموز أنواع المدرسين قبل تنزيل الكشف للتحديث.");
      rows.push({
        ...row,
        department_code: row.department_id ? departmentCodes.get(row.department_id) : "",
        instructor_type_code: row.instructor_type_id ? typeCodes.get(row.instructor_type_id) : "",
      });
    }
    if (data.length < pageSize) break;
  }
  if (rows.length === 0)
    throw new Error("لا يوجد مدرسون في هذه الكلية بعد. نزّل القالب الفارغ لإضافتهم.");
  return buildTemplateWorkbook("instructors", rows);
}
