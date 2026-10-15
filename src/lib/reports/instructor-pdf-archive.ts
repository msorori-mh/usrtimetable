/**
 * One PDF per lecturer, packed into a ZIP, produced entirely in the browser.
 *
 * A web page cannot save several files through the print dialog, so the sheet is
 * drawn here instead: a self-contained XHTML page with inline styles is rendered by
 * the browser's own text engine (SVG foreignObject, so Arabic shaping and RTL are the
 * browser's, not a re-implementation), captured as a JPEG, wrapped in a one-image-per-
 * page PDF and stored in a ZIP. Nothing here depends on the application stylesheet or
 * on a third-party package.
 */

/** A4 at 96 dpi, the CSS reference pixel. */
export const PDF_PAGE_WIDTH_PX = 794;
export const PDF_PAGE_HEIGHT_PX = 1123;
const PDF_PAGE_WIDTH_PT = 595.28;
const PDF_PAGE_HEIGHT_PT = 841.89;
/** Rows that fit a page under the header, with or without the hours summary. */
const ROWS_PER_PAGE = 10;
const ROWS_WITH_SUMMARY = 6;

export interface InstructorPdfRow {
  dayIndex: number;
  startTime: string;
  endTime: string;
  day: string;
  time: string;
  course: string;
  type: string;
  room: string;
  audience: string;
  college: string;
}

export interface InstructorPdfSheet {
  universityName: string;
  scopeLabel: string;
  instructorName: string;
  universityNumber: string | null;
  termName: string | null;
  versionLabel: string | null;
  generatedAt: string;
  logoDataUrl: string | null;
  qrDataUrl?: string | null;
  reportUrl?: string;
  printNotice?: string;
  rows: InstructorPdfRow[];
  colleges: { name: string; version: string; hours: string }[];
  totals: { label: string; value: string }[];
  note: string;
}

const encoder = new TextEncoder();

/** Text is placed inside XML, so every markup character must be escaped. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Characters a file name cannot carry on Windows, macOS or inside a ZIP. */
export function safeFileName(value: string, fallback: string): string {
  const cleaned = [...value]
    .map((char) => (char.charCodeAt(0) < 32 ? " " : char))
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[ .]+|[ .]+$/g, "");
  return cleaned || fallback;
}

/** Split the lecture rows into pages; the hours summary closes the last page it fits. */
export function paginateInstructorRows<T>(rows: readonly T[]): { rows: T[]; summary: boolean }[] {
  const pages: { rows: T[]; summary: boolean }[] = [];
  let rest = [...rows];
  while (rest.length > ROWS_PER_PAGE) {
    pages.push({ rows: rest.slice(0, ROWS_PER_PAGE), summary: false });
    rest = rest.slice(ROWS_PER_PAGE);
  }
  if (rest.length > ROWS_WITH_SUMMARY) {
    pages.push({ rows: rest, summary: false });
    pages.push({ rows: [], summary: true });
  } else {
    pages.push({ rows: rest, summary: true });
  }
  return pages;
}

const INK = "#12303f";
const BRAND = "#0f4c66";
const LINE = "#9fb4bf";
const SOFT = "#e6f0f4";
const cell = `border:1px solid ${LINE};padding:7px 6px;vertical-align:middle;`;
const head = `${cell}background:${SOFT};color:${BRAND};font-weight:700;white-space:nowrap;`;

