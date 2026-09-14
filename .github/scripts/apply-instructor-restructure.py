from __future__ import annotations

from pathlib import Path
import re
import textwrap

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    text = read(path)
    new, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: regex anchor not found: {pattern[:160]!r}")
    write(path, new)


# ---------------------------------------------------------------------------
# 1) Shared import/template contract
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/excel-import/types.ts",
    '  /** Previous user-facing headers accepted on import after a display-name change. */\n  headerAliases?: string[];\n',
    '  /** Previous user-facing headers accepted on import after a display-name change. */\n'
    '  headerAliases?: string[];\n'
    '  /** Accepted by import validation but omitted from newly generated templates. */\n'
    '  templateHidden?: boolean;\n',
)

TEMPLATE_COLUMNS = '''
    columns: [
      {
        key: "instructor_type_code",
        header: "فئة_المحاضر_رمز",
        headerAliases: ["نوع_المحاضر_رمز"],
        required: true,
        example: "permanent",
      },
      { key: "employee_number", header: "رقم_الموظف", example: "EMP001" },
      {
        key: "full_name",
        header: "الاسم_الافتراضي",
        headerAliases: ["اسم المدرس", "الاسم الكامل", "اسم المحاضر"],
        required: true,
        example: "أحمد محمد",
      },
      {
        key: "full_name_ar",
        header: "الاسم_الرباعي",
        headerAliases: ["الاسم_بالعربي", "الاسم بالعربية"],
        example: "أحمد محمد علي عبدالله",
      },
      {
        key: "affiliation_college_code",
        header: "كلية_التبعية_رمز",
        required: true,
        example: "ITCS",
      },
      {
        key: "affiliation_department_code",
        header: "قسم_التبعية_رمز",
        required: true,
        example: "CS",
      },
      {
        key: "specialization",
        header: "التخصص",
        headerAliases: ["القسم", "القسم (التخصص)"],
        example: "نظم المعلومات الحاسوبية",
      },
      {
        key: "academic_rank",
        header: "الرتبة_العلمية",
        headerAliases: ["الرتبة الأكاديمية"],
        example: "أستاذ مساعد",
      },
      {
        key: "max_weekly_hours",
        header: "النصاب_الأساسي_الأسبوعي",
        headerAliases: ["النصاب الأسبوعي (ساعة)", "النصاب الأسبوعي", "أقصى ساعات أسبوعية"],
        type: "number",
        required: true,
        example: "18",
      },
      {
        key: "administrative_release_hours",
        header: "ساعات_الإعفاء_الإداري",
        headerAliases: ["ساعات_إعفاء_إداري"],
        type: "number",
        example: "0",
      },
      {
        key: "administrative_position",
        header: "المنصب_الإداري",
        example: "department_head",
      },
      {
        key: "administrative_department_code",
        header: "قسم_الرئاسة_رمز",
        example: "CS",
      },
      {
        key: "employment_type",
        header: "حالة_التفرغ_التعاقد",
        headerAliases: ["نوع_التوظيف"],
        example: "full_time",
        enumValues: [...EMPLOYMENT_TYPE_IMPORT_VALUES],
      },
      {
        key: "email",
        header: "البريد_الإلكتروني",
        headerAliases: ["البريد_الالكتروني"],
        example: "a@x.com",
      },
      {
        key: "phone",
        header: "التلفون_الواتساب",
        headerAliases: ["الهاتف", "الجوال"],
        example: "777000000",
      },
      {
        key: "is_active",
        header: "نشط",
        headerAliases: ["الحالة"],
        type: "boolean",
        example: "true",
      },

      // Legacy compatibility: accepted on upload, never emitted by the new template.
      { key: "department_code", header: "رمز_القسم", templateHidden: true },
      { key: "full_name_en", header: "الاسم_بالانجليزي", templateHidden: true },
      { key: "academic_degree", header: "الدرجة_العلمية", templateHidden: true },
      { key: "max_hours_per_day", header: "أقصى_ساعات_يومية", type: "number", templateHidden: true },
      { key: "admin_tasks", header: "الصفة", templateHidden: true },
      { key: "external_source", header: "الجهة_الخارجية", templateHidden: true },
      { key: "notes", header: "ملاحظات", templateHidden: true },
    ],
'''
regex_once(
    "src/lib/excel-import/templates.ts",
    r'    columns: \[\n.*?\n    \],\n  \},\n  rooms:',
    TEMPLATE_COLUMNS + '  },\n  rooms:',
    re.S,
)

# Newly generated template shows only visible columns; validators keep hidden legacy columns.
replace_once(
    "src/lib/excel-import/templates.ts",
    '  const headers = tpl.columns.map((c) => c.header);\n',
    '  const visibleColumns = tpl.columns.filter((c) => !c.templateHidden);\n'
    '  const headers = visibleColumns.map((c) => c.header);\n',
)
replace_once(
    "src/lib/excel-import/templates.ts",
    '  const sample = tpl.columns.map((c) => escapeSpreadsheetCell(c.example ?? ""));\n',
    '  const sample = visibleColumns.map((c) => escapeSpreadsheetCell(c.example ?? ""));\n',
)
replace_once(
    "src/lib/excel-import/templates.ts",
    '  tpl.columns.forEach((c, idx) => {\n',
    '  visibleColumns.forEach((c, idx) => {\n',
)
replace_once(
    "src/lib/excel-import/templates.ts",
    '    ...tpl.columns.map((c) => [\n',
    '    ...visibleColumns.map((c) => [\n',
)

# Update instructor-template help text to the new contract.
regex_once(
    "src/lib/excel-import/templates.ts",
    r'  if \(entity === "instructors"\) \{\n    notes\.push\(.*?\n    \);\n  \}',
    '''  if (entity === "instructors") {
    notes.push(
      ["فئة_المحاضر_رمز", "استخدم كود الفئة المعتمد؛ فئة متعاقد بالساعات تستخدم con."],
      ["رقم_الموظف", "مطلوب لكل الفئات عدا con. للمتعاقد بالساعات يمكن تركه فارغًا؛ المطابقة بالاسم تكون آمنة وتفشل عند الالتباس."],
      ["كلية_التبعية_رمز", "اختر رمز كلية من كليات الجامعة. لا يفترض الاستيراد أنها الكلية التشغيلية الحالية."],
      ["قسم_التبعية_رمز", "يجب أن يكون القسم تابعًا لكلية التبعية المختارة."],
      ["النصاب_الأساسي_الأسبوعي", "القيمة الأساسية قبل الإعفاء الإداري؛ النصاب الفعلي يحسب آليًا بطرح ساعات الإعفاء."],
      ["المنصب_الإداري", "القيم: department_head / vice_dean_academic / vice_dean_student_affairs / dean، أو التسميات العربية المقابلة."],
      ["قسم_الرئاسة_رمز", "مطلوب فقط عند اختيار رئيس قسم، ويجب أن يتبع كلية التبعية."],
      ["التوافق", "تُقبل عناوين القالب السابق الأساسية عبر aliases، وتظل الحقول القديمة المخفية قابلة للقراءة عند وجودها."],
    );
  }''',
    re.S,
)

