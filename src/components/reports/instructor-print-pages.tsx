import { USR_UNIVERSITY_LOGO_SRC } from "@/lib/branding/usr";
import {
  buildInstructorPageImages,
  prepareInstructorSheetAssets,
  type InstructorPdfSheet,
} from "@/lib/reports/instructor-pdf-archive";

/** The browser prints the identical page images that the ZIP wraps in PDF pages. */
export async function prepareInstructorPrintPages(
  sheet: Omit<InstructorPdfSheet, "logoDataUrl">,
  { includeWeekly = true }: { includeWeekly?: boolean } = {},
) {
  const pages = await buildInstructorPageImages(
    await prepareInstructorSheetAssets(sheet, USR_UNIVERSITY_LOGO_SRC),
    { includeWeekly },
  );
  const images = await Promise.all(
    pages.map(
      ({ jpeg }) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = async () => {
            const src = String(reader.result);
            const image = new Image();
            image.src = src;
            try {
              await image.decode();
              resolve(src);
            } catch {
              reject(new Error("تعذّر تحميل صورة صفحة الطباعة."));
            }
          };
          reader.onerror = () => reject(new Error("تعذّر تجهيز صفحات طباعة المحاضر."));
          reader.readAsDataURL(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
        }),
    ),
  );
  return (
    <div className="instructor-canonical-pages" data-testid="instructor-canonical-pages">
      <style>{`@media print {
        @page instructor-individual {
          size: A4 portrait !important;
          margin: 0 !important;
          @bottom-center { content: none !important; }
        }
        .instructor-canonical-pages { width: 210mm !important; margin: 0 !important; padding: 0 !important; }
        .instructor-canonical-page {
          page: instructor-individual; width: 210mm !important; height: 297mm !important;
          margin: 0 !important; padding: 0 !important; line-height: 0; break-inside: avoid;
          break-after: page;
        }
        .instructor-canonical-page:last-child { break-after: auto; }
        .instructor-canonical-page img { display: block; width: 100% !important; height: 100% !important; max-width: none !important; }
      }`}</style>
      {images.map((src, index) => (
        <div key={index} className="instructor-canonical-page">
          <img src={src} alt={`${sheet.instructorName} — صفحة ${index + 1} من ${images.length}`} />
        </div>
      ))}
    </div>
  );
}