function tableHtml(rows: readonly InstructorPdfRow[], showCollege: boolean): string {
  if (!rows.length) return "";
  const columns: [keyof InstructorPdfRow, string, string][] = [
    ["day", "اليوم", "white-space:nowrap;"],
    ["time", "الوقت", "white-space:nowrap;direction:ltr;text-align:center;"],
    ["course", "المقرر", ""],
    ["type", "النوع", "white-space:nowrap;"],
    ["audience", "الدفعة والمجموعة", ""],
    ["room", "القاعة", ""],
    ...(showCollege
      ? ([["college", "الكلية", ""]] as [keyof InstructorPdfRow, string, string][])
      : []),
  ];
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.5;margin-top:14px;">
<thead><tr>${columns.map(([, label]) => `<th style="${head}">${escapeXml(label)}</th>`).join("")}</tr></thead>
<tbody>${rows
    .map(
      (row, index) =>
        `<tr style="background:${index % 2 ? "#f6f9fb" : "#ffffff"};">${columns
          .map(
            ([key, , style]) =>
              `<td style="${cell}${style}">${escapeXml(String(row[key] || "—"))}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
}

/** The weekly page is part of every output, irrespective of the screen view mode. */
function weeklyHtml(sheet: InstructorPdfSheet): string {
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const days = [6, 0, 1, 2, 3, 4, ...(sheet.rows.some((r) => r.dayIndex === 5) ? [5] : [])];
  const names = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const start = Math.floor(Math.min(...sheet.rows.map((r) => minute(r.startTime))) / 60) * 60;
  const end = Math.ceil(Math.max(...sheet.rows.map((r) => minute(r.endTime))) / 60) * 60;
  const height = 650;
  const span = Math.max(end - start, 60);
  const hours = Array.from({ length: span / 60 }, (_, i) => start + i * 60);
  const label = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:00`;
  return `<h2 style="font-size:17px;margin:16px 0 10px;color:${BRAND};">الجدول الأسبوعي</h2>
<div style="display:flex;direction:rtl;border:1px solid ${LINE};font-size:12px;">
<div style="width:44px;flex-shrink:0;"><div style="height:30px;background:${SOFT};text-align:center;">الوقت</div><div style="height:${height}px;position:relative;">${hours.map((m) => `<div style="position:absolute;top:${((m - start) / span) * height}px;left:0;right:0;height:${(60 / span) * height}px;border-top:1px solid ${LINE};text-align:center;direction:ltr;">${label(m)}</div>`).join("")}</div></div>
${days
  .map(
    (day) =>
      `<div style="flex:1;min-width:0;border-right:1px solid ${LINE};"><div style="height:30px;background:${SOFT};text-align:center;font-weight:700;">${names[day]}</div><div style="height:${height}px;position:relative;background:repeating-linear-gradient(to bottom,#fff 0,#fff calc(${(60 / span) * height}px - 1px),${LINE} ${(60 / span) * height}px);">${sheet.rows
        .filter((r) => r.dayIndex === day)
        .map(
          (r) =>
            `<div style="position:absolute;box-sizing:border-box;top:${((minute(r.startTime) - start) / span) * height}px;height:${((minute(r.endTime) - minute(r.startTime)) / span) * height}px;left:2px;right:2px;background:${SOFT};border:1px solid ${LINE};padding:5px 3px;overflow-wrap:anywhere;line-height:1.4;text-align:center;"><b>${escapeXml(r.course)}</b><div>${escapeXml(r.type)}</div><div style="direction:ltr;margin:3px 0;font-weight:700;">${escapeXml(r.time)}</div><div>${escapeXml(r.room)}</div><div style="font-size:10px;">${escapeXml(r.audience)}</div></div>`,
        )
        .join("")}</div></div>`,
  )
  .join("")}</div>`;
}

function summaryHtml(sheet: InstructorPdfSheet): string {
  const line = (label: string, value: string, bold = false) =>
    `<tr><td colspan="2" style="${cell}${bold ? "font-weight:700;" : ""}">${escapeXml(label)}</td><td style="${cell}white-space:nowrap;${bold ? "font-weight:700;" : ""}">${escapeXml(value)}</td></tr>`;
  return `<div style="margin-top:16px;">
<div style="font-weight:800;color:${BRAND};font-size:14px;margin-bottom:6px;">ملخص الساعات التدريسية الأسبوعية</div>
<table style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.5;">
<thead><tr><th style="${head}">الكلية</th><th style="${head}">نسخة الجدول</th><th style="${head}">الساعات</th></tr></thead>
<tbody>${sheet.colleges
    .map(
      (c) =>
        `<tr><td style="${cell}">${escapeXml(c.name)}</td><td style="${cell}">${escapeXml(c.version)}</td><td style="${cell}white-space:nowrap;">${escapeXml(c.hours)}</td></tr>`,
    )
    .join(
      "",
    )}${sheet.totals.map((t, i) => line(t.label, t.value, i === 0)).join("")}</tbody></table>
<div style="margin-top:6px;font-size:11px;color:#4f6875;">${escapeXml(sheet.note)}</div></div>`;
}

/** Self-contained XHTML pages of one lecturer's sheet (well-formed XML, inline styles only). */
export function instructorSheetPages(
  sheet: InstructorPdfSheet,
  {
    includeWeekly = false,
    detailPages,
  }: {
    includeWeekly?: boolean;
    detailPages?: { rows: InstructorPdfRow[]; summary: boolean }[];
  } = {},
): string[] {
  const showCollege = new Set(sheet.rows.map((row) => row.college)).size > 1;
  const pages = [
    ...(detailPages ?? paginateInstructorRows(sheet.rows)).map((page) => ({
      ...page,
      weekly: false,
    })),
    ...(includeWeekly && sheet.rows.length ? [{ rows: [], summary: false, weekly: true }] : []),
  ];
  const field = (label: string, value: string | null) =>
    value
      ? `<span style="display:inline-block;max-width:100%;overflow-wrap:anywhere;margin-inline-end:18px;"><span style="color:#4f6875;">${escapeXml(label)}:</span> <b>${escapeXml(value)}</b></span>`
      : "";
  return pages.map((page, index) => {
    const header = `<div style="border:1px solid ${LINE};border-top:4px solid ${BRAND};">
<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;">
${sheet.logoDataUrl ? `<img src="${escapeXml(sheet.logoDataUrl)}" style="width:52px;height:52px;object-fit:contain;" alt=""/>` : ""}
<div style="flex:1;"><div style="font-weight:800;color:${BRAND};font-size:16px;">${escapeXml(sheet.universityName)}</div>
<div style="font-size:12px;color:#4f6875;">${escapeXml(sheet.scopeLabel)}</div></div>
${sheet.qrDataUrl ? `<img src="${escapeXml(sheet.qrDataUrl)}" style="width:56px;height:56px;" alt="رابط التقرير"/>` : ""}
<div style="font-weight:800;color:${BRAND};font-size:15px;">الجدول الدراسي الفردي</div></div>
<div style="background:${SOFT};padding:8px 12px;font-size:20px;font-weight:800;color:${BRAND};text-align:center;">${escapeXml(sheet.instructorName)}</div>
<div style="padding:7px 12px;font-size:12px;line-height:1.9;">${field("الرقم الجامعي", sheet.universityNumber)}${field("الفصل الدراسي", sheet.termName)}${field("نسخة الجدول", sheet.versionLabel)}${field("تاريخ الإصدار", sheet.generatedAt)}</div>
${sheet.printNotice ? `<div style="padding:6px 12px;border-top:1px solid ${LINE};font-size:12px;font-weight:700;">${escapeXml(sheet.printNotice)}</div>` : ""}</div>`;
    return `<div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" lang="ar" style="box-sizing:border-box;width:${PDF_PAGE_WIDTH_PX}px;height:${PDF_PAGE_HEIGHT_PX}px;padding:45px 57px;background:#ffffff;color:${INK};font-family:Cairo,Tajawal,'Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;overflow:hidden;position:relative;">
<div data-instructor-page-content="true">${header}${page.weekly ? weeklyHtml(sheet) : `<h2 style="font-size:17px;margin:14px 0 0;color:${BRAND};">تفصيل المحاضرات</h2>${tableHtml(page.rows, showCollege)}`}${page.summary ? summaryHtml(sheet) : ""}</div>
<div data-instructor-page-footer="true" style="position:absolute;bottom:22px;left:57px;right:57px;font-size:10px;color:#4f6875;display:flex;justify-content:space-between;"><span>للقراءة والطباعة فقط — تُراجع حالة النسخة في التقرير</span><span>صفحة ${index + 1} من ${pages.length}</span></div></div>`;
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Stored (uncompressed) ZIP with UTF-8 names; JPEG-based PDFs gain nothing from deflate. */
export function createZip(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true); // UTF-8 file name
    header.setUint16(8, 0, true); // stored
    header.setUint16(10, 0, true);
    header.setUint16(12, 0x21, true); // 1980-01-01
    header.setUint32(14, crc, true);
    header.setUint32(18, file.data.length, true);
    header.setUint32(22, file.data.length, true);
    header.setUint16(26, name.length, true);
    header.setUint16(28, 0, true);
    local.push(new Uint8Array(header.buffer), name, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const directory = concat(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directory.length, true);
  end.setUint32(16, offset, true);
  return concat([...local, directory, new Uint8Array(end.buffer)]);
}

/** A PDF whose every page is one full-page JPEG. */
export function jpegPagesToPdf(
  pages: readonly { jpeg: Uint8Array; width: number; height: number }[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.4\n%âãÏÓ\n");
  const pageIds = pages.map((_, i) => 3 + i * 3);
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  pages.forEach((page, i) => {
    const pageId = pageIds[i];
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH_PT} ${PDF_PAGE_HEIGHT_PT}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    offsets[imageId] = length;
    push(
      `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push("\nendstream\nendobj\n");
    const content = `q ${PDF_PAGE_WIDTH_PT} 0 0 ${PDF_PAGE_HEIGHT_PT} 0 0 cm /Im0 Do Q`;
    object(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(parts);
}

/** Draw one XHTML page with the browser's own layout engine and capture it as a JPEG. */
function sheetPageFits(xhtml: string): boolean {
  // Measure before capture; never silently crop a tall row or hours summary.
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;";
  probe.innerHTML = xhtml;
  document.body.appendChild(probe);
  try {
    const content = probe.querySelector<HTMLElement>("[data-instructor-page-content]");
    const footer = probe.querySelector<HTMLElement>("[data-instructor-page-footer]");
    return (
      !content ||
      !footer ||
      content.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top - 8
    );
  } finally {
    probe.remove();
  }
}

/** Draw one XHTML page with the browser's own layout engine and capture it as a JPEG. */
export async function rasterizeSheetPage(
  xhtml: string,
  scale = 2,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  if (!sheetPageFits(xhtml))
    throw new Error("محتوى جدول المحاضر يتجاوز حدود الصفحة؛ لم يُنشأ ملف ناقص.");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PDF_PAGE_WIDTH_PX}" height="${PDF_PAGE_HEIGHT_PX}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const image = new Image();
  image.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("تعذّر رسم ورقة الجدول في هذا المتصفح."));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement("canvas");
  canvas.width = PDF_PAGE_WIDTH_PX * scale;
  canvas.height = PDF_PAGE_HEIGHT_PX * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("تعذّر تجهيز مساحة الرسم في هذا المتصفح.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) throw new Error("تعذّر تحويل ورقة الجدول إلى صورة في هذا المتصفح.");
  return {
    jpeg: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function buildInstructorPdf(sheet: InstructorPdfSheet): Promise<Uint8Array> {
  return jpegPagesToPdf(await buildInstructorPageImages(sheet));
}

/** Both browser printing and ZIP PDFs use these very same rendered A4 pages. */
export async function buildInstructorPageImages(
  sheet: InstructorPdfSheet,
  options?: { includeWeekly?: boolean },
) {
  await Promise.race([
    document.fonts.ready,
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  const detailPages = paginateInstructorRows(sheet.rows);
  // Long names, a large number of colleges and font fallback can change row height.
  // Split measured overflow, then render again so every page number stays correct.
  for (;;) {
    const htmlPages = instructorSheetPages(sheet, { ...options, detailPages });
    const overflow = htmlPages.findIndex((page) => !sheetPageFits(page));
    if (overflow < 0) {
      const pages = [];
      for (const page of htmlPages) pages.push(await rasterizeSheetPage(page));
      return pages;
    }
    const page = detailPages[overflow];
    if (!page || !page.rows.length || (page.rows.length === 1 && !page.summary))
      throw new Error("محتوى جدول المحاضر يتجاوز حدود الصفحة؛ لم يُنشأ ملف ناقص.");
    const split = page.rows.length === 1 ? 1 : Math.ceil(page.rows.length / 2);
    detailPages.splice(
      overflow,
      1,
      { rows: page.rows.slice(0, split), summary: false },
      { rows: page.rows.slice(split), summary: page.summary },
    );
  }
}

/** An image inside the drawn sheet must be inline: the drawing cannot load URLs. */
export async function imageAsDataUrl(src: string): Promise<string | null> {
  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Inline the same branding and verification URL for print and downloaded PDFs. */
let logo: Promise<string | null> | undefined;
export async function prepareInstructorSheetAssets(
  sheet: Omit<InstructorPdfSheet, "logoDataUrl">,
  logoSrc: string,
): Promise<InstructorPdfSheet> {
  const { default: QRCode } = await import("qrcode");
  logo ??= imageAsDataUrl(logoSrc);
  const [logoDataUrl, qrDataUrl] = await Promise.all([
    logo,
    sheet.reportUrl
      ? QRCode.toDataURL(sheet.reportUrl, { width: 112, margin: 1, errorCorrectionLevel: "M" })
      : null,
  ]);
  return { ...sheet, logoDataUrl, qrDataUrl };
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