# ---------------------------------------------------------------------------
# 2) Instructor sheet normalization and conditional requirements
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    'import { ACADEMIC_RANKS, UNKNOWN_EMPLOYMENT_TYPE } from "../instructor-metadata";\n',
    'import { ACADEMIC_RANKS, UNKNOWN_EMPLOYMENT_TYPE } from "../instructor-metadata";\n'
    'import { isHourlyContractTypeCode } from "@/lib/instructors/effective-hours";\n'
    'import {\n'
    '  normalizeAdministrativePosition,\n'
    '  requiresAdministrativeDepartment,\n'
    '} from "@/lib/instructors/administrative-positions";\n',
)
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    '  full_name: ["اسم المدرس", "الاسم الكامل", "اسم المحاضر"],\n'
    '  specialization: ["القسم", "القسم (التخصص)", "التخصص"],\n'
    '  max_weekly_hours: ["النصاب الأسبوعي (ساعة)", "النصاب الأسبوعي", "أقصى ساعات أسبوعية"],\n'
    '  academic_rank: ["الرتبة الأكاديمية"],\n'
    '  admin_tasks: ["الصفة", "المهام الإدارية"],\n'
    '  is_active: ["الحالة", "نشط"],\n',
    '  full_name: ["اسم المدرس", "الاسم الكامل", "اسم المحاضر", "الاسم الافتراضي"],\n'
    '  full_name_ar: ["الاسم بالعربية", "الاسم الرباعي"],\n'
    '  specialization: ["القسم", "القسم (التخصص)", "التخصص"],\n'
    '  max_weekly_hours: ["النصاب الأسبوعي (ساعة)", "النصاب الأسبوعي", "أقصى ساعات أسبوعية"],\n'
    '  academic_rank: ["الرتبة الأكاديمية", "الرتبة العلمية"],\n'
    '  instructor_type_code: ["نوع المحاضر رمز", "فئة المحاضر رمز"],\n'
    '  affiliation_college_code: ["كلية التبعية رمز"],\n'
    '  affiliation_department_code: ["قسم التبعية رمز"],\n'
    '  administrative_department_code: ["قسم الرئاسة رمز"],\n'
    '  employment_type: ["نوع التوظيف", "حالة التفرغ التعاقد"],\n'
    '  email: ["البريد الالكتروني", "البريد الإلكتروني"],\n'
    '  phone: ["الهاتف", "الجوال", "التلفون الواتساب"],\n'
    '  admin_tasks: ["الصفة", "المهام الإدارية"],\n'
    '  is_active: ["الحالة", "نشط"],\n',
)
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    '[c.header, c.key, ...(ALIASES[c.key] ?? [])].some((h) => headerKey(h) === key),\n',
    '[c.header, c.key, ...(c.headerAliases ?? []), ...(ALIASES[c.key] ?? [])].some(\n'
    '      (h) => headerKey(h) === key,\n'
    '    ),\n',
)
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    'export interface ExistingInstructor extends Record<string, unknown> {\n'
    '  employee_number: string | null;\n'
    '  full_name: string;\n'
    '  full_name_ar?: string | null;\n'
    '}\n',
    'export interface ExistingInstructor extends Record<string, unknown> {\n'
    '  employee_number: string | null;\n'
    '  full_name: string;\n'
    '  full_name_ar?: string | null;\n'
    '  affiliation_college_id?: string | null;\n'
    '  affiliation_department_id?: string | null;\n'
    '  administrative_position?: string | null;\n'
    '  administrative_department_id?: string | null;\n'
    '}\n',
)
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    '  const v = row.values;\n  const errors: RowError[] = [];\n',
    '  const v = row.values;\n'
    '  const hourlyContract = isHourlyContractTypeCode(String(v.instructor_type_code ?? ""));\n'
    '  const errors: RowError[] = [];\n',
)
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    '  if (!employee) {\n'
    '    if (current?.employee_number) {\n'
    '      v.employee_number = current.employee_number;\n'
    '      v._matched_by_name = true;\n'
    '    } else\n'
    '      fail(\n'
    '        "employee_number",\n'
    '        "instructor_employee_number_required",\n'
    '        "تعذر تحديد رقم موظف فريد من الكلية الحالية. أدخل رقم الموظف؛ عمود م تسلسلي فقط.",\n'
    '      );\n'
    '  }\n',
    '  if (!employee) {\n'
    '    if (!hourlyContract && current?.employee_number) {\n'
    '      v.employee_number = current.employee_number;\n'
    '      v._matched_by_name = true;\n'
    '    } else if (!hourlyContract)\n'
    '      fail(\n'
    '        "employee_number",\n'
    '        "instructor_employee_number_required",\n'
    '        "رقم الموظف مطلوب لكل الفئات عدا متعاقد بالساعات (con).",\n'
    '      );\n'
    '  }\n',
)
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    '  for (const key of ["max_weekly_hours", "max_hours_per_day", "administrative_release_hours"]) {\n',
    '  for (const key of ["max_weekly_hours", "max_hours_per_day", "administrative_release_hours"]) {\n',
)
# Insert structured admin normalization before legacy specialization→department fallback.
replace_once(
    "src/lib/excel-import/instructor-sheet.ts",
    '  if (!v._department_id && !v.department_code && v.specialization) {\n',
    '  if (hourlyContract) {\n'
    '    v.administrative_release_hours = 0;\n'
    '    v.administrative_position = null;\n'
    '    v.administrative_department_code = null;\n'
    '  } else if (v.administrative_position) {\n'
    '    const normalizedPosition = normalizeAdministrativePosition(v.administrative_position);\n'
    '    if (!normalizedPosition)\n'
    '      fail(\n'
    '        "administrative_position",\n'
    '        "invalid_administrative_position",\n'
    '        "المنصب الإداري غير معروف. استخدم رئيس قسم، نائب العميد للشؤون الأكاديمية، نائب العميد لشؤون الطلاب، أو عميد الكلية.",\n'
    '      );\n'
    '    else {\n'
    '      v.administrative_position = normalizedPosition;\n'
    '      if (requiresAdministrativeDepartment(normalizedPosition) && !v.administrative_department_code)\n'
    '        fail(\n'
    '          "administrative_department_code",\n'
    '          "administrative_department_required",\n'
    '          "قسم الرئاسة مطلوب عند اختيار رئيس قسم.",\n'
    '        );\n'
    '      if (!requiresAdministrativeDepartment(normalizedPosition))\n'
    '        v.administrative_department_code = null;\n'
    '    }\n'
    '  }\n'
    '  if (!v._department_id && !v.department_code && v.specialization) {\n',
)

