import assert from "node:assert/strict";
import { mock, test } from "node:test";
import * as XLSX from "xlsx";
import { TEMPLATES, buildTemplateWorkbook, parseExcel } from "../src/lib/excel-import/templates";
import { instructorStatusLabel } from "../src/lib/excel-import/instructor-sheet";

const college = "college-a";
const teacher = {
  id: "teacher-1",
  college_id: college,
  employee_number: "EMP42",
  full_name: "أحمد محمد",
  full_name_ar: "أحمد محمد",
  specialization: null,
  department_id: "department-a",
  instructor_type_id: "type-a",
  email: "kept@example.test",
  phone: "123",
  employment_type: "part_time",
  max_weekly_hours: 18,
  administrative_release_hours: 4,
  is_active: true,
  notes: "ملاحظة محفوظة",
  full_name_en: "Ahmed Mohamed",
};
let catalog: Record<string, unknown>[] = [teacher];
let role = "college_admin";
let failure = false;
const reads: { table: string; filters: Record<string, unknown> }[] = [];
mock.module("../src/integrations/supabase/client.ts", {
  namedExports: {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) },
      from(table: string) {
        const filters: Record<string, unknown> = {};
        let from = 0,
          to = Infinity;
        const result = () => {
          reads.push({ table, filters: { ...filters } });
          if (failure && table === "instructors")
            return { data: null, error: new Error("catalog unavailable") };
          const data =
            table === "user_roles"
              ? [{ role, user_id: "admin" }]
              : table === "user_colleges"
                ? [{ id: "member", college_id: college, user_id: "admin" }]
                : table === "colleges"
                  ? [{ id: college, code: "ITCS", university_id: "u1" }]
                  : table === "instructors"
                    ? catalog
                    : table === "departments"
                      ? [
                          {
                            id: "department-a",
                            college_id: college,
                            code: "CS",
                            name: "علوم الحاسوب",
                          },
                        ]
                      : [
                          { id: "type-a", college_id: college, code: "PERM" },
                          ...["permanent", "annual_contract", "con"].map((code) => ({
                            id: `type-${code}`,
                            college_id: college,
                            code,
                          })),
                        ];
          return {
            data: data
              .filter((row) =>
                Object.entries(filters).every(([key, value]) =>
                  Array.isArray(value)
                    ? value.includes(row[key as keyof typeof row])
                    : row[key as keyof typeof row] === value,
                ),
              )
              .slice(from, to + 1),
            error: null,
          };
        };
        const query = {
          select() {
            return query;
          },
          order() {
            return query;
          },
          eq(key: string, value: unknown) {
            filters[key] = value;
            return query;
          },
          in(key: string, value: unknown[]) {
            filters[key] = value;
            return query;
          },
          range(start: number, end: number) {
            from = start;
            to = end;
            return query;
          },
          async maybeSingle() {
            const r = result();
            return { ...r, data: r.data?.[0] ?? null };
          },
          async single() {
            const r = result();
            return { ...r, data: r.data?.[0] ?? null };
          },
          then(resolve: (result: unknown) => unknown) {
            return Promise.resolve(result()).then(resolve);
          },
        };
        return query;
      },
      rpc(name: string, args: { p_instructor_ids?: string[] }) {
        if (name === "get_instructor_number_aliases") {
          return Promise.resolve({
            data: catalog
              .filter((row) => args.p_instructor_ids?.includes(String(row.id)))
              .map((row) => ({ instructor_id: row.id, university_number: "USABA-H-000001" })),
            error: null,
          });
        }
        if (name === "get_instructor_university_numbers") {
          return Promise.resolve({
            data: catalog
              .filter((row) => args.p_instructor_ids?.includes(String(row.id)))
              .map((row) => ({
                instructor_id: row.id,
                identity_id: "identity-1",
                university_number: "USABA-ITCS-000042",
              })),
            error: null,
          });
        }
        throw new Error("validation must not write");
      },
    },
  },
});
const { validate, buildDbPayload } = await import("../src/lib/excel-import/validators");

