/**
 * ADMIN-EXPORT-01 — reusable export button/menu for admin lists.
 * The dataset provider receives no arguments and must return ALL rows matching
 * the current filters (never only the visible page).
 */
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AdminExportDataset } from "@/lib/admin-export/dataset";
import {
  ADMIN_EXPORT_FORMAT_LABEL_AR,
  exportAdminDataset,
  type AdminExportFormat,
} from "@/lib/admin-export/download";

export type AdminExportDatasetProvider = () =>
  | AdminExportDataset<never>
  | Promise<AdminExportDataset<never>>;

export function AdminExportMenu({
  dataset,
  disabled,
  label = "تصدير",
  testId = "admin-export-menu",
  size = "default",
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataset: () => AdminExportDataset<any> | Promise<AdminExportDataset<any>>;
  disabled?: boolean;
  label?: string;
  testId?: string;
  size?: "default" | "sm";
}) {
  const [busy, setBusy] = useState(false);

  const run = async (format: AdminExportFormat) => {
    if (busy) return;
    setBusy(true);
    try {
      const ds = await dataset();
      const result = exportAdminDataset(ds, format);
      toast.success(`تم تصدير ${result.rowCount} سجلًا إلى ${result.filename}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر إنشاء ملف التصدير.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={disabled || busy} data-testid={testId}>
          {busy ? (
            <Loader2 className="ms-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="ms-1 h-4 w-4" />
          )}
          {busy ? "جارٍ التصدير…" : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid={`${testId}-xlsx`}
          onSelect={(event) => {
            event.preventDefault();
            void run("xlsx");
          }}
        >
          {ADMIN_EXPORT_FORMAT_LABEL_AR.xlsx}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`${testId}-csv`}
          onSelect={(event) => {
            event.preventDefault();
            void run("csv");
          }}
        >
          {ADMIN_EXPORT_FORMAT_LABEL_AR.csv}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