# ---------------------------------------------------------------------------
# 3) Import validator lookups across the university and affiliation resolution
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/excel-import/validators.ts",
    'import { normalizeEmploymentType } from "@/lib/instructor-metadata";\n',
    'import { normalizeEmploymentType } from "@/lib/instructor-metadata";\n'
    'import { isHourlyContractTypeCode } from "@/lib/instructors/effective-hours";\n'
    'import {\n'
    '  normalizeAdministrativePosition,\n'
    '  requiresAdministrativeDepartment,\n'
    '} from "@/lib/instructors/administrative-positions";\n',
)
replace_once(
    "src/lib/excel-import/validators.ts",
    '  instructorTypes?: Map<string, string>;\n'
    '  roomTypes?: Map<string, string>;\n',
    '  instructorTypes?: Map<string, string>;\n'
    '  instructorTypeCodesById?: Map<string, string>;\n'
    '  affiliationColleges?: Map<string, { id: string; university_id: string }>;\n'
    '  affiliationDepartments?: Map<string, { id: string; college_id: string }>;\n'
    '  operationalCollegeCode?: string | null;\n'
    '  roomTypes?: Map<string, string>;\n',
)
# Replace the instructors lookup block.
regex_once(
    "src/lib/excel-import/validators.ts",
    r'  if \(entity === "instructors"\) \{\n.*?\n  \}\n  if \(entity === "rooms"\)',
    '''  if (entity === "instructors") {
    const fetchInstructorCatalog = async (
      table: "instructors" | "instructor_types" | "departments",
    ) => {
      const result: Record<string, any>[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .eq("college_id", collegeId)
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        result.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return result;
    };
    const [it, dp, instructors, activeCollege] = await Promise.all([
      fetchInstructorCatalog("instructor_types"),
      fetchInstructorCatalog("departments"),
      fetchInstructorCatalog("instructors"),
      supabase.from("colleges").select("id, code, university_id").eq("id", collegeId).single(),
    ]);
    if (activeCollege.error) throw activeCollege.error;
    const universityId = activeCollege.data.university_id;
    const { data: collegeRows, error: collegeError } = await supabase
      .from("colleges")
      .select("id, code, university_id")
      .eq("university_id", universityId);
    if (collegeError) throw collegeError;
    const universityCollegeIds = (collegeRows ?? []).map((c) => c.id);
    const { data: affiliationDepartmentRows, error: affiliationDepartmentError } =
      universityCollegeIds.length > 0
        ? await supabase
            .from("departments")
            .select("id, code, college_id")
            .in("college_id", universityCollegeIds)
        : { data: [], error: null };
    if (affiliationDepartmentError) throw affiliationDepartmentError;

    lk.instructorTypes = new Map(
      it.map((r) => [String(r.code).trim().toLowerCase(), String(r.id)]),
    );
    lk.instructorTypeCodesById = new Map(
      it.map((r) => [String(r.id), String(r.code).trim().toLowerCase()]),
    );
    lk.departments = new Map(dp.map((r) => [String(r.code), String(r.id)]));
    lk.instructorDepartments = dp.map((r) => ({ id: r.id, name: r.name }));
    lk.instructorRecords = instructors as ExistingInstructor[];
    lk.operationalCollegeCode = activeCollege.data.code ?? null;
    lk.affiliationColleges = new Map(
      (collegeRows ?? [])
        .filter((c) => c.code)
        .map((c) => [String(c.code).trim().toLowerCase(), { id: c.id, university_id: c.university_id }]),
    );
    lk.affiliationDepartments = new Map(
      (affiliationDepartmentRows ?? [])
        .filter((d) => d.code)
        .map((d) => [
          `${d.college_id}|${String(d.code).trim().toLowerCase()}`,
          { id: d.id, college_id: d.college_id },
        ]),
    );
  }
  if (entity === "rooms")''',
    re.S,
)
# Allow the legacy instructor shape to omit new affiliation columns.
replace_once(
    "src/lib/excel-import/validators.ts",
    '  const headerSet = new Set(trimmed);\n  const missingHeaders = tpl.columns\n',
    '  const headerSet = new Set(trimmed);\n'
    '  const legacyInstructorShape =\n'
    '    entity === "instructors" &&\n'
    '    headerSet.has("رمز_القسم") &&\n'
    '    !headerSet.has("كلية_التبعية_رمز");\n'
    '  const missingHeaders = tpl.columns\n',
)
replace_once(
    "src/lib/excel-import/validators.ts",
    '        c.required &&\n'
    '        !(entity === "instructors" && c.key === "employee_number") &&\n'
    '        !headerSet.has(c.header),\n',
    '        c.required &&\n'
    '        !(entity === "instructors" && c.key === "employee_number") &&\n'
    '        !(\n'
    '          legacyInstructorShape &&\n'
    '          (c.key === "affiliation_college_code" || c.key === "affiliation_department_code")\n'
    '        ) &&\n'
    '        !headerSet.has(c.header),\n',
)
# Conditional per-row required rule keeps legacy rows compatible.
replace_once(
    "src/lib/excel-import/validators.ts",
    '        c.required &&\n'
    '        (row.values[c.key] === null || row.values[c.key] === undefined || row.values[c.key] === "")\n'
    '      ) {\n',
    '        c.required &&\n'
    '        (row.values[c.key] === null || row.values[c.key] === undefined || row.values[c.key] === "") &&\n'
    '        !(\n'
    '          entity === "instructors" &&\n'
    '          row.values.department_code &&\n'
    '          (c.key === "affiliation_college_code" || c.key === "affiliation_department_code")\n'
    '        )\n'
    '      ) {\n',
)
# Replace instructor resolution section with affiliation-aware rules.
regex_once(
    "src/lib/excel-import/validators.ts",
    r'    if \(entity === "instructors"\) \{\n      const itCode = row\.values\.instructor_type_code.*?\n    \}\n    if \(entity === "rooms"\)',
    '''    if (entity === "instructors") {
      const rawTypeCode = String(row.values.instructor_type_code ?? "").trim();
      const typeCode = rawTypeCode.toLowerCase();
      const typeId = typeCode ? lk.instructorTypes?.get(typeCode) : null;
      if (typeCode) {
        if (!typeId)
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: "فئة_المحاضر_رمز",
            errorCode: "unknown_instructor_type",
            message: `نوع محاضر غير معروف: ${rawTypeCode}`,
            rawValue: rawTypeCode,
          });
        else row.values._instructor_type_id = typeId;
      }
      const hourlyContract = isHourlyContractTypeCode(typeCode);
      if (!hourlyContract && !String(row.values.employee_number ?? "").trim()) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "رقم_الموظف",
          errorCode: "instructor_employee_number_required",
          message: "رقم الموظف مطلوب لكل الفئات عدا متعاقد بالساعات (con).",
        });
      }

      const legacyDepartmentCode = String(row.values.department_code ?? "").trim();
      const affiliationCollegeCode = String(
        row.values.affiliation_college_code ?? lk.operationalCollegeCode ?? "",
      )
        .trim()
        .toLowerCase();
      const affiliationCollege = affiliationCollegeCode
        ? lk.affiliationColleges?.get(affiliationCollegeCode)
        : null;
      if (!affiliationCollege) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "كلية_التبعية_رمز",
          errorCode: "unknown_affiliation_college",
          message: `كلية تبعية غير معروفة: ${row.values.affiliation_college_code ?? ""}`,
          rawValue: String(row.values.affiliation_college_code ?? ""),
        });
      } else {
        row.values._affiliation_college_id = affiliationCollege.id;
      }

      const affiliationDepartmentCode = String(
        row.values.affiliation_department_code ?? legacyDepartmentCode,
      )
        .trim()
        .toLowerCase();
      const affiliationDepartment =
        affiliationCollege && affiliationDepartmentCode
          ? lk.affiliationDepartments?.get(`${affiliationCollege.id}|${affiliationDepartmentCode}`)
          : null;
      if (!affiliationDepartment) {
        rowErrors.push({
          rowNumber: row.rowNumber,
          columnName: "قسم_التبعية_رمز",
          errorCode: "unknown_affiliation_department",
          message: "قسم التبعية غير معروف أو لا يتبع كلية التبعية المختارة.",
          rawValue: String(row.values.affiliation_department_code ?? legacyDepartmentCode ?? ""),
        });
      } else {
        row.values._affiliation_department_id = affiliationDepartment.id;
        // Scheduling ownership remains in the operational college. Sync its department only
        // when the HR affiliation is the same college; otherwise preserve/null operational dept.
        if (affiliationCollege?.id === collegeId) row.values._department_id = affiliationDepartment.id;
      }

      if (legacyDepartmentCode && !row.values._department_id) {
        const operationalDepartmentId = lk.departments?.get(legacyDepartmentCode);
        if (operationalDepartmentId) row.values._department_id = operationalDepartmentId;
      }

      if (hourlyContract) {
        row.values.administrative_release_hours = 0;
        row.values.administrative_position = null;
        row.values._administrative_department_id = null;
      } else {
        const rawPosition = row.values.administrative_position;
        const normalizedPosition = rawPosition ? normalizeAdministrativePosition(rawPosition) : null;
        if (rawPosition && !normalizedPosition) {
          rowErrors.push({
            rowNumber: row.rowNumber,
            columnName: "المنصب_الإداري",
            errorCode: "invalid_administrative_position",
            message: "المنصب الإداري غير معروف.",
            rawValue: String(rawPosition),
          });
        }
        row.values.administrative_position = normalizedPosition;
        if (requiresAdministrativeDepartment(normalizedPosition)) {
          const adminCode = String(row.values.administrative_department_code ?? "")
            .trim()
            .toLowerCase();
          const adminDepartment =
            affiliationCollege && adminCode
              ? lk.affiliationDepartments?.get(`${affiliationCollege.id}|${adminCode}`)
              : null;
          if (!adminDepartment)
            rowErrors.push({
              rowNumber: row.rowNumber,
              columnName: "قسم_الرئاسة_رمز",
              errorCode: "administrative_department_required",
              message: "قسم الرئاسة مطلوب لرئيس القسم ويجب أن يتبع كلية التبعية.",
              rawValue: String(row.values.administrative_department_code ?? ""),
            });
          else row.values._administrative_department_id = adminDepartment.id;
        } else row.values._administrative_department_id = null;
      }
    }
    if (entity === "rooms")''',
    re.S,
)

