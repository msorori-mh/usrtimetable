import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, CalendarClock, ShieldCheck } from "lucide-react";
import { fetchInstructorAvailabilityReadiness } from "@/lib/availability/policy-api";
import { formatNumber } from "@/lib/format";
import { InstructorUnavailability } from "@/components/availability/instructor-unavailability";
import { InstructorRequests } from "@/components/availability/instructor-requests";
import { RoomUnavailability } from "@/components/availability/room-unavailability";

export const Route = createFileRoute("/_authenticated/availability")({
  head: () => ({ meta: [{ title: "إتاحة الموارد وطلبات المحاضرين" }] }),
  component: AvailabilityPage,
});

function AvailabilityPage() {
  const { active } = useActiveCollege();
  const {
    data: readiness,
    isLoading: availabilityPolicyLoading,
    isError: availabilityPolicyError,
  } = useQuery({
    queryKey: ["instructor-availability-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchInstructorAvailabilityReadiness(active!.id),
  });
  const instructorAvailabilityEnabled = readiness?.enabled === true;
  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">إتاحة الموارد وطلبات المحاضرين</h1>
          <p className="text-sm text-muted-foreground">
            إدارة نوافذ التوفر والمنع الإلزامية، والتفضيلات، وطلبات العبء والحضور قبل الجدولة.
          </p>
        </div>
      </header>

      <div className="mb-4">
        <CollegeSwitcher />
      </div>

      {!active ? (
        <p className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          اختر كلّية أولاً.
        </p>
      ) : (
        <div className="space-y-4">
          <Card
            className={`flex flex-col gap-3 border p-4 sm:flex-row sm:items-center sm:justify-between ${
              availabilityPolicyError
                ? "border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20"
                : instructorAvailabilityEnabled
                  ? "border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : "border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
            }`}
          >
            <div className="flex items-start gap-3">
              {!availabilityPolicyError && instructorAvailabilityEnabled ? (
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
              ) : (
                <AlertTriangle
                  className={`mt-0.5 h-5 w-5 shrink-0 ${availabilityPolicyError ? "text-red-700" : "text-amber-700"}`}
                />
              )}
              <div>
                <p className="font-semibold">
                  {availabilityPolicyLoading
                    ? "جارٍ التحقق من حالة القيد..."
                    : availabilityPolicyError
                      ? "تعذر التحقق من حالة تطبيق القيد"
                      : instructorAvailabilityEnabled
                        ? "إتاحة المحاضرين مطبّقة على الجدولة"
                        : "إتاحة المحاضرين محفوظة ولكن غير مطبّقة"}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {availabilityPolicyError
                    ? "لا تعتمد على حالة الإتاحة قبل إعادة المحاولة؛ لم تُفترض قيمة بديلة عند فشل قراءة الإعداد."
                    : instructorAvailabilityEnabled
                      ? `تطبق القيود في المولّد والتحقق والحفظ. نوافذ إلزامية: ${readiness?.hard_windows ?? 0} · تفضيلات: ${readiness?.preference_windows ?? 0}.`
                      : `يمكن تجهيز النوافذ والطلبات الآن. المتبقي قبل التفعيل: ${readiness?.missing_required_instructors ?? 0} محاضر خارجي بلا توفر صريح.`}
                </p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link to="/scheduling-settings">إدارة التفعيل</Link>
            </Button>
          </Card>

          <Tabs defaultValue="instructor">
            <TabsList>
              <TabsTrigger value="instructor">إتاحة المحاضرين</TabsTrigger>
              <TabsTrigger value="requests">
                الطلبات{readiness?.pending_requests ? ` (${formatNumber(readiness.pending_requests)})` : ""}
              </TabsTrigger>
              <TabsTrigger value="room">عدم توفّر القاعات</TabsTrigger>
            </TabsList>
            <TabsContent value="instructor" className="mt-4">
              <InstructorUnavailability />
            </TabsContent>
            <TabsContent value="requests" className="mt-4">
              <InstructorRequests />
            </TabsContent>
            <TabsContent value="room" className="mt-4">
              <RoomUnavailability />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}