function sourceFile(changes: Record<number, unknown> = {}, extraHeaders: string[] = []) {
  const row: unknown[] = [
    "نشط ",
    "عميد الكلية ",
    "استاذ مشارك ",
    6,
    "علوم الحاسوب ",
    "أحمد محمد",
    1,
  ];
  for (const [key, value] of Object.entries(changes)) row[Number(key)] = value;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [],
      ["", "", "", "", "", "كشف المدرسين والنصاب التدريسي"],
      [],
      [],
      [],
      [],
      [
        "الحالة",
        "الصفة ",
        "الرتبة الأكاديمية ",
        "النصاب الأسبوعي (ساعة)",
        "القسم",
        "اسم المدرس",
        "م",
        ...extraHeaders,
      ],
      row,
    ]),
    "المدرسون والنصاب",
  );
  return new File([XLSX.write(workbook, { type: "array", bookType: "xlsx" })], "teachers.xlsx");
}

async function check(file = sourceFile()) {
  const parsed = await parseExcel(file, "instructors");
  return {
    parsed,
    result: await validate("instructors", parsed.headers, parsed.rows, college, parsed.rowNumbers),
  };
}

test("full Arabic source sheet resolves an existing teacher, specialization and all supplied fields without erasing omitted data", async () => {
  const { parsed, result } = await check();
  assert.deepEqual(parsed.rowNumbers, [8]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.validRows.length, 1);
  const row = result.validRows[0];
  assert.equal(row.values.employee_number, "EMP42");
  assert.equal(row.values._matched_by_name, true);
  assert.equal(row.values._exists, true);
  const payload = buildDbPayload("instructors", row, college);
  assert.equal(payload.specialization, "علوم الحاسوب");
  assert.equal(payload.academic_rank, "أستاذ مشارك");
  assert.equal(payload.admin_tasks, "عميد الكلية");
  assert.equal(payload.max_weekly_hours, 6);
  for (const key of [
    "email",
    "phone",
    "employment_type",
    "department_id",
    "instructor_type_id",
    "administrative_release_hours",
    "notes",
    "full_name_en",
  ])
    assert.equal(payload[key], teacher[key as keyof typeof teacher], key);
  assert.ok(
    reads
      .filter((r) => ["instructors", "instructor_types"].includes(r.table))
      .every((r) => r.filters.college_id === college),
  );
  assert.ok(reads.some((r) => r.table === "colleges"));
  assert.ok(reads.some((r) => r.table === "departments"));
});

test("leave and scholarship are inactive and retain their exact reason through export and reimport", async () => {
  for (const status of [
    "إجازة مرضية",
    "إجازة بدون راتب",
    "إجازة اعتيادية",
    "ابتعاث",
    "تفرغ علمي",
  ]) {
    const { result } = await check(sourceFile({ 0: status }));
    assert.deepEqual(result.errors, []);
    const row = result.validRows[0];
    assert.equal(row.values.is_active, false);
    assert.match(String(row.values.notes), /ملاحظة محفوظة/);
    assert.equal(instructorStatusLabel(false, row.values.notes as string), status);
    const blob = await buildTemplateWorkbook("instructors", [row.values]);
    const again = await check(new File([blob], "export.xlsx"));
    assert.deepEqual(again.result.errors, []);
    assert.equal(again.result.validRows[0].values.is_active, false);
    assert.equal(
      instructorStatusLabel(false, again.result.validRows[0].values.notes as string),
      status,
    );
  }
});

test("invalid status and load identify the real Excel row and teacher instead of silently defaulting", async () => {
  const { result } = await check(sourceFile({ 0: "حالة مجهولة", 3: "غير معروف" }));
  assert.equal(result.validRows.length, 0);
  assert.ok(result.errors.some((e) => e.errorCode === "invalid_instructor_status"));
  assert.ok(result.errors.some((e) => e.errorCode === "invalid_instructor_hours"));
  assert.ok(result.errors.every((e) => e.rowNumber === 8 && e.message.includes("أحمد محمد")));
  const zero = await check(sourceFile({ 3: "٠" }));
  assert.equal(zero.result.validRows[0].values.max_weekly_hours, 0);
  const blank = await check(sourceFile({ 3: "" }));
  assert.ok(blank.result.errors.some((e) => e.errorCode === "missing_weekly_load"));
});

