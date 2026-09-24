import { HEADCOUNT_HEADERS, HEADCOUNT_LIMIT, COUNT_COLUMNS, type ImportCohort } from "./import";

export async function readHeadcountWorkbook(file: File) {
  if (!/\.xlsx$/i.test(file.name) || file.size > 10 * 1024 * 1024)
    throw new Error("استخدم ملف XLSX بحجم لا يتجاوز 10 ميجابايت.");
  const XLSX = await import("xlsx");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4)
    throw new Error("محتوى الملف ليس XLSX صالحًا.");
  const book = XLSX.read(bytes, {
    type: "array",
    cellFormula: true,
    bookVBA: true,
  });
  if (book.vbaraw) throw new Error("الملفات التي تحتوي وحدات ماكرو غير مقبولة.");
  const name = book.SheetNames.includes("scheduling_headcounts")
    ? "scheduling_headcounts"
    : book.SheetNames.includes("academic_cohorts")
      ? "academic_cohorts"
      : book.SheetNames.length === 1
        ? book.SheetNames[0]
        : null;
  if (!name)
    throw new Error(
      "سمّ ورقة البيانات scheduling_headcounts أو academic_cohorts لتحديدها دون التباس.",
    );
  const sheet = book.Sheets[name];
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  if (range.e.r > HEADCOUNT_LIMIT || range.e.c > 49 || range.s.r !== 0)
    throw new Error(`يبدأ القالب في الصف الأول وبحد أقصى ${HEADCOUNT_LIMIT} صف بيانات و50 عمودًا.`);
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;
    if (cell.f || cell.t === "e")
      throw new Error(`الخلية ${address} تحتوي معادلة أو خطأ؛ الصق القيم قبل الرفع.`);
  }
  return {
    name,
    ignored: book.SheetNames.filter((s) => s !== name),
    matrix: XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: true,
      raw: true,
    }),
  };
}

export async function downloadHeadcountWorkbook(cohorts: ImportCohort[], populated: boolean) {
  const XLSX = await import("xlsx");
  const data: unknown[][] = [HEADCOUNT_HEADERS];
  if (populated)
    for (const c of cohorts)
      data.push([
        c.code,
        c.term_code,
        ...COUNT_COLUMNS.map(([key]) => c.headcount?.[key] ?? ""),
        c.headcount?.source ?? "",
        c.headcount?.notes ?? "",
      ]);
  const book = XLSX.utils.book_new(),
    sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = HEADCOUNT_HEADERS.map(() => ({ wch: 25 }));
  XLSX.utils.book_append_sheet(book, sheet, "scheduling_headcounts");
  const instructions = XLSX.utils.aoa_to_sheet([
    ["تعليمات"],
    ["أدخل الأعداد الفعلية في جميع أعمدة الأعداد. لا تعتبر الخلايا الفارغة أصفارًا."],
    ["الحفظ كمسودة أولًا ثم الاعتماد الجماعي بعد مراجعة المعاينة."],
    [
      "يمكن رفع ملف academic_cohorts السابق مع التأكيد الصريح على تساوي جميع الأعداد وهامش احتياط صفر.",
    ],
    ["التعديل على عدد معتمد يعيده إلى مسودة. إعادة الملف نفسه دون تغييرات تحفظ الاعتماد القائم."],
    ["المصدر الفارغ يؤخذ من اسم الملف. تجاوز عدد المؤهلين يتطلب سببًا واستثناءً صريحًا."],
  ]);
  instructions["!cols"] = [{ wch: 115 }];
  XLSX.utils.book_append_sheet(book, instructions, "تعليمات");
  XLSX.writeFile(
    book,
    populated ? "scheduling_headcounts_current.xlsx" : "scheduling_headcounts_template.xlsx",
  );
}