# ---------------------------------------------------------------------------
# 4) Manual instructor form and HR affiliation
# ---------------------------------------------------------------------------
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    'import { useActiveCollege } from "@/hooks/use-colleges";\n',
    'import { useAccessibleColleges, useActiveCollege } from "@/hooks/use-colleges";\n',
)
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '} from "@/lib/instructor-metadata";\n',
    '} from "@/lib/instructor-metadata";\n'
    'import {\n'
    '  effectiveInstructorWeeklyHours,\n'
    '  EFFECTIVE_QUOTA_FORMULA_AR,\n'
    '  isHourlyContractTypeCode,\n'
    '} from "@/lib/instructors/effective-hours";\n'
    'import {\n'
    '  ADMINISTRATIVE_POSITION_OPTIONS,\n'
    '  requiresAdministrativeDepartment,\n'
    '} from "@/lib/instructors/administrative-positions";\n',
)
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '  instructor_type_id: string | null;\n}\n',
    '  instructor_type_id: string | null;\n'
    '  affiliation_college_id: string | null;\n'
    '  affiliation_department_id: string | null;\n'
    '  administrative_position: string | null;\n'
    '  administrative_department_id: string | null;\n'
    '}\n',
)
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '    instructor_type_id: "",\n  };\n}\n',
    '    instructor_type_id: "",\n'
    '    affiliation_college_id: "",\n'
    '    affiliation_department_id: "",\n'
    '    administrative_position: "",\n'
    '    administrative_department_id: "",\n'
    '  };\n}\n',
)
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '  const { active } = useActiveCollege();\n  const { review } = Route.useSearch();\n',
    '  const { active } = useActiveCollege();\n'
    '  const { data: accessibleColleges } = useAccessibleColleges();\n'
    '  const { review } = Route.useSearch();\n',
)
# Add affiliation departments query before instructor row query.
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '  const {\n    data: rows,\n',
    '  const affiliationCollegeId = form.affiliation_college_id || active?.id || "";\n'
    '  const { data: affiliationDepts } = useQuery({\n'
    '    queryKey: ["instructor-affiliation-depts", affiliationCollegeId],\n'
    '    enabled: !!affiliationCollegeId,\n'
    '    queryFn: async () => {\n'
    '      const { data, error } = await supabase\n'
    '        .from("departments")\n'
    '        .select("id, name, code, college_id")\n'
    '        .eq("college_id", affiliationCollegeId)\n'
    '        .order("name");\n'
    '      if (error) throw error;\n'
    '      return data ?? [];\n'
    '    },\n'
    '  });\n\n'
    '  const {\n    data: rows,\n',
)
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '          "id, college_id, department_id, full_name, academic_rank, email, phone, employment_type, max_weekly_hours, is_active, employee_number, full_name_ar, full_name_en, specialization, administrative_release_hours, notes, admin_tasks, instructor_type_id",\n',
    '          "id, college_id, department_id, full_name, academic_rank, email, phone, employment_type, max_weekly_hours, is_active, employee_number, full_name_ar, full_name_en, specialization, administrative_release_hours, notes, admin_tasks, instructor_type_id, affiliation_college_id, affiliation_department_id, administrative_position, administrative_department_id",\n',
)
# Replace validation/payload portion of save mutation.
regex_once(
    "src/routes/_authenticated/instructors.tsx",
    r'      if \(!form\.full_name\.trim\(\)\) throw new Error\("الاسم مطلوب"\);\n      const payload = \{.*?\n      \};',
    '''      if (!form.full_name.trim()) throw new Error("الاسم مطلوب");
      const selectedType = ((types ?? []) as InstructorTypeRow[]).find(
        (t) => t.id === form.instructor_type_id,
      );
      const hourlyContract = isHourlyContractTypeCode(selectedType?.code);
      if (!hourlyContract && !form.employee_number.trim())
        throw new Error("رقم الموظف مطلوب للموظف غير المتعاقد بالساعات");
      if (!form.affiliation_college_id) throw new Error("اختر الكلية التابع لها المحاضر");
      if (!form.affiliation_department_id) throw new Error("اختر القسم التابع له المحاضر");
      const affiliationDepartment = (affiliationDepts ?? []).find(
        (d) => d.id === form.affiliation_department_id,
      );
      if (!affiliationDepartment || affiliationDepartment.college_id !== form.affiliation_college_id)
        throw new Error("القسم المحدد لا يتبع كلية التبعية المختارة");
      if (
        !hourlyContract &&
        requiresAdministrativeDepartment(form.administrative_position) &&
        !form.administrative_department_id
      )
        throw new Error("اختر القسم الذي يرأسه المحاضر");
      if (
        form.administrative_department_id &&
        !(affiliationDepts ?? []).some((d) => d.id === form.administrative_department_id)
      )
        throw new Error("قسم الرئاسة يجب أن يتبع كلية التبعية المختارة");

      const operationalDepartmentId =
        form.affiliation_college_id === active.id
          ? form.affiliation_department_id || null
          : editing?.department_id ?? null;
      const releaseHours = hourlyContract ? 0 : Number(form.administrative_release_hours) || 0;
      const payload = {
        full_name: form.full_name.trim(),
        full_name_ar: form.full_name_ar.trim() || form.full_name.trim(),
        // Hidden legacy fields are preserved on edit rather than erased from DB.
        full_name_en: form.full_name_en.trim() || editing?.full_name_en || null,
        employee_number: hourlyContract
          ? editing?.employee_number ?? null
          : form.employee_number.trim() || null,
        specialization: form.specialization.trim() || null,
        academic_rank: form.academic_rank || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        department_id: operationalDepartmentId,
        employment_type: form.employment_type || UNKNOWN_EMPLOYMENT_TYPE,
        max_weekly_hours: Number(form.max_weekly_hours) || 0,
        administrative_release_hours: releaseHours,
        notes: editing?.notes ?? (form.notes.trim() || null),
        admin_tasks: editing?.admin_tasks ?? (form.admin_tasks.trim() || null),
        is_active: form.is_active,
        instructor_type_id: form.instructor_type_id || null,
        affiliation_college_id: form.affiliation_college_id,
        affiliation_department_id: form.affiliation_department_id,
        administrative_position: hourlyContract ? null : form.administrative_position || null,
        administrative_department_id:
          !hourlyContract && requiresAdministrativeDepartment(form.administrative_position)
            ? form.administrative_department_id || null
            : null,
        college_id: active.id,
      };''',
    re.S,
)
# startEdit/startCreate fields.
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '      instructor_type_id: i.instructor_type_id ?? "",\n    });\n',
    '      instructor_type_id: i.instructor_type_id ?? "",\n'
    '      affiliation_college_id: i.affiliation_college_id ?? i.college_id,\n'
    '      affiliation_department_id: i.affiliation_department_id ?? i.department_id ?? "",\n'
    '      administrative_position: i.administrative_position ?? "",\n'
    '      administrative_department_id: i.administrative_department_id ?? "",\n'
    '    });\n',
)
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '    setEditing(null);\n    setForm(emptyForm());\n    setOpen(true);\n',
    '    setEditing(null);\n'
    '    setForm({ ...emptyForm(), affiliation_college_id: active?.id ?? "" });\n'
    '    setOpen(true);\n',
)
replace_once(
    "src/routes/_authenticated/instructors.tsx",
    '  const typeMap = new Map(typeRows.map((t) => [t.id, t]));\n',
    '  const typeMap = new Map(typeRows.map((t) => [t.id, t]));\n'
    '  const selectedType = typeRows.find((t) => t.id === form.instructor_type_id);\n'
    '  const hourlyContract = isHourlyContractTypeCode(selectedType?.code);\n'
    '  const effectiveQuota =\n'
    '    effectiveInstructorWeeklyHours(\n'
    '      Number(form.max_weekly_hours),\n'
    '      hourlyContract ? 0 : Number(form.administrative_release_hours),\n'
    '    ) ?? 0;\n',
)

