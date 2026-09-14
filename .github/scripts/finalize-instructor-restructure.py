from pathlib import Path
import re


def patch(path: str, fn):
    p = Path(path)
    s = p.read_text()
    n = fn(s)
    if n != s:
        p.write_text(n)


# ---------------------------------------------------------------------------
# Official workbook: emit only the 16 visible columns.
# ---------------------------------------------------------------------------
def patch_templates(s: str) -> str:
    s = s.replace(
        'const rows = dataRows?.map((row) =>\n    tpl.columns.map((column) =>',
        'const rows = dataRows?.map((row) =>\n    visibleColumns.map((column) =>',
    )
    return s


patch('src/lib/excel-import/templates.ts', patch_templates)


# ---------------------------------------------------------------------------
# Workload report: one central effective quota helper.
# ---------------------------------------------------------------------------
def patch_quota(s: str) -> str:
    imp = 'import { effectiveInstructorWeeklyHours } from "@/lib/instructors/effective-hours";\n\n'
    if imp not in s:
        s = s.replace(
            'export type QuotaSource = "policy" | "instructor" | "missing";\n',
            imp + 'export type QuotaSource = "policy" | "instructor" | "missing";\n',
        )
    s = re.sub(
        r'netHours:\s*base === null \? null : round2\(Math\.max\(0, base - release\)\),',
        'netHours: effectiveInstructorWeeklyHours(base, release),',
        s,
    )
    return s


patch('src/lib/reports/instructor-quota.ts', patch_quota)


# ---------------------------------------------------------------------------
# Generated net-quota regression fixture must be a canonical V2 operation.
# ---------------------------------------------------------------------------
def patch_hr_test(s: str) -> str:
    marker = '        study_system: "regular",\n        _component_total_hours: hours,\n'
    if marker in s:
        s = s.replace(
            marker,
            '        study_system: "regular",\n'
            '        component_type: "theory",\n'
            '        _component_weekly_hours: hours,\n'
            '        _component_total_hours: hours,\n',
            1,
        )
    return s


patch('tests/instructor-hr-restructure.test.ts', patch_hr_test)


