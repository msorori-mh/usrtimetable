import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PreparationWorkspace } from "@/components/data-onboarding/preparation-workspace";
import { ImportWorkspace } from "@/components/data-onboarding/import-workspace";
import { fetchOnboardingReadinessSnapshot } from "@/lib/data-onboarding/snapshot";
import {
  parsePreparationSearch,
  preparationEntities,
  resolvePreparationProgress,
  type PreparationStepId,
} from "@/lib/data-onboarding/preparation";
import type { ImportEntity } from "@/lib/excel-import/types";

export const Route = createFileRoute("/_authenticated/data-onboarding")({
  head: () => ({ meta: [{ title: "تجهيز بيانات الكلية" }] }),
  validateSearch: parsePreparationSearch,
  component: DataOnboardingPage,
});

function DataOnboardingPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["data-onboarding-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchOnboardingReadinessSnapshot(active!.id),
    refetchOnMount: "always",
  });
  const step =
    search.step ??
    (data ? resolvePreparationProgress(data.steps).nextStepId : "academic_structure");
  // Pin the inspected step so a successful import keeps its result visible while readiness refreshes.
  useEffect(() => {
    if (data && !search.step) void navigate({ search: { ...search, step }, replace: true });
  }, [data, search, step, navigate]);
  const onSelect = (next: PreparationStepId, entity?: ImportEntity, help?: boolean) => {
    void navigate({
      search: { step: next, ...(entity ? { entity } : {}), ...(help ? { help: true } : {}) },
      replace: true,
    });
  };
  const entities = preparationEntities(step, data?.hasElectives ?? false);
  // A supported optional import remains reachable through old bookmarked import links.
  const allowedEntities =
    search.entity && !entities.includes(search.entity) ? [search.entity] : entities;
  const orderedEntities = search.entity
    ? [search.entity, ...allowedEntities.filter((e) => e !== search.entity)]
    : allowedEntities;
  return (
    <div className="mx-auto max-w-6xl space-y-5" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">تجهيز بيانات الكلية</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            اعرف ما اكتمل وما ينقص، وجهّز كل نوع من البيانات من خطوته.
          </p>
        </div>
        <CollegeSwitcher />
      </header>
      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">
          اختر الكلية لعرض خطوات تجهيز بياناتها.
        </Card>
      ) : isLoading && !data ? (
        <Card className="p-6" role="status">
          جارٍ فحص بيانات الكلية…
        </Card>
      ) : isError ? (
        <Card className="space-y-3 p-5" role="alert">
          <p>تعذر تحديث حالة البيانات. أعد المحاولة للتأكد من النواقص قبل المتابعة.</p>
          <Button onClick={() => void refetch()} disabled={isFetching}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              آخر فحص: {new Date(data.checkedAt).toLocaleString("ar")}
              {isFetching ? " · جارٍ التحديث…" : ""}
            </span>
            <div className="flex items-center gap-3">
              <Link to="/import-history" className="hover:underline">
                سجل الاستيراد
              </Link>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> إعادة الفحص
              </Button>
            </div>
          </div>
          <PreparationWorkspace
            key={active.id}
            snapshot={data}
            selectedStep={step}
            selectedEntity={search.entity}
            showHelp={search.help}
            canManage={canManage}
            refreshing={isFetching}
            onSelect={onSelect}
            importer={
              <ImportWorkspace
                entities={orderedEntities}
                onEntityChange={(entity) => onSelect(step, entity, search.help)}
                onCommitted={() => void refetch()}
              />
            }
          />
        </>
      ) : null}
    </div>
  );
}