FORM_BLOCK = '''              <div className="space-y-3" data-testid="instructor-ordered-form">
                <div data-field-order="1-category">
                  <Label>فئة المحاضر</Label>
                  <Select
                    value={form.instructor_type_id || "_none"}
                    onValueChange={(v) => {
                      const id = v === "_none" ? "" : v;
                      const type = typeRows.find((t) => t.id === id);
                      const hourly = isHourlyContractTypeCode(type?.code);
                      setForm({
                        ...form,
                        instructor_type_id: id,
                        administrative_release_hours: hourly ? 0 : form.administrative_release_hours,
                        administrative_position: hourly ? "" : form.administrative_position,
                        administrative_department_id: hourly ? "" : form.administrative_department_id,
                        employment_type:
                          hourly && form.employment_type === UNKNOWN_EMPLOYMENT_TYPE
                            ? "contract"
                            : form.employment_type,
                      });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="اختر الفئة" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— غير محدد —</SelectItem>
                      {typeRows.map((t) => <SelectItem key={t.id} value={t.id}>{t.name_ar}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {selectedType && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {INSTRUCTOR_FORM_HINT_AR[categorizeInstructor(selectedType)]}
                    </p>
                  )}
                </div>

                {!hourlyContract && (
                  <div data-field-order="2-employee-number">
                    <Label>رقم الموظف</Label>
                    <Input value={form.employee_number} onChange={(e) => setForm({ ...form, employee_number: e.target.value })} />
                  </div>
                )}

                <div data-field-order="3-default-name">
                  <Label>الاسم الافتراضي</Label>
                  <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
                </div>

                <div data-field-order="4-full-arabic-name">
                  <Label>الاسم الرباعي</Label>
                  <Input value={form.full_name_ar} onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })} />
                </div>

                <div data-field-order="5-affiliation-college">
                  <Label>{hourlyContract ? "الكلية المتعاقد فيها" : "الكلية التابع لها"}</Label>
                  <Select
                    value={form.affiliation_college_id || undefined}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        affiliation_college_id: v,
                        affiliation_department_id: "",
                        administrative_department_id: "",
                      })
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="اختر الكلية" /></SelectTrigger>
                    <SelectContent>
                      {(accessibleColleges ?? []).map((college) => (
                        <SelectItem key={college.id} value={college.id}>{college.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div
                  data-field-order="6-affiliation-department"
                  className={repairField === "missing_department" ? "rounded-md border border-amber-500 bg-amber-50/40 p-2" : undefined}
                >
                  <Label htmlFor="instructor-department">
                    {hourlyContract ? "القسم المتعاقد فيه" : "القسم التابع له"}
                  </Label>
                  <Select
                    value={form.affiliation_department_id || undefined}
                    onValueChange={(v) =>
                      setForm({ ...form, affiliation_department_id: v, administrative_department_id: "" })
                    }
                    disabled={!form.affiliation_college_id}
                  >
                    <SelectTrigger id="instructor-department" ref={departmentRef}>
                      <SelectValue placeholder="اختر القسم" />
                    </SelectTrigger>
                    <SelectContent>
                      {(affiliationDepts ?? []).map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div data-field-order="7-specialization">
                  <Label htmlFor="instructor-specialization">التخصص</Label>
                  <Input
                    id="instructor-specialization"
                    ref={specializationRef}
                    value={form.specialization}
                    onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                  />
                </div>

                <div data-field-order="8-rank">
                  <Label>الرتبة العلمية</Label>
                  <Select value={form.academic_rank} onValueChange={(v) => setForm({ ...form, academic_rank: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر الرتبة" /></SelectTrigger>
                    <SelectContent>{RANKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>

                <div data-field-order="9-base-quota">
                  <Label>النصاب الأساسي الأسبوعي</Label>
                  <Input type="number" min={0} value={form.max_weekly_hours} onChange={(e) => setForm({ ...form, max_weekly_hours: Number(e.target.value) })} />
                </div>

                {!hourlyContract && (
                  <div data-field-order="10-admin-release">
                    <Label>ساعات الإعفاء الإداري</Label>
                    <Input type="number" min={0} value={form.administrative_release_hours} onChange={(e) => setForm({ ...form, administrative_release_hours: Number(e.target.value) })} />
                  </div>
                )}
                <p className="rounded border bg-muted/30 p-2 text-xs" data-testid="effective-weekly-quota">
                  {EFFECTIVE_QUOTA_FORMULA_AR}: <b>{effectiveQuota} ساعة</b>
                </p>

                {!hourlyContract && (
                  <div data-field-order="11-administrative-position" className="space-y-2">
                    <Label>المنصب الإداري في حال توافره</Label>
                    <Select
                      value={form.administrative_position || "_none"}
                      onValueChange={(v) =>
                        setForm({
                          ...form,
                          administrative_position: v === "_none" ? "" : v,
                          administrative_department_id:
                            v === "department_head" ? form.administrative_department_id : "",
                        })
                      }
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">— بدون منصب إداري —</SelectItem>
                        {ADMINISTRATIVE_POSITION_OPTIONS.map((position) => (
                          <SelectItem key={position.value} value={position.value}>{position.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {requiresAdministrativeDepartment(form.administrative_position) && (
                      <div>
                        <Label>القسم الذي يرأسه</Label>
                        <Select value={form.administrative_department_id || undefined} onValueChange={(v) => setForm({ ...form, administrative_department_id: v })}>
                          <SelectTrigger><SelectValue placeholder="اختر القسم" /></SelectTrigger>
                          <SelectContent>
                            {(affiliationDepts ?? []).map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                <div data-field-order="12-employment">
                  <Label>حالة التفرغ/التعاقد</Label>
                  <Select value={form.employment_type || UNKNOWN_EMPLOYMENT_TYPE} onValueChange={(v) => setForm({ ...form, employment_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_TYPE_OPTIONS.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div data-field-order="13-email">
                  <Label>البريد الإلكتروني</Label>
                  <Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>

                <div data-field-order="14-phone">
                  <Label>رقم التلفون/الواتساب</Label>
                  <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>

                <div data-field-order="15-active" className="flex items-center justify-between rounded border border-border p-3">
                  <Label>نشط</Label>
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                </div>
              </div>'''
regex_once(
    "src/routes/_authenticated/instructors.tsx",
    r'              <div className="space-y-3">.*?              </div>\n              <DialogFooter>',
    FORM_BLOCK + '\n              <DialogFooter>',
    re.S,
)

# ---------------------------------------------------------------------------
# 5) Central effective quota across reports / exports / teaching import guard
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/reports/instructor-quota.ts",
    'export interface QuotaPolicyRow {\n',
    'import { effectiveInstructorWeeklyHours } from "@/lib/instructors/effective-hours";\n\n'
    'export interface QuotaPolicyRow {\n',
)
replace_once(
    "src/lib/reports/instructor-quota.ts",
    '    netHours: base === null ? null : Math.max(0, round2(base - release)),\n',
    '    netHours: effectiveInstructorWeeklyHours(base, release),\n',
)

