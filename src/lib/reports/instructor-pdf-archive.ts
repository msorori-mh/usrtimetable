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
          .map(([key, , style]) => `<td style="${cell}${style}">${escapeXml(row[key] || "—")}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
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
export function instructorSheetPages(sheet: InstructorPdfSheet): string[] {
  const showCollege = new Set(sheet.rows.map((row) => row.college)).size > 1;
  const pages = paginateInstructorRows(sheet.rows);
  const field = (label: string, value: string | null) =>
    value
      ? `<span style="display:inline-block;white-space:nowrap;margin-inline-end:18px;"><span style="color:#4f6875;">${escapeXml(label)}:</span> <b>${escapeXml(value)}</b></span>`
      : "";
  return pages.map((page, index) => {
    const header = `<div style="border:1px solid ${LINE};border-top:4px solid ${BRAND};">
<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;">
${sheet.logoDataUrl ? `<img src="${escapeXml(sheet.logoDataUrl)}" style="width:52px;height:52px;object-fit:contain;" alt=""/>` : ""}
<div style="flex:1;"><div style="font-weight:800;color:${BRAND};font-size:16px;">${escapeXml(sheet.universityName)}</div>
<div style="font-size:12px;color:#4f6875;">${escapeXml(sheet.scopeLabel)}</div></div>
<div style="font-weight:800;color:${BRAND};font-size:15px;">الجدول الدراسي الفردي</div></div>
<div style="background:${SOFT};padding:8px 12px;font-size:20px;font-weight:800;color:${BRAND};text-align:center;">${escapeXml(sheet.instructorName)}</div>
<div style="padding:7px 12px;font-size:12px;line-height:1.9;">${field("الرقم الجامعي", sheet.universityNumber)}${field("الفصل الدراسي", sheet.termName)}${field("نسخة الجدول", sheet.versionLabel)}${field("تاريخ الإصدار", sheet.generatedAt)}</div></div>`;
    return `<div xmlns="http://www.w3.org/1999/xhtml" dir="rtl" lang="ar" style="box-sizing:border-box;width:${PDF_PAGE_WIDTH_PX}px;height:${PDF_PAGE_HEIGHT_PX}px;padding:45px 57px;background:#ffffff;color:${INK};font-family:Cairo,Tajawal,'Noto Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;overflow:hidden;position:relative;">
${header}${tableHtml(page.rows, showCollege)}${page.summary ? summaryHtml(sheet) : ""}
<div style="position:absolute;bottom:22px;left:57px;right:57px;font-size:10px;color:#4f6875;display:flex;justify-content:space-between;"><span>اعتماد رسمي وفق النسخة المنشورة في المنصة — للقراءة والطباعة فقط</span><span>صفحة ${index + 1} من ${pages.length}</span></div></div>`;
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
export async function rasterizeSheetPage(
  xhtml: string,
  scale = 2,
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
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
  const pages = [];
  for (const page of instructorSheetPages(sheet)) pages.push(await rasterizeSheetPage(page));
  return jpegPagesToPdf(pages);
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
