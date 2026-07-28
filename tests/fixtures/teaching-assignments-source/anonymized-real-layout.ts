/**
 * Anonymized structural fixture derived from the production workbook layout.
 * It preserves merged-cell/carry-forward and campus-label patterns, but contains
 * no real instructor names, employee codes, or academic records.
 */
export const anonymizedRealWorkbookSheet = [
  ["م", "الاسم", "اسم المادة", "المستوى", "البرنامج", "اجمالي الساعات", "ملاحظات"],
  ["1", "محاضر اختباري أ", "هياكل البيانات", "2", "علوم حاسوب", "4", ""],
  ["2", "", "", "", "", "4", "صف مدمج يتطلب carry-forward"],
  ["3", "محاضر اختباري ب", "مهارات التواصل", "1", "كل الاقسام مع الجوف", "2", ""],
  ["4", "", "مقدمة في البرمجة", "1", "", "3", ""],
] as const;