# ---------------------------------------------------------------------------
# Instructor import: new contract + safe compatibility with legacy source sheets.
# ---------------------------------------------------------------------------
def patch_validators(s: str) -> str:
    # Legacy sheets are any instructor workbook not carrying the new affiliation header.
    s = re.sub(
        r'  const legacyInstructorShape =\n(?:    .*\n){1,4}?    !headerSet\.has\("كلية_التبعية_رمز"\);',
        '  const legacyInstructorShape =\n'
        '    entity === "instructors" && !headerSet.has("كلية_التبعية_رمز");',
        s,
        count=1,
    )

    # Header-level required check: the three newly-required HR columns are not required
    # from an old workbook. Their values are derived from the matched current record.
    mh = s.index('  const missingHeaders = tpl.columns')
    mm = s.index('    .map((c) => c.header);', mh)
    block = s[mh:mm]
    if 'c.key === "instructor_type_code"' not in block:
        needle = '        !(entity === "instructors" && c.key === "employee_number") &&\n'
        repl = (
            needle
            + '        !(\n'
            + '          legacyInstructorShape &&\n'
            + '          (c.key === "instructor_type_code" ||\n'
            + '            c.key === "affiliation_college_code" ||\n'
            + '            c.key === "affiliation_department_code")\n'
            + '        ) &&\n'
        )
        if needle in block:
            block = block.replace(needle, repl, 1)
            s = s[:mh] + block + s[mm:]
    else:
        # Existing patch may only have affiliation fields; add type field.
        s = s.replace(
            '(c.key === "affiliation_college_code" || c.key === "affiliation_department_code")',
            '(c.key === "instructor_type_code" ||\n'
            '            c.key === "affiliation_college_code" ||\n'
            '            c.key === "affiliation_department_code")',
            1,
        )

    # Row-level required check: robustly inject an exemption instead of relying on formatting.
    row_start = s.index('  for (const row of parsed) {')
    req_loop = s.index('    for (const c of tpl.columns) {', row_start)
    inject_at = req_loop + len('    for (const c of tpl.columns) {')
    nearby = s[inject_at : inject_at + 500]
    if 'legacyInstructorRequiredExempt' not in nearby:
        inject = (
            '\n      const legacyInstructorRequiredExempt =\n'
            '        entity === "instructors" &&\n'
            '        legacyInstructorShape &&\n'
            '        (c.key === "instructor_type_code" ||\n'
            '          c.key === "affiliation_college_code" ||\n'
            '          c.key === "affiliation_department_code");'
        )
        s = s[:inject_at] + inject + s[inject_at:]
        cond = s.index('        c.required &&', inject_at)
        s = s[:cond] + '        c.required &&\n        !legacyInstructorRequiredExempt &&' + s[cond + len('        c.required &&'):]

    # Preserve existing type when an old row omits its type code.
    old = (
        '      const rawTypeCode = String(row.values.instructor_type_code ?? "").trim();\n'
        '      const typeCode = rawTypeCode.toLowerCase();\n'
        '      const typeId = typeCode ? lk.instructorTypes?.get(typeCode) : null;\n'
    )
    new = (
        '      let rawTypeCode = String(row.values.instructor_type_code ?? "").trim();\n'
        '      let typeCode = rawTypeCode.toLowerCase();\n'
        '      if (!typeCode && row.values._instructor_type_id) {\n'
        '        typeCode = lk.instructorTypeCodesById?.get(String(row.values._instructor_type_id)) ?? "";\n'
        '        rawTypeCode = typeCode;\n'
        '        if (typeCode) row.values.instructor_type_code = typeCode;\n'
        '      }\n'
        '      const typeId = typeCode ? lk.instructorTypes?.get(typeCode) : null;\n'
    )
    s = s.replace(old, new)

    # Default/normalize the affiliation college code for legacy rows.
    s = s.replace(
        '      } else {\n        row.values._affiliation_college_id = affiliationCollege.id;\n      }\n\n      const affiliationDepartmentCode',
        '      } else {\n'
        '        row.values._affiliation_college_id = affiliationCollege.id;\n'
        '        row.values.affiliation_college_code = affiliationCollegeCode;\n'
        '      }\n\n'
        '      const affiliationDepartmentCode',
    )

    # If old input only gave a specialization/name but prepareInstructorRow already matched
    # an operational department id, recover its affiliation code from the university catalog.
    s = s.replace('      const affiliationDepartment =\n', '      let affiliationDepartment =\n', 1)
    marker = (
        '          ? lk.affiliationDepartments?.get(`${affiliationCollege.id}|${affiliationDepartmentCode}`)\n'
        '          : null;\n'
        '      if (!affiliationDepartment) {'
    )
    replacement = (
        '          ? lk.affiliationDepartments?.get(`${affiliationCollege.id}|${affiliationDepartmentCode}`)\n'
        '          : null;\n'
        '      if (!affiliationDepartment && affiliationCollege && row.values._department_id) {\n'
        '        for (const [compoundKey, candidate] of lk.affiliationDepartments ?? []) {\n'
        '          if (\n'
        '            candidate.id === String(row.values._department_id) &&\n'
        '            candidate.college_id === affiliationCollege.id\n'
        '          ) {\n'
        '            affiliationDepartment = candidate;\n'
        '            row.values.affiliation_department_code = compoundKey.slice(compoundKey.indexOf("|") + 1);\n'
        '            break;\n'
        '          }\n'
        '        }\n'
        '      }\n'
        '      if (!affiliationDepartment) {'
    )
    s = s.replace(marker, replacement)
    s = s.replace(
        '        row.values._affiliation_department_id = affiliationDepartment.id;\n',
        '        row.values._affiliation_department_id = affiliationDepartment.id;\n'
        '        if (!row.values.affiliation_department_code)\n'
        '          row.values.affiliation_department_code = affiliationDepartmentCode;\n',
        1,
    )
    s = s.replace('.eq("id", collegeId).single(),', '.eq("id", collegeId).maybeSingle(),')
    return s


patch('src/lib/excel-import/validators.ts', patch_validators)


