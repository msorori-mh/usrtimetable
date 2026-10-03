import { describe, expect, it } from "bun:test";
import {
  crc32,
  createZip,
  escapeXml,
  instructorSheetPages,
  jpegPagesToPdf,
  paginateInstructorRows,
  safeFileName,
  type InstructorPdfSheet,
} from "../src/lib/reports/instructor-pdf-archive";

const bytes = (text: string) => new TextEncoder().encode(text);
const ascii = (data: Uint8Array) => new TextDecoder("latin1").decode(data);
const row = (i: number) => ({
  day: "السبت",
  time: "08:00 - 11:00",
  course: `مقرر ${i}`,
  type: "نظري",
  room: "قاعة 1",
  audience: "نظم المعلومات — م3",
  college: "كلية الحاسوب",
});
const sheet = (count: number): InstructorPdfSheet => ({
  universityName: "جامعة إقليم سبأ",
  scopeLabel: "جميع الكليات",
  instructorName: 'د. اختبار & <وسم> "اسم"',
  universityNumber: "U-1",
  termName: "الفصل الأول",
  versionLabel: "Final",
  generatedAt: "2026/10/03",
  logoDataUrl: null,
  rows: Array.from({ length: count }, (_, i) => row(i)),
  colleges: [{ name: "كلية الحاسوب", version: "Final", hours: "9.00" }],
  totals: [{ label: "الإجمالي", value: "9.00" }],
  note: "ملاحظة",
});

describe("per-lecturer PDF archive", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(bytes("123456789")).toString(16)).toBe("cbf43926");
  });

  it("writes a stored ZIP with UTF-8 names and a matching directory", () => {
    const files = [
      { name: "د. محاضر أول.pdf", data: bytes("first") },
      { name: "محاضر ثانٍ.pdf", data: bytes("second-file") },
    ];
    const zip = createZip(files);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x0800);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(14, true)).toBe(crc32(files[0].data));
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const directoryOffset = view.getUint32(end + 16, true);
    expect(view.getUint32(directoryOffset, true)).toBe(0x02014b50);
    // The second directory entry points at the second local header.
    const firstName = bytes(files[0].name).length;
    const secondEntry = directoryOffset + 46 + firstName;
    const secondLocal = view.getUint32(secondEntry + 42, true);
    expect(secondLocal).toBe(30 + firstName + files[0].data.length);
    expect(view.getUint32(secondLocal, true)).toBe(0x04034b50);
  });

  it("writes a PDF whose cross-reference table points at every object", () => {
    const pdf = jpegPagesToPdf([
      { jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 10, height: 14 },
      { jpeg: new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9]), width: 10, height: 14 },
    ]);
    const text = ascii(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(8);
    offsets.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it("keeps every lecture and closes with the hours summary exactly once", () => {
    for (const count of [0, 1, 6, 7, 10, 11, 25]) {
      const pages = paginateInstructorRows(Array.from({ length: count }, (_, i) => i));
      expect(pages.flatMap((page) => page.rows)).toEqual(
        Array.from({ length: count }, (_, i) => i),
      );
      expect(pages.filter((page) => page.summary)).toHaveLength(1);
      expect(pages[pages.length - 1].summary).toBe(true);
      expect(pages.every((page) => page.rows.length <= 10)).toBe(true);
      expect(pages.every((page) => !page.summary || page.rows.length <= 6)).toBe(true);
    }
  });

  it("escapes lecturer text and numbers the pages", () => {
    expect(escapeXml(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&#39;");
    const pages = instructorSheetPages(sheet(11));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("د. اختبار &amp; &lt;وسم&gt; &quot;اسم&quot;");
    expect(pages[0]).not.toContain("<وسم>");
    expect(pages[0]).toContain("صفحة 1 من 2");
    expect(pages[1]).toContain("ملخص الساعات التدريسية الأسبوعية");
    expect(pages[0]).not.toContain("ملخص الساعات التدريسية الأسبوعية");
    // One college only: the college column is left out.
    expect(pages[0]).not.toContain(">الكلية</th><th");
  });

  it("makes file names safe on every platform", () => {
    expect(safeFileName('د. محاضر: أول/ثانٍ*?"<>|', "x")).toBe("د. محاضر أول ثانٍ");
    expect(safeFileName(" .. ", "بديل")).toBe("بديل");
  });
});
