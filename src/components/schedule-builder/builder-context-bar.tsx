import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR,
  SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR,
} from "@/lib/schedule-builder/access";
import { type WorkspaceStudySystem } from "@/lib/schedule-builder/queries";
import { STATUS_LABEL_AR, type SVStatus } from "@/lib/schedule-versions/lifecycle";
import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import { useScheduleBuilderWorkspace } from "@/hooks/use-schedule-builder-workspace";
import { ErrorInline } from "@/components/schedule-builder/builder-ui";

/** Term / version / study-system context bar of the schedule builder (split from schedule-builder.tsx, L-14). */
export function BuilderContextBar({ ws }: { ws: ReturnType<typeof useScheduleBuilderWorkspace> }) {
  const {
    termId,
    versionId,
    studySystem,
    termsQuery,
    canLoadVersions,
    versionsQuery,
    requestWithUnsavedGuard,
  } = ws;
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">سياق الجدول</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>الفصل الدراسي</Label>
          {termsQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : termsQuery.isError ? (
            <ErrorInline message="تعذّر تحميل الفصول الدراسية." />
          ) : !termsQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">
              {SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR}
            </p>
          ) : (
            <Select
              value={termId ?? undefined}
              onValueChange={(v) => {
                requestWithUnsavedGuard({ kind: "set-term", termId: v });
              }}
            >
              <SelectTrigger aria-label="الفصل الدراسي">
                <SelectValue placeholder="اختر الفصل" />
              </SelectTrigger>
              <SelectContent>
                {termsQuery.data.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.is_active ? " (فعّال)" : ""}
                    {t.academic_year ? ` · ${t.academic_year}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label>نسخة الجدول</Label>
          {!canLoadVersions ? (
            <p className="text-sm text-muted-foreground">اختر فصلًا دراسيًا أولًا.</p>
          ) : versionsQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : versionsQuery.isError ? (
            <ErrorInline message="تعذّر تحميل نسخ الجدول." />
          ) : !versionsQuery.data?.length ? (
            <p className="text-sm text-muted-foreground">
              {SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR}
            </p>
          ) : (
            <Select
              value={versionId ?? undefined}
              onValueChange={(v) => {
                requestWithUnsavedGuard({ kind: "set-version", versionId: v });
              }}
            >
              <SelectTrigger aria-label="نسخة الجدول">
                <SelectValue placeholder="اختر النسخة" />
              </SelectTrigger>
              <SelectContent>
                {versionsQuery.data.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} — {STATUS_LABEL_AR[v.status as SVStatus] ?? v.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="bctx-f1">النظام الدراسي</Label>
          <Select
            value={studySystem}
            onValueChange={(v) => {
              requestWithUnsavedGuard({
                kind: "set-study-system",
                studySystem: v as WorkspaceStudySystem,
              });
            }}
          >
            <SelectTrigger id="bctx-f1" aria-label="النظام الدراسي">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">النظامان معًا (العام والموازي)</SelectItem>
              <SelectItem value="regular">{STUDY_SYSTEM_LABELS.regular}</SelectItem>
              <SelectItem value="parallel">{STUDY_SYSTEM_LABELS.parallel}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
