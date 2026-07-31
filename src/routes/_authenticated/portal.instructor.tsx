import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PORTAL_FOUNDATION_ROLES_TODAY,
  PORTAL_FUTURE_ROLES_NOT_IN_ENUM,
  PORTAL_RBAC_NOTES_AR,
} from "@/lib/portal/foundation";

export const Route = createFileRoute("/_authenticated/portal/instructor")({
  head: () => ({ meta: [{ title: "بوابة المدرس — أساس" }] }),
  component: InstructorPortalFoundationPage,
});

function InstructorPortalFoundationPage() {
  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{PORTAL_RBAC_NOTES_AR.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">مدرس — قراءة فقط · Mobile-first · RTL</p>
      </div>

      <Card className="p-4 text-sm space-y-2">
        <Badge variant="outline">SOURCE FOUNDATION · لا Migration أدوار</Badge>
        <p>{PORTAL_RBAC_NOTES_AR.body}</p>
        <p className="text-muted-foreground">{PORTAL_RBAC_NOTES_AR.noEmailMatching}</p>
        <p className="text-muted-foreground">{PORTAL_RBAC_NOTES_AR.collegeIsolation}</p>
        <p className="text-muted-foreground">{PORTAL_RBAC_NOTES_AR.noAdminControls}</p>
      </Card>

      <Card className="p-4 space-y-2 text-sm">
        <div className="font-medium">مخطط الواجهة</div>
        <ul className="list-disc pr-5 space-y-1">
          <li>جدول اليوم / الأسبوع من الجلسات المنشورة فقط</li>
          <li>تفاصيل الجلسة بلا أدوات إدارة</li>
          <li>التغييرات الحديثة وتنزيل PDF عبر مسارات الطباعة الآمنة لاحقًا</li>
          <li>لا كشف بيانات كلية أخرى</li>
        </ul>
      </Card>

      <Card className="p-4 text-xs space-y-1">
        <div>أدوار اليوم: {PORTAL_FOUNDATION_ROLES_TODAY.join(" · ")}</div>
        <div>أدوار مستقبلية (غير موجودة): {PORTAL_FUTURE_ROLES_NOT_IN_ENUM.join(" · ")}</div>
        <Link className="underline" to="/portal/student">
          أساس بوابة الطالب
        </Link>
        <div>
          مرجع تقرير المدرس الحالي (إداري):{" "}
          <Link className="underline" to="/reports/instructor-schedule">
            /reports/instructor-schedule
          </Link>
        </div>
      </Card>
    </div>
  );
}