test("missing, ambiguous and conflicting identities cannot create duplicate teachers or use a serial as employee number", async () => {
  try {
    catalog = [];
    let result = (await check()).result;
    assert.equal(result.validRows.length, 0);
    assert.ok(result.errors.some((e) => e.errorCode === "instructor_employment_category_required"));
    catalog = [teacher, { ...teacher, id: "teacher-2", employee_number: "EMP43" }];
    result = (await check()).result;
    assert.ok(result.errors.some((e) => e.errorCode === "ambiguous_instructor"));
    catalog = [teacher];
    result = (await check(sourceFile({ 7: "DIFFERENT" }, ["رقم_الموظف"]))).result;
    assert.ok(result.errors.some((e) => e.errorCode === "instructor_identity_conflict"));
    catalog = [{ ...teacher, college_id: "other-college" }];
    result = (await check()).result;
    assert.equal(result.validRows.length, 0);
  } finally {
    catalog = [teacher];
  }
});

test("duplicate aliases and unknown columns are blocked without dropping their data", async () => {
  const duplicate = (await check(sourceFile({ 7: "علوم" }, ["التخصص"]))).result;
  assert.ok(duplicate.errors.some((e) => e.errorCode === "duplicate_header"));
  const unknown = (await check(sourceFile({ 7: "قيمة" }, ["عمود غير معروف"]))).result;
  assert.ok(unknown.errors.some((e) => e.errorCode === "unknown_column"));
});

test("legacy official headers remain supported and the new template contains the complete source fields", async () => {
  const headers = [
    "رقم_الموظف",
    "الاسم_الكامل",
    "التخصص",
    "أقصى_ساعات_أسبوعية",
    "الرتبة_الأكاديمية",
    "المهام_الإدارية",
    "نشط",
  ];
  const values = ["EMP42", "أحمد محمد", "علوم الحاسوب", 12, "أستاذ مساعد", "مدرس", "true"];
  const result = await validate(
    "instructors",
    headers,
    [Object.fromEntries(headers.map((h, i) => [h, values[i]]))],
    college,
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.validRows[0].values.specialization, "علوم الحاسوب");
  const file = new File([await buildTemplateWorkbook("instructors")], "template.xlsx");
  const parsed = await parseExcel(file, "instructors");
  assert.deepEqual(parsed.headers, [
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
  ]);
});

test("catalog failures and read-only roles cannot produce a successful import preview", async () => {
  try {
    failure = true;
    await assert.rejects(check(), /catalog unavailable/);
    failure = false;
    role = "institutional_viewer";
    await assert.rejects(check(), /College administrator/);
  } finally {
    failure = false;
    role = "college_admin";
  }
});

test("university number resolves the existing employee and unknown numbers cannot create a duplicate", async () => {
  const valid = await check(sourceFile({ 7: "USABA-ITCS-000042" }, ["الرقم الجامعي الموحّد"]));
  assert.deepEqual(valid.result.errors, []);
  assert.equal(valid.result.validRows[0].values.employee_number, "EMP42");
  const invalid = await check(sourceFile({ 7: "USABA-ITCS-999999" }, ["الرقم الجامعي الموحّد"]));
  assert.ok(
    invalid.result.errors.some((error) => error.errorCode === "university_identity_not_unique"),
  );
});

test("previous contract code resolves the same instructor after promotion", async () => {
  const { result } = await check(sourceFile({ 7: "USABA-H-000001" }, ["الرقم الجامعي الموحّد"]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.validRows[0].values.employee_number, "EMP42");
});

test("an existing automatically numbered permanent instructor can be reimported without an HR number", async () => {
  try {
    catalog = [{ ...teacher, employee_number: null }];
    const { result } = await check(
      sourceFile({ 7: "USABA-ITCS-000042" }, ["الرقم الجامعي الموحّد"]),
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.validRows.length, 1);
  } finally {
    catalog = [teacher];
  }
});

test("new explicit permanent and contract categories do not require a manual employee number", async () => {
  try {
    catalog = [];
    for (const category of ["permanent", "annual_contract", "con"]) {
      const { result } = await check(sourceFile({ 7: category }, ["فئة_المحاضر_رمز"]));
      assert.deepEqual(result.errors, [], category);
      assert.equal(result.validRows.length, 1);
    }
  } finally {
    catalog = [teacher];
  }
});
