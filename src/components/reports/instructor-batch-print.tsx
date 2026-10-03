import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { printPageStyleCss } from "@/lib/print-center";

export interface InstructorBatchSheet {
  key: string;
  content: ReactNode;
}

/** Lecturers are loaded a few at a time so one click cannot flood the API. */
const BATCH_CONCURRENCY = 4;

/**
 * Prints the full individual schedule of every lecturer in one job: each lecturer's
 * sheet is the same content the single-lecturer report prints, starting on a new page.
 * A lecturer with no lecture in the chosen scope yields no sheet.
 */
export function InstructorBatchPrint<T>({
  items,
  disabled,
  documentTitle,
  loadSheet,
}: {
  items: readonly T[];
  disabled?: boolean;
  documentTitle: string;
  loadSheet: (item: T) => Promise<InstructorBatchSheet | null>;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sheets, setSheets] = useState<InstructorBatchSheet[] | null>(null);

  const run = async () => {
    if (progress || sheets || !items.length) return;
    const total = items.length;
    setProgress({ done: 0, total });
    try {
      const results: (InstructorBatchSheet | null)[] = new Array(total).fill(null);
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < total) {
          const index = next++;
          results[index] = await loadSheet(items[index]);
          done += 1;
          setProgress({ done, total });
        }
      };
      await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, total) }, worker));
      const ready = results.filter((sheet): sheet is InstructorBatchSheet => sheet !== null);
      if (!ready.length) {
        toast.error("لا توجد محاضرات مجدولة لأي محاضر ضمن النطاق المحدد.");
        setProgress(null);
        return;
      }
      setSheets(ready);
    } catch {
      // Never print a partial set: a missing lecturer would go unnoticed on paper.
      toast.error("تعذّر تحميل جداول المحاضرين، ولم يُطبع شيء. أعد المحاولة.");
      setProgress(null);
    }
  };

  useEffect(() => {
    if (!sheets) return;
    const root = document.documentElement;
    const previousTitle = document.title;
    root.dataset.instructorBatchPrint = "true";
    document.title = documentTitle;
    let cancelled = false;
    const finish = () => {
      setSheets(null);
      setProgress(null);
    };
    window.addEventListener("afterprint", finish, { once: true });
    void (async () => {
      // A slow web-font host must not prevent printing with the fallback font.
      await Promise.race([
        document.fonts.ready.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
      // Let React commit every sheet before the print preview opens.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (cancelled) return;
      try {
        window.print();
      } catch {
        finish();
        toast.error("تعذّر فتح نافذة الطباعة. أعد المحاولة.");
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", finish);
      delete root.dataset.instructorBatchPrint;
      document.title = previousTitle;
    };
  }, [sheets, documentTitle]);

  const busy = !!progress || !!sheets;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => void run()}
        disabled={disabled || busy || !items.length}
        data-testid="instructor-batch-print"
      >
        <Printer className="ml-2 h-4 w-4" aria-hidden="true" />
        {progress && !sheets
          ? `جارٍ تحميل الجداول… ${progress.done} من ${progress.total}`
          : `طباعة جداول كل المحاضرين (${items.length})`}
      </Button>
      {sheets &&
        createPortal(
          <div className="instructor-batch-print report-print-root print-center-body" dir="rtl">
            <style>{printPageStyleCss()}</style>
            {sheets.map((sheet) => (
              <section key={sheet.key} className="instructor-batch-sheet">
                {sheet.content}
              </section>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