# ---------------------------------------------------------------------------
# Existing import regression harness: model the newly-read university catalog and
# update the official template expectation without weakening old-source tests.
# ---------------------------------------------------------------------------
def patch_sheet_test(s: str) -> str:
    if 'table === "colleges"' not in s:
        s = s.replace(
            ': table === "instructors"\n                  ? catalog\n',
            ': table === "colleges"\n'
            '                  ? [{ id: college, code: "ITCS", university_id: "u1" }]\n'
            '                  : table === "instructors"\n'
            '                    ? catalog\n',
        )
    if 'Array.isArray(value)' not in s:
        s = s.replace(
            '                  ([key, value]) => row[key as keyof typeof row] === value,\n',
            '                  ([key, value]) =>\n'
            '                    Array.isArray(value)\n'
            '                      ? value.includes(row[key as keyof typeof row])\n'
            '                      : row[key as keyof typeof row] === value,\n',
        )
    if '          in(key: string, value: unknown[]) {' not in s:
        s = s.replace(
            '          eq(key: string, value: unknown) {\n'
            '            filters[key] = value;\n'
            '            return query;\n'
            '          },\n',
            '          eq(key: string, value: unknown) {\n'
            '            filters[key] = value;\n'
            '            return query;\n'
            '          },\n'
            '          in(key: string, value: unknown[]) {\n'
            '            filters[key] = value;\n'
            '            return query;\n'
            '          },\n',
        )
    if '          async single() {' not in s:
        s = s.replace(
            '          async maybeSingle() {\n'
            '            const r = result();\n'
            '            return { ...r, data: r.data?.[0] ?? null };\n'
            '          },\n',
            '          async maybeSingle() {\n'
            '            const r = result();\n'
            '            return { ...r, data: r.data?.[0] ?? null };\n'
            '          },\n'
            '          async single() {\n'
            '            const r = result();\n'
            '            return { ...r, data: r.data?.[0] ?? null };\n'
            '          },\n',
        )

    old = re.compile(
        r'  assert\.deepEqual\(parsed\.headers\.slice\(0, 6\), \[\n'
        r'    "اسم المدرس",\n'
        r'    "القسم \(التخصص\)",\n'
        r'    "النصاب الأسبوعي \(ساعة\)",\n'
        r'    "الرتبة الأكاديمية",\n'
        r'    "الصفة",\n'
        r'    "الحالة",\n'
        r'  \]\);\n'
        r'  assert\.equal\(parsed\.headers\.length, 19\);\n'
        r'  assert\.ok\([\s\S]*?\n  \);'
    )
    expected = '''  assert.deepEqual(parsed.headers, [
    "فئة_المحاضر_رمز",
    "رقم_الموظف",
    "الاسم_الافتراضي",
    "الاسم_الرباعي",
    "كلية_التبعية_رمز",
    "قسم_التبعية_رمز",
    "التخصص",
    "الرتبة_العلمية",
    "النصاب_الأساسي_الأسبوعي",
    "ساعات_الإعفاء_الإداري",
    "المنصب_الإداري",
    "قسم_الرئاسة_رمز",
    "حالة_التفرغ_التعاقد",
    "البريد_الإلكتروني",
    "التلفون_الواتساب",
    "نشط",
  ]);'''
    s = old.sub(expected, s, count=1)
    return s


patch('tests/instructor-sheet.test.ts', patch_sheet_test)


# ---------------------------------------------------------------------------
# Generated Supabase types expose the four new HR fields on Row/Insert/Update.
# ---------------------------------------------------------------------------
def patch_types(s: str) -> str:
    a = s.index('      instructors: {')
    b = s.index('      plan_course_components:', a)
    block = s[a:b]
    if 'affiliation_college_id:' not in block:
        block = block.replace(
            '          admin_tasks: string | null\n',
            '          admin_tasks: string | null\n'
            '          administrative_department_id: string | null\n'
            '          administrative_position: string | null\n'
            '          affiliation_college_id: string | null\n'
            '          affiliation_department_id: string | null\n',
            1,
        )
    if 'affiliation_college_id?:' not in block:
        block = block.replace(
            '          admin_tasks?: string | null\n',
            '          admin_tasks?: string | null\n'
            '          administrative_department_id?: string | null\n'
            '          administrative_position?: string | null\n'
            '          affiliation_college_id?: string | null\n'
            '          affiliation_department_id?: string | null\n',
        )
    return s[:a] + block + s[b:]


patch('src/integrations/supabase/types.ts', patch_types)

print('finalize-instructor-restructure: OK')