# Admin export: explicitly distinguish base/release/effective.
replace_once(
    "src/lib/admin-export/datasets.ts",
    'import type { AdminExportDataset, AdminExportFilter } from "./dataset";\n',
    'import type { AdminExportDataset, AdminExportFilter } from "./dataset";\n'
    'import { effectiveInstructorWeeklyHours } from "@/lib/instructors/effective-hours";\n',
)
replace_once(
    "src/lib/admin-export/datasets.ts",
    '  max_weekly_hours: number | null;\n',
    '  max_weekly_hours: number | null;\n  administrative_release_hours?: number | null;\n',
)
replace_once(
    "src/lib/admin-export/datasets.ts",
    '      { key: "max_weekly_hours", label: "الحد الأسبوعي للساعات", value: (r) => r.max_weekly_hours },\n',
    '      { key: "max_weekly_hours", label: "النصاب الأساسي الأسبوعي", value: (r) => r.max_weekly_hours },\n'
    '      { key: "administrative_release_hours", label: "ساعات الإعفاء الإداري", value: (r) => r.administrative_release_hours ?? 0 },\n'
    '      { key: "effective_weekly_hours", label: "النصاب الفعلي", value: (r) => effectiveInstructorWeeklyHours(r.max_weekly_hours, r.administrative_release_hours) },\n',
)

# Preflight operation carries release hours and applies the net weekly limit.
replace_once(
    "src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts",
    'import type { ParsedRow, RowError } from "./types";\n',
    'import type { ParsedRow, RowError } from "./types";\n'
    'import { effectiveInstructorWeeklyHours } from "@/lib/instructors/effective-hours";\n',
)
replace_once(
    "src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts",
    '  instructorMaxWeeklyHours: number | null;\n',
    '  instructorMaxWeeklyHours: number | null;\n  instructorAdminReleaseHours: number | null;\n',
)
# Appears once more in ExistingTeachingAssignmentV2Hours.
text = read("src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts")
needle = '  instructorMaxWeeklyHours: number | null;\n'
if text.count(needle) == 1:
    pass
elif text.count(needle) == 2:
    # First one was already expanded; expand the remaining raw occurrence.
    text = text.replace(needle, '  instructorMaxWeeklyHours: number | null;\n  instructorAdminReleaseHours: number | null;\n', 1)
    # if replacement hit the first due stale read, avoid duplicate below
write("src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts", text)
# Ensure operationFromCanonicalRow reads the hidden release field.
replace_once(
    "src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts",
    '    instructorMaxWeeklyHours: finiteOrNull(v._instructor_max_weekly_hours),\n',
    '    instructorMaxWeeklyHours: finiteOrNull(v._instructor_max_weekly_hours),\n'
    '    instructorAdminReleaseHours: finiteOrNull(v._instructor_administrative_release_hours),\n',
)
# Existing rows initializer may not have the new field in tests; keep optional semantics by accepting null.
replace_once(
    "src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts",
    '    addInstructorHours(\n      instructorHours,\n      instructorLimits,\n      operation.instructorId,\n      hours,\n      operation.instructorMaxWeeklyHours,\n    );\n',
    '    addInstructorHours(\n'
    '      instructorHours,\n'
    '      instructorLimits,\n'
    '      operation.instructorId,\n'
    '      hours,\n'
    '      effectiveInstructorWeeklyHours(\n'
    '        operation.instructorMaxWeeklyHours,\n'
    '        operation.instructorAdminReleaseHours,\n'
    '      ),\n'
    '    );\n',
)
replace_once(
    "src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts",
    '      existing.instructorMaxWeeklyHours,\n',
    '      effectiveInstructorWeeklyHours(\n'
    '        existing.instructorMaxWeeklyHours,\n'
    '        existing.instructorAdminReleaseHours ?? null,\n'
    '      ),\n',
)
replace_once(
    "src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts",
    '      message: `إجمالي الساعات الأسبوعية للمحاضر (${round2(total)} ساعة) يتجاوز الحد الأسبوعي المعتمد (${limit} ساعة).`,\n',
    '      message: `إجمالي الساعات الأسبوعية للمحاضر (${round2(total)} ساعة) يتجاوز النصاب الفعلي بعد الإعفاء الإداري (${limit} ساعة).`,\n',
)

# Resolver/source loader carries release hours into hidden preflight fields.
replace_once(
    "src/lib/excel-import/teaching-assignments-source-resolver.ts",
    '  max_weekly_hours?: number | null;\n',
    '  max_weekly_hours?: number | null;\n  administrative_release_hours?: number | null;\n',
)
replace_once(
    "src/lib/excel-import/teaching-assignments-source-resolver.ts",
    '    _instructor_max_weekly_hours: instructor.max_weekly_hours ?? null,\n',
    '    _instructor_max_weekly_hours: instructor.max_weekly_hours ?? null,\n'
    '    _instructor_administrative_release_hours: instructor.administrative_release_hours ?? null,\n',
)
replace_once(
    "src/lib/excel-import/teaching-assignments-source-import.ts",
    '      max_weekly_hours: number | null;\n',
    '      max_weekly_hours: number | null;\n      administrative_release_hours: number | null;\n',
)
replace_once(
    "src/lib/excel-import/teaching-assignments-source-import.ts",
    '      "id, employee_number, full_name_ar, full_name, academic_rank, max_weekly_hours",\n',
    '      "id, employee_number, full_name_ar, full_name, academic_rank, max_weekly_hours, administrative_release_hours",\n',
)

# ---------------------------------------------------------------------------
# 6) Supabase generated types for the new HR columns
# ---------------------------------------------------------------------------
for section in ("Row", "Insert", "Update"):
    suffix = "" if section == "Row" else "?"
    anchor = f'          admin_tasks{suffix}: string | null\n'
    if anchor in read("src/integrations/supabase/types.ts"):
        replace_once(
            "src/integrations/supabase/types.ts",
            anchor,
            anchor
            + f'          administrative_department_id{suffix}: string | null\n'
            + f'          administrative_position{suffix}: string | null\n'
            + f'          affiliation_college_id{suffix}: string | null\n'
            + f'          affiliation_department_id{suffix}: string | null\n',
        )

# ---------------------------------------------------------------------------
# 7) Migration: HR columns, consistency trigger, backfill, atomic import function
# ---------------------------------------------------------------------------
old_sql = read("supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql")
start = old_sql.index("CREATE OR REPLACE FUNCTION public._import_apply_table_entity")
end = old_sql.index("$fn$;", start) + len("$fn$;")
fn = old_sql[start:end]


def sql_rep(old: str, new: str) -> None:
    global fn
    count = fn.count(old)
    if count != 1:
        raise RuntimeError(f"import fn anchor count {count}: {old[:100]!r}")
    fn = fn.replace(old, new)

