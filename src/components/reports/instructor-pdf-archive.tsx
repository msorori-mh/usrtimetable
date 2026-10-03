import { useState } from "react";
import { FileArchive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { USR_UNIVERSITY_LOGO_SRC } from "@/lib/branding/usr";
import {
  buildInstructorPdf,
  createZip,
  downloadBytes,
  imageAsDataUrl,
  safeFileName,
  type InstructorPdfSheet,
} from "@/lib/reports/instructor-pdf-archive";

export interface InstructorPdfEntry {
  fileName: string;
  sheet: Omit<InstructorPdfSheet, "logoDataUrl">;
}

/** Lecturers are loaded a few at a time so one click cannot flood the API. */
const LOAD_CONCURRENCY = 4;

/**
 * Downloads one PDF per lecturer inside a single ZIP. A lecturer with no lecture in
 * the chosen scope gets no file; a failure downloads nothing rather than a partial set.
 */
export function InstructorPdfArchive<T>({
  items,
  disabled,
  archiveName,
  loadEntry,
}: {
  items: readonly T[];
  disabled?: boolean;
  archiveName: string;
  loadEntry: (item: T) => Promise<InstructorPdfEntry | null>;
}) {
  const [progress, setProgress] = useState<string | null>(null);

  const run = async () => {
    if (progress || !items.length) return;
    const total = items.length;
    setProgress(`جارٍ تحميل الجداول… 0 من ${total}`);
    try {
      const loaded: (InstructorPdfEntry | null)[] = new Array(total).fill(null);
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < total) {
          const index = next++;
          loaded[index] = await loadEntry(items[index]);
          done += 1;
          setProgress(`جارٍ تحميل الجداول… ${done} من ${total}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, total) }, worker));
      const entries = loaded.filter((entry): entry is InstructorPdfEntry => entry !== null);
      if (!entries.length) {
        toast.error("لا توجد محاضرات مجدولة لأي محاضر ضمن النطاق المحدد.");
        return;
      }
      const logoDataUrl = await imageAsDataUrl(USR_UNIVERSITY_LOGO_SRC);
      const used = new Set<string>();
      const files: { name: string; data: Uint8Array }[] = [];
      for (const [index, entry] of entries.entries()) {
        setProgress(`جارٍ إنشاء ملفات PDF… ${index + 1} من ${entries.length}`);
        // Two lecturers may share a name: every file keeps a distinct name.
        const base = safeFileName(entry.fileName, `محاضر ${index + 1}`);
        let name = base;
        for (let copy = 2; used.has(name); copy++) name = `${base} (${copy})`;
        used.add(name);
        files.push({
          name: `${name}.pdf`,
          data: await buildInstructorPdf({ ...entry.sheet, logoDataUrl }),
        });
      }
      downloadBytes(
        createZip(files),
        `${safeFileName(archiveName, "جداول المحاضرين")}.zip`,
        "application/zip",
      );
      toast.success(`تم تنزيل ${files.length} ملف PDF في ملف مضغوط واحد.`);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? `${error.message} لم يُنزَّل شيء.`
          : "تعذّر إنشاء ملفات الجداول، ولم يُنزَّل شيء. أعد المحاولة.",
      );
    } finally {
      setProgress(null);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void run()}
      disabled={disabled || !!progress || !items.length}
      data-testid="instructor-pdf-archive"
    >
      <FileArchive className="ml-2 h-4 w-4" aria-hidden="true" />
      {progress ?? `تنزيل PDF لكل محاضر في ملف مضغوط (${items.length})`}
    </Button>
  );
}
