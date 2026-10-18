import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wrench, Library, UserSquare2, DoorOpen, ClipboardList } from "lucide-react";
import { userErrorMessage } from "@/lib/user-error";
import { fetchAll } from "@/components/data-cleanup/cleanup-data";
import { computeDiagnostics } from "@/components/data-cleanup/cleanup-diagnostics";
import { DashboardCards } from "@/components/data-cleanup/cleanup-shared";
import { CoursesSection } from "@/components/data-cleanup/courses-section";
import { InstructorsSection } from "@/components/data-cleanup/instructors-section";
import { RoomsSection } from "@/components/data-cleanup/rooms-section";
import { OfferingsSection } from "@/components/data-cleanup/offerings-section";

export const Route = createFileRoute("/_authenticated/data-cleanup")({
  head: () => ({ meta: [{ title: "تنظيف البيانات" }] }),
  component: DataCleanupPage,
});

// ---------- main ----------
function DataCleanupPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ["data-cleanup", active?.id],
    queryFn: () => fetchAll(active!.id),
    enabled: !!active?.id,
  });

  const diag = useMemo(() => (data ? computeDiagnostics(data) : null), [data]);

  if (!active) {
    return (
      <div className="space-y-4" dir="rtl">
        <h1 className="text-2xl font-bold">تنظيف البيانات</h1>
        <Card className="p-6">
          <CollegeSwitcher />
        </Card>
      </div>
    );
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["data-cleanup", active.id] });

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-6 w-6" />
          <h1 className="text-2xl font-bold">تنظيف البيانات</h1>
        </div>
        <div className="flex items-center gap-2">
          <CollegeSwitcher />
          <Link
            to="/data-readiness"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            ← جاهزية البيانات
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        تشخيص مشاكل جودة البيانات الأكاديمية قبل الجدولة وإصلاحها جماعياً. لا تُجرى أي إصلاحات
        تلقائية — كل عملية تتطلب تأكيداً صريحاً وتُسجَّل في سجل التدقيق.
      </p>

      {loadError && (
        <Card role="alert" className="border-destructive p-4 text-sm text-destructive">
          فشل تحميل بيانات التنظيف؛ لا تُعرض نتائج قد تكون مضللة.{" "}
          {userErrorMessage(loadError)}
        </Card>
      )}

      {/* Dashboard */}
      {!loadError && <DashboardCards diag={diag} loading={isLoading} />}

      {!canManage && (
        <Card className="border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          أنت بوضع المشاهدة. يمكنك استعراض المشاكل دون تنفيذ إصلاحات.
        </Card>
      )}

      <Tabs defaultValue="courses" dir="rtl">
        <TabsList>
          <TabsTrigger value="courses">
            <Library className="me-2 h-4 w-4" /> المقررات
          </TabsTrigger>
          <TabsTrigger value="instructors">
            <UserSquare2 className="me-2 h-4 w-4" /> المحاضرون
          </TabsTrigger>
          <TabsTrigger value="rooms">
            <DoorOpen className="me-2 h-4 w-4" /> القاعات
          </TabsTrigger>
          <TabsTrigger value="offerings">
            <ClipboardList className="me-2 h-4 w-4" /> إسناد المقررات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="mt-4">
          <CoursesSection
            data={data}
            diag={diag}
            canManage={canManage}
            onChanged={invalidate}
            collegeId={active.id}
          />
        </TabsContent>
        <TabsContent value="instructors" className="mt-4">
          <InstructorsSection
            data={data}
            diag={diag}
            canManage={canManage}
            onChanged={invalidate}
            collegeId={active.id}
          />
        </TabsContent>
        <TabsContent value="rooms" className="mt-4">
          <RoomsSection
            data={data}
            diag={diag}
            canManage={canManage}
            onChanged={invalidate}
            collegeId={active.id}
          />
        </TabsContent>
        <TabsContent value="offerings" className="mt-4">
          <OfferingsSection
            data={data}
            diag={diag}
            canManage={canManage}
            onChanged={invalidate}
            collegeId={active.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
