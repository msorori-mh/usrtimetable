import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PORTAL_FOUNDATION_ROLES_TODAY,
  PORTAL_FUTURE_ROLES_NOT_IN_ENUM,
  PORTAL_PLANNED_PAGES,
  PORTAL_RBAC_NOTES_AR,
} from "@/lib/portal/foundation";

export const Route = createFileRoute("/_authenticated/portal/student")({
  head: () => ({ meta: [{ title: "بوابة الطالب — أساس" }] }),
  component: StudentPortalFoundationPage,
});

function StudentPortalFoundationPage() {
  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{PORTAL_RBAC_NOTES_AR.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">طالب — قراءة فقط · Mobile-first · RTL</p>
      </div>

      <Card className="p-4 text-sm space-y-2">
        <Badge variant="outline">SOURCE FOUNDATION · لا Migration أدوار</Badge>
        <p>{PORTAL_RBAC_NOTES_AR.body}</p>
        <p className="text-muted-foreground">{PORTAL_RBAC_NOTES_AR.noEmailMatching}</p>
        <p className="text-muted-foreground">{PORTAL_RBAC_NOTES_AR.collegeIsolation}</p>
        <p className="text-muted-foreground">{PORTAL_RBAC_NOTES_AR.noAdminControls}</p>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-medium">صفحات مخططة (واجهات مستقبلية)</div>
        <ul className="text-sm list-disc pr-5 space-y-1">
          {PORTAL_PLANNED_PAGES.map((p) => (
            <li key={p.id}>
              {p.title_ar} <span className="text-xs text-muted-foreground">({p.path})</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4 text-xs space-y-1">
        <div>أدوار اليوم: {PORTAL_FOUNDATION_ROLES_TODAY.join(" · ")}</div>
        <div>
          أدوار مستقبلية (غير موجودة في enum): {PORTAL_FUTURE_ROLES_NOT_IN_ENUM.join(" · ")}
        </div>
        <Link className="underline" to="/portal/instructor">
          أساس بوابة المدرس
        </Link>
      </Card>
    </div>
  );
}
