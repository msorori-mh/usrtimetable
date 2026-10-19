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
        /* Each image already carries the sheet's own footer and "صفحة x من y", so the
           report's shared page counter is not printed under it. */
        @page { @bottom-center { content: none !important; } }
        /* No named page: a page-name change forces a sheet break, so any element after the
           pages (even an empty one) printed an extra blank sheet. The A4-shaped images fill
           95% of the printable width and keep their ratio, so each fits one sheet whatever
           margins apply (report 12/15 mm, browser default or none). Pages are separated with
           break-before, so nothing breaks after the last one. */
        .instructor-canonical-pages { width: 100% !important; margin: 0 !important; padding: 0 !important; }
        .instructor-canonical-page {
          width: 100% !important; height: auto !important; margin: 0 !important;
          padding: 0 !important; line-height: 0; break-inside: avoid; overflow: hidden;
        }
        .instructor-canonical-page + .instructor-canonical-page { break-before: page; }
        .instructor-canonical-page img {
          display: block; width: 95% !important; height: auto !important; max-width: 95% !important;
          max-height: 282mm !important; margin: 0 auto !important; object-fit: contain;
        }
      }`}</style>
      {images.map((src, index) => (
        <div key={index} className="instructor-canonical-page">
          <img src={src} alt={`${sheet.instructorName} — صفحة ${index + 1} من ${images.length}`} />
        </div>
      ))}
    </div>
  );
}