sql_rep("  v_uniq text;\n", "  v_uniq text;\n  v_name_matches int;\n  v_type_code text;\n  v_aff_college uuid;\n  v_aff_department uuid;\n")
sql_rep(
    """      IF NULLIF(v->>'employee_number', '') IS NULL OR NULLIF(v->>'full_name', '') IS NULL THEN
        RAISE EXCEPTION 'instructors row % missing employee_number/full_name', v_rn USING ERRCODE = '22023';
      END IF;""",
    """      IF NULLIF(v->>'full_name', '') IS NULL THEN
        RAISE EXCEPTION 'instructors row % missing full_name', v_rn USING ERRCODE = '22023';
      END IF;
      v_aff_college := COALESCE(NULLIF(v->>'_affiliation_college_id', '')::uuid, p_college);
      v_aff_department := COALESCE(
        NULLIF(v->>'_affiliation_department_id', '')::uuid,
        NULLIF(v->>'_department_id', '')::uuid
      );
      IF NULLIF(v->>'employee_number', '') IS NULL THEN
        SELECT lower(code) INTO v_type_code
        FROM public.instructor_types
        WHERE id = NULLIF(v->>'_instructor_type_id', '')::uuid;
        IF COALESCE(v_type_code, '') <> 'con' THEN
          RAISE EXCEPTION 'instructors row % missing employee_number for non-con category', v_rn USING ERRCODE = '22023';
        END IF;
        SELECT count(*) INTO v_name_matches
        FROM public.instructors i
        WHERE i.college_id = p_college
          AND (lower(btrim(i.full_name)) = lower(btrim(v->>'full_name'))
            OR lower(btrim(COALESCE(i.full_name_ar, ''))) = lower(btrim(v->>'full_name')))
          AND COALESCE(i.affiliation_college_id, i.college_id) = v_aff_college
          AND (v_aff_department IS NULL OR COALESCE(i.affiliation_department_id, i.department_id) = v_aff_department);
        IF v_name_matches > 1 THEN
          RAISE EXCEPTION 'instructors row % ambiguous name match without employee_number', v_rn USING ERRCODE = '22023';
        END IF;
      END IF;""",
)
sql_rep(
    """      v_uniq := v->>'employee_number';
      SELECT id INTO v_id FROM public.instructors
        WHERE college_id = p_college AND lower(employee_number) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;""",
    """      v_uniq := NULLIF(v->>'employee_number', '');
      v_aff_college := COALESCE(NULLIF(v->>'_affiliation_college_id', '')::uuid, p_college);
      v_aff_department := COALESCE(
        NULLIF(v->>'_affiliation_department_id', '')::uuid,
        NULLIF(v->>'_department_id', '')::uuid
      );
      IF v_uniq IS NOT NULL THEN
        SELECT id INTO v_id FROM public.instructors
          WHERE college_id = p_college AND lower(employee_number) = lower(v_uniq)
          ORDER BY id ASC LIMIT 1 FOR UPDATE;
      ELSE
        SELECT id INTO v_id FROM public.instructors i
          WHERE i.college_id = p_college
            AND (lower(btrim(i.full_name)) = lower(btrim(v->>'full_name'))
              OR lower(btrim(COALESCE(i.full_name_ar, ''))) = lower(btrim(v->>'full_name')))
            AND COALESCE(i.affiliation_college_id, i.college_id) = v_aff_college
            AND (v_aff_department IS NULL OR COALESCE(i.affiliation_department_id, i.department_id) = v_aff_department)
          ORDER BY id ASC LIMIT 1 FOR UPDATE;
      END IF;""",
)
sql_rep(
    """          admin_tasks, external_source, notes, is_active
        ) VALUES (
          p_college, v->>'employee_number', v->>'full_name',""",
    """          admin_tasks, external_source, notes, is_active,
          affiliation_college_id, affiliation_department_id,
          administrative_position, administrative_department_id
        ) VALUES (
          p_college, NULLIF(v->>'employee_number', ''), v->>'full_name',""",
)
sql_rep(
    """          NULLIF(v->>'admin_tasks', ''), NULLIF(v->>'external_source', ''), NULLIF(v->>'notes', ''),
          COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        );""",
    """          NULLIF(v->>'admin_tasks', ''), NULLIF(v->>'external_source', ''), NULLIF(v->>'notes', ''),
          COALESCE(NULLIF(v->>'is_active', '')::boolean, true),
          COALESCE(NULLIF(v->>'_affiliation_college_id', '')::uuid, p_college),
          COALESCE(NULLIF(v->>'_affiliation_department_id', '')::uuid, NULLIF(v->>'_department_id', '')::uuid),
          NULLIF(v->>'administrative_position', ''),
          NULLIF(v->>'_administrative_department_id', '')::uuid
        );""",
)
sql_rep(
    """          admin_tasks = NULLIF(v->>'admin_tasks', ''),
          external_source = NULLIF(v->>'external_source', ''),
          notes = NULLIF(v->>'notes', ''),
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        WHERE id = v_id;""",
    """          admin_tasks = COALESCE(NULLIF(v->>'admin_tasks', ''), instructors.admin_tasks),
          external_source = COALESCE(NULLIF(v->>'external_source', ''), instructors.external_source),
          notes = COALESCE(NULLIF(v->>'notes', ''), instructors.notes),
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, true),
          employee_number = COALESCE(NULLIF(v->>'employee_number', ''), instructors.employee_number),
          affiliation_college_id = COALESCE(
            NULLIF(v->>'_affiliation_college_id', '')::uuid, instructors.affiliation_college_id, p_college),
          affiliation_department_id = COALESCE(
            NULLIF(v->>'_affiliation_department_id', '')::uuid, instructors.affiliation_department_id),
          administrative_position = NULLIF(v->>'administrative_position', ''),
          administrative_department_id = NULLIF(v->>'_administrative_department_id', '')::uuid
        WHERE id = v_id;""",
)

MIGRATION_PREFIX = r'''-- INSTRUCTOR-HR-AFFILIATION-01
-- Separate HR affiliation from operational scheduling ownership and make the
-- applied weekly quota = base quota - administrative release without rewriting base data.

ALTER TABLE public.instructors
  ADD COLUMN IF NOT EXISTS affiliation_college_id uuid,
  ADD COLUMN IF NOT EXISTS affiliation_department_id uuid,
  ADD COLUMN IF NOT EXISTS administrative_position text,
  ADD COLUMN IF NOT EXISTS administrative_department_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_affiliation_college_fkey') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_affiliation_college_fkey
      FOREIGN KEY (affiliation_college_id) REFERENCES public.colleges(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_affiliation_department_fkey') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_affiliation_department_fkey
      FOREIGN KEY (affiliation_department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_administrative_department_fkey') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_administrative_department_fkey
      FOREIGN KEY (administrative_department_id) REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='instructors_administrative_position_check') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_administrative_position_check CHECK (
      administrative_position IS NULL OR administrative_position IN (
        'department_head','vice_dean_academic','vice_dean_student_affairs','dean'
      )
    );
  END IF;
END $$;

UPDATE public.instructors
SET affiliation_college_id = COALESCE(affiliation_college_id, college_id),
    affiliation_department_id = COALESCE(affiliation_department_id, department_id)
WHERE affiliation_college_id IS NULL OR affiliation_department_id IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_instructor_hr_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_dep_college uuid;
  v_admin_dep_college uuid;
  v_type_code text;
BEGIN
  NEW.affiliation_college_id := COALESCE(NEW.affiliation_college_id, NEW.college_id);
  NEW.affiliation_department_id := COALESCE(NEW.affiliation_department_id, NEW.department_id);

  IF NEW.affiliation_department_id IS NOT NULL THEN
    SELECT college_id INTO v_dep_college FROM public.departments WHERE id=NEW.affiliation_department_id;
    IF v_dep_college IS NULL OR v_dep_college <> NEW.affiliation_college_id THEN
      RAISE EXCEPTION 'affiliation_department_id must belong to affiliation_college_id';
    END IF;
  END IF;

  IF NEW.administrative_position = 'department_head' THEN
    IF NEW.administrative_department_id IS NULL THEN
      RAISE EXCEPTION 'administrative_department_id is required for department_head';
    END IF;
    SELECT college_id INTO v_admin_dep_college FROM public.departments WHERE id=NEW.administrative_department_id;
    IF v_admin_dep_college IS NULL OR v_admin_dep_college <> NEW.affiliation_college_id THEN
      RAISE EXCEPTION 'administrative department must belong to affiliation college';
    END IF;
  ELSE
    NEW.administrative_department_id := NULL;
  END IF;

  IF NEW.instructor_type_id IS NOT NULL THEN
    SELECT lower(code) INTO v_type_code FROM public.instructor_types WHERE id=NEW.instructor_type_id;
    IF COALESCE(v_type_code,'')='con' THEN
      NEW.administrative_release_hours := 0;
      NEW.administrative_position := NULL;
      NEW.administrative_department_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_instructors_hr_affiliation ON public.instructors;
CREATE TRIGGER trg_instructors_hr_affiliation
BEFORE INSERT OR UPDATE ON public.instructors
FOR EACH ROW EXECUTE FUNCTION public.enforce_instructor_hr_affiliation();

'''
write(
    "supabase/migrations/20260914030000_instructor_hr_affiliation_and_effective_quota.sql",
    MIGRATION_PREFIX + fn + "\n",
)

