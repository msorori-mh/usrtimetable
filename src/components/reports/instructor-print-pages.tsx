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
        /* The page images are A4-shaped. They fill the printable width and keep their ratio, so
           a page still fits on one sheet when the shared 12/15 mm report margins (or browser
           margins) apply instead of the zero-margin named page; a fixed 210x297 mm box overflowed
           those margins, clipping the left edge and pushing each footer onto its own sheet. */
        .instructor-canonical-pages { width: 100% !important; margin: 0 !important; padding: 0 !important; }
        .instructor-canonical-page {
          page: instructor-individual; width: 100% !important; height: auto !important;
          margin: 0 !important; padding: 0 !important; line-height: 0; break-inside: avoid;
          break-after: page; overflow: hidden;
        }
        .instructor-canonical-page:last-child { break-after: auto; }
        .instructor-canonical-page img {
          display: block; width: 100% !important; height: auto !important; max-width: 100% !important;
          max-height: 296mm !important; margin: 0 auto !important; object-fit: contain;
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
