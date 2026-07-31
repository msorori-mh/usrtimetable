import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveCollege } from "@/hooks/use-colleges";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/system-health")({
  head: () => ({ meta: [{ title: "صحة النظام والنسخ الاحتياطي" }] }),
  component: SystemHealthPage,
});

/** Build-time / public safe markers only — never tokens or connection strings. */
const MAIN_SHA_HINT = "see GitHub main";
const PROTECTED_VERSION = "835e50fe-3ad2-4232-8c15-0f403c668a7f";

function SystemHealthPage() {
  const { active } = useActiveCollege();

  const { data: versions } = useQuery({
    queryKey: ["health-versions", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("schedule_versions")
          .select("id, name, status")
          .eq("college_id", active!.id)
          .order("created_at", { ascending: false })
          .limit(20)
      ).data ?? [],
  });

  const incomplete = versions?.filter((v) => v.status === "draft" || v.status === "review") ?? [];
  const protectedRow = versions?.find((v) => v.id === PROTECTED_VERSION);

  const rows = [
    { label: "آخر deployment", value: "انظر ترويسة x-deployment-id على الموقع الحي" },
    { label: "main SHA", value: MAIN_SHA_HINT },
    { label: "CI", value: "راجع GitHub Actions / runtime-gates" },
    { label: "dependency audit", value: "bun audit (محلي/CI) — لا تُعرض مفاتيح" },
    { label: "active security findings", value: "لوحة Lovable Security (قراءة)" },
    { label: "migrations pending", value: "PR #129 data_classification (غير مطبّقة)" },
    { label: "open critical PRs", value: "راجع قائمة overnight queue" },
    {
      label: "schedule versions incomplete",
      value: String(incomplete.length),
    },
    {
      label: "protected demo version",
      value: protectedRow
        ? `${protectedRow.status} — ${protectedRow.name}`
        : "غير ظاهرة ضمن الكلية النشطة / أو خارج الصفحة",
    },
    { label: "last verified delivery package", value: "docs/PLATFORM-LAUNCH ZIP checksums" },
  ];

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">صحة النظام والنسخ الاحتياطي</h1>
        <p className="text-sm text-muted-foreground mt-1">
          لوحة قراءة فقط — بلا tokens أو connection strings أو service keys.
        </p>
      </div>

      <Card className="p-3 text-sm">
        Runbook: `docs/PLATFORM-LAUNCH/BACKUP-RESTORE-READINESS-RUNBOOK.md` — لا يُنفَّذ
        backup/restore إنتاجي من هذه الصفحة.
      </Card>

      <div className="grid gap-3">
        {rows.map((r) => (
          <Card key={r.label} className="p-3 flex flex-col md:flex-row md:justify-between gap-2">
            <span className="text-sm font-medium">{r.label}</span>
            <span className="text-sm text-muted-foreground">{r.value}</span>
          </Card>
        ))}
      </div>

      <Card className="p-3 space-y-2">
        <div className="font-medium">نسخ غير مكتملة (draft/review)</div>
        {incomplete.length === 0 ? (
          <Badge variant="outline">لا يوجد ضمن آخر 20</Badge>
        ) : (
          <ul className="text-xs list-disc pr-5">
            {incomplete.map((v) => (
              <li key={v.id}>
                {v.name} — {v.status}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