# ---------------------------------------------------------------------------
# 8) Tests
# ---------------------------------------------------------------------------
TEST = r'''import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEMPLATES } from "../src/lib/excel-import/templates";
import { instructorHeader, prepareInstructorRow } from "../src/lib/excel-import/instructor-sheet";
import {
  effectiveInstructorWeeklyHours,
  isHourlyContractTypeCode,
} from "../src/lib/instructors/effective-hours";
import {
  ADMINISTRATIVE_POSITION_OPTIONS,
  normalizeAdministrativePosition,
  requiresAdministrativeDepartment,
} from "../src/lib/instructors/administrative-positions";
import { preflightCanonicalTeachingHours } from "../src/lib/excel-import/teaching-assignments-v2-hours-preflight";

const root = resolve(import.meta.dir, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("instructor HR form contract", () => {
  test("form exposes the requested order and hourly-contract conditionals", () => {
    const src = source("src/routes/_authenticated/instructors.tsx");
    const tokens = [
      'data-field-order="1-category"',
      'data-field-order="2-employee-number"',
      'data-field-order="3-default-name"',
      'data-field-order="4-full-arabic-name"',
      'data-field-order="5-affiliation-college"',
      'data-field-order="6-affiliation-department"',
      'data-field-order="7-specialization"',
      'data-field-order="8-rank"',
      'data-field-order="9-base-quota"',
      'data-field-order="10-admin-release"',
      'data-field-order="11-administrative-position"',
      'data-field-order="12-employment"',
      'data-field-order="13-email"',
      'data-field-order="14-phone"',
      'data-field-order="15-active"',
    ];
    let previous = -1;
    for (const token of tokens) {
      const index = src.indexOf(token);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(src).toContain("!hourlyContract && (");
    expect(src).toContain("instructor-affiliation-depts");
    expect(src).toContain('.eq("college_id", affiliationCollegeId)');
    expect(src).not.toContain("الاسم بالإنجليزية</Label>");
    expect(src).not.toContain("ملاحظات</Label>");
  });

  test("administrative position list and department-head rule are structured", () => {
    expect(ADMINISTRATIVE_POSITION_OPTIONS.map((p) => p.value)).toEqual([
      "department_head",
      "vice_dean_academic",
      "vice_dean_student_affairs",
      "dean",
    ]);
    expect(normalizeAdministrativePosition("رئيس قسم")).toBe("department_head");
    expect(requiresAdministrativeDepartment("department_head")).toBe(true);
    expect(requiresAdministrativeDepartment("dean")).toBe(false);
  });
});

describe("effective weekly quota", () => {
  test("subtracts administrative release and clamps at zero", () => {
    expect(effectiveInstructorWeeklyHours(18, 4)).toBe(14);
    expect(effectiveInstructorWeeklyHours(18, 0)).toBe(18);
    expect(effectiveInstructorWeeklyHours(10, 20)).toBe(0);
  });
  test("recognizes the production hourly-contract category", () => {
    expect(isHourlyContractTypeCode("con")).toBe(true);
    expect(isHourlyContractTypeCode("CON")).toBe(true);
    expect(isHourlyContractTypeCode("permanent")).toBe(false);
  });
});

describe("official instructor import template", () => {
  test("emits exactly the new sixteen visible columns in order", () => {
    const keys = TEMPLATES.instructors.columns.filter((c) => !c.templateHidden).map((c) => c.key);
    expect(keys).toEqual([
      "instructor_type_code",
      "employee_number",
      "full_name",
      "full_name_ar",
      "affiliation_college_code",
      "affiliation_department_code",
      "specialization",
      "academic_rank",
      "max_weekly_hours",
      "administrative_release_hours",
      "administrative_position",
      "administrative_department_code",
      "employment_type",
      "email",
      "phone",
      "is_active",
    ]);
  });

  test("legacy basic headers remain recognized", () => {
    expect(instructorHeader("اسم المدرس", TEMPLATES.instructors.columns)).toBe("الاسم_الافتراضي");
    expect(instructorHeader("نوع_المحاضر_رمز", TEMPLATES.instructors.columns)).toBe(
      "فئة_المحاضر_رمز",
    );
    expect(instructorHeader("رمز_القسم", TEMPLATES.instructors.columns)).toBe("رمز_القسم");
  });

  test("hourly contractor may omit employee number; normal employee may not", () => {
    const conRow = {
      rowNumber: 2,
      raw: {},
      values: { full_name: "متعاقد واحد", instructor_type_code: "con", max_weekly_hours: 10 },
    };
    expect(prepareInstructorRow(conRow, [], TEMPLATES.instructors.columns)).toEqual([]);
    const permanent = {
      rowNumber: 3,
      raw: {},
      values: { full_name: "موظف واحد", instructor_type_code: "permanent", max_weekly_hours: 18 },
    };
    expect(
      prepareInstructorRow(permanent, [], TEMPLATES.instructors.columns).some(
        (e) => e.errorCode === "instructor_employee_number_required",
      ),
    ).toBe(true);
  });

  test("department head requires a headed department", () => {
    const row = {
      rowNumber: 4,
      raw: {},
      values: {
        full_name: "رئيس قسم",
        employee_number: "E1",
        instructor_type_code: "permanent",
        max_weekly_hours: 18,
        administrative_position: "department_head",
      },
    };
    expect(
      prepareInstructorRow(row, [], TEMPLATES.instructors.columns).some(
        (e) => e.errorCode === "administrative_department_required",
      ),
    ).toBe(true);
  });
});

describe("weekly teaching-hours preflight uses net quota", () => {
  test("base 18 - release 4 rejects a weekly total of 15", () => {
    const mk = (rowNumber: number, dg: string, component: string, hours: number) => ({
      rowNumber,
      raw: {},
      values: {
        _delivery_group_id: dg,
        _component_id: component,
        _instructor_id: "i1",
        _term_id: "t1",
        study_system: "regular",
        _component_total_hours: hours,
        _assigned_component_hours: hours,
        assigned_component_hours: hours,
        _is_active: true,
        _instructor_max_weekly_hours: 18,
        _instructor_administrative_release_hours: 4,
      },
    });
    const result = preflightCanonicalTeachingHours({
      canonicalOperations: [mk(2, "dg1", "c1", 8), mk(3, "dg2", "c2", 7)],
      existingV2Assignments: [],
    });
    expect(result.errors.some((e) => e.errorCode === "INSTRUCTOR_TEACHING_HOURS_OVER_LIMIT")).toBe(
      true,
    );
  });
});

describe("schema migration contract", () => {
  test("adds affiliation/admin columns, backfill and consistency trigger", () => {
    const sql = source(
      "supabase/migrations/20260914030000_instructor_hr_affiliation_and_effective_quota.sql",
    );
    for (const col of [
      "affiliation_college_id",
      "affiliation_department_id",
      "administrative_position",
      "administrative_department_id",
    ])
      expect(sql).toContain(col);
    expect(sql).toContain("affiliation_college_id = COALESCE(affiliation_college_id, college_id)");
    expect(sql).toContain("trg_instructors_hr_affiliation");
    expect(sql).toContain("ambiguous name match without employee_number");
  });
});
'''
write("tests/instructor-hr-restructure.test.ts", TEST)

print("Instructor restructure patch applied successfully")
