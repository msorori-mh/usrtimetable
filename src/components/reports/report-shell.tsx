import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Download, FileSpreadsheet } from "lucide-react";
import { CollegeSwitcher } from "@/components/college-switcher";
import { downloadCSV, downloadXLSX, type Row } from "@/lib/reports/export";

interface Props {
  title: string;
  description?: string;
  filters?: ReactNode;
  rows: Row[];
  headers: { key: string; label: string }[];
  filename: string;
  children?: ReactNode;
  isLoading?: boolean;
  emptyMessage?: string;
}

export function ReportShell({
  title, description, filters, rows, headers, filename, children, isLoading, emptyMessage,
}: Props) {
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/reports"><ArrowRight className="h-4 w-4 ml-1" /> العودة</Link>
            </Button>
            <h1 className="text-2xl font-bold">{title}</h1>
          </div>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <CollegeSwitcher />
          <Button variant="outline" size="sm" disabled={!rows.length}
            onClick={() => downloadCSV(rows, headers, filename)}>
            <Download className="h-4 w-4 ml-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" disabled={!rows.length}
            onClick={() => downloadXLSX(rows, headers, filename)}>
            <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
          </Button>
        </div>
      </div>

      {filters && <Card className="p-4">{filters}</Card>}

      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">جارٍ التحميل…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          {emptyMessage ?? "لا توجد بيانات بهذه المعايير."}
        </Card>
      ) : (
        children
      )}
    </div>
  );
}
