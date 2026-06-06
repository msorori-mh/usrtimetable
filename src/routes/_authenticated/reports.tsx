import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import {
  UserSquare2, DoorOpen, Building2, CalendarClock, CheckCircle2, AlertTriangle, Gauge, FileBarChart2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "التقارير" }] }),
  component: ReportsHub,
});

const REPORTS = [
  { to: "/reports/instructor-workload", title: "أعباء المحاضرين", desc: "ساعات التدريس، التحميل الزائد/الناقص.", icon: <UserSquare2 className="h-5 w-5" /> },
  { to: "/reports/room-utilization", title: "استخدام القاعات", desc: "نسبة استغلال القاعات وساعات الفراغ.", icon: <DoorOpen className="h-5 w-5" /> },
  { to: "/reports/department-schedule", title: "جدول الأقسام", desc: "الجدول مجمّعًا حسب القسم/البرنامج/المستوى.", icon: <Building2 className="h-5 w-5" /> },
  { to: "/reports/instructor-schedule", title: "جدول المحاضر الفردي", desc: "الجدول الأسبوعي لكل محاضر.", icon: <CalendarClock className="h-5 w-5" /> },
  { to: "/reports/published-timetable", title: "الجدول المنشور", desc: "النسخ المنشورة فقط مع فلاتر.", icon: <CheckCircle2 className="h-5 w-5" /> },
  { to: "/reports/unscheduled", title: "الجلسات غير المجدوَلة", desc: "الجلسات الناقصة وأسبابها.", icon: <AlertTriangle className="h-5 w-5" /> },
  { to: "/reports/quality-summary", title: "ملخّص الجودة", desc: "نتيجة الجودة وتفصيل المخالفات.", icon: <Gauge className="h-5 w-5" /> },
];

function ReportsHub() {
  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-2">
        <FileBarChart2 className="h-6 w-6" />
        <h1 className="text-2xl font-bold">التقارير</h1>
      </div>
      <p className="text-sm text-muted-foreground">تقارير أكاديمية للقراءة فقط. التصدير: CSV و Excel.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => (
          <Link key={r.to} to={r.to} className="block">
            <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer h-full">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 text-primary p-2">{r.icon}</div>
                <div>
                  <div className="font-semibold">{r.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{r.desc}</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
