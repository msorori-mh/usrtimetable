import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { ReportShell } from "@/components/reports/report-shell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildSmartSuggestions, type SuggestionSession } from "@/lib/smart-suggestions";

export const Route = createFileRoute("/_authenticated/reports/smart-suggestions")({
  head: () => ({ meta: [{ title: "اقتراحات الجدولة الذكية" }] }),
  component: SmartSuggestionsPage,
});

function SmartSuggestionsPage() {
  const { active } = useActiveCollege();
  const [versionId, setVersionId] = useState("");

  const { data: versions } = useQuery({
    queryKey: ["ss-versions", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("schedule_versions")
          .select("id, name, status")
          .eq("college_id", active!.id)
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const effective =
    versionId || versions?.find((v) => v.status === "published")?.id || versions?.[0]?.id || "";

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["ss-sessions", active?.id, effective],
    enabled: !!active && !!effective,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_sessions")
        .select(
          "id, college_id, instructor_id, room_id, cohort_id, delivery_group_id, study_system, day_of_week, start_time, end_time, expected_students",
        )
        .eq("college_id", active!.id)
        .eq("schedule_version_id", effective);
      if (error) throw error;
      return (data ?? []) as SuggestionSession[];
    },
  });

  const { data: rooms } = useQuery({
    queryKey: ["ss-rooms", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("rooms")
          .select("id, capacity, room_type_id")
          .eq("college_id", active!.id)
      ).data ?? [],
  });

  const { data: unplaced } = useQuery({
    queryKey: ["ss-unplaced", active?.id, effective],
    enabled: !!active && !!effective,
    queryFn: async () => {
      const { data } = await supabase
        .from("auto_schedule_runs")
        .select("unplaced, created_at")
        .eq("college_id", active!.id)
        .eq("schedule_version_id", effective)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const raw = (data?.unplaced as unknown) ?? [];
      if (!Array.isArray(raw)) return [];
      return raw.map((u: Record<string, unknown>, i: number) => ({
        id: String(u.id ?? u.delivery_group_id ?? `u-${i}`),
        study_system: (u.study_system as string) ?? "regular",
        instructor_id: (u.instructor_id as string) ?? null,
        cohort_id: (u.cohort_id as string) ?? null,
        delivery_group_id: (u.delivery_group_id as string) ?? null,
        expected_students: (u.expected_students as number) ?? null,
        reason_ar: (u.reason_ar as string) ?? (u.reason as string) ?? undefined,
        college_id: active!.id,
      }));
    },
  });

  const suggestions = useMemo(() => {
    if (!sessions) return [];
    const items =
      unplaced && unplaced.length > 0
        ? unplaced
        : [
            {
              id: "demo-unscheduled-placeholder",
              study_system: "regular",
              instructor_id: null,
              reason_ar: "لا توجد عناصر unplaced في آخر تشغيل — معاينة تفسيرية فقط",
              college_id: active?.id,
            },
          ];
    return buildSmartSuggestions({
      unscheduled: items,
      existingSessions: sessions,
      rooms: rooms ?? [],
      collegeId: active?.id,
    });
  }, [sessions, rooms, unplaced, active?.id]);

  const rows = suggestions.flatMap((s) =>
    s.alternatives.length === 0
      ? [
          {
            item: s.item_id,
            reason: s.exact_reason_ar,
            alt: "—",
            quality: "",
            impact: "معاينة فقط — بلا تطبيق تلقائي",
            rejected: "",
          },
        ]
      : s.alternatives.map((a, i) => ({
          item: s.item_id,
          reason: s.exact_reason_ar,
          alt: `${i + 1}) يوم ${a.slot.day_of_week} ${a.slot.start_time}-${a.slot.end_time} قاعة ${a.slot.room_id}`,
          quality: String(a.quality),
          impact: a.impact_ar,
          rejected: a.rejected_others_ar.join(" | "),
        })),
  );

  const headers = [
    { key: "item", label: "العنصر" },
    { key: "reason", label: "السبب" },
    { key: "alt", label: "بديل" },
    { key: "quality", label: "جودة" },
    { key: "impact", label: "الأثر" },
    { key: "rejected", label: "بدائل مرفوضة" },
  ];

  return (
    <div dir="rtl">
      <ReportShell
        title="اقتراحات الجدولة الذكية (معاينة)"
        description="تفسير أسباب عدم الجدولة وبدائل آمنة — بلا auto-apply وبلا كتابة."
        filename="smart_suggestions_preview"
        rows={rows}
        headers={headers}
        isLoading={isLoading}
        filters={
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">النسخة</label>
              <Select value={effective || undefined} onValueChange={setVersionId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر" />
                </SelectTrigger>
                <SelectContent>
                  {(versions ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs flex flex-col justify-end gap-1">
              <Badge variant="outline">preview_only · auto_apply=false</Badge>
              <Link className="underline" to="/reports/unscheduled">
                تقرير غير المجدول
              </Link>
            </div>
          </div>
        }
      >
        <Card className="p-3 text-sm text-muted-foreground mb-3">
          هذه الصفحة للمعاينة فقط. لن يُحفظ أي تغيير على الجلسات من هنا.
        </Card>
        <div className="space-y-3">
          {suggestions.map((s) => (
            <Card key={s.item_id} className="p-3">
              <div className="font-medium">{s.item_id}</div>
              <div className="text-sm mt-1">{s.exact_reason_ar}</div>
              <ul className="mt-2 text-xs list-disc pr-5 space-y-1">
                {s.alternatives.map((a, i) => (
                  <li key={i}>
                    بديل {i + 1}: يوم {a.slot.day_of_week} {a.slot.start_time}-{a.slot.end_time} ·
                    قاعة {a.slot.room_id} · جودة {a.quality} — {a.impact_ar}
                  </li>
                ))}
                {s.alternatives.length === 0 ? <li>لا بدائل آمنة ضمن القواعد الحالية</li> : null}
              </ul>
            </Card>
          ))}
        </div>
      </ReportShell>
    </div>
  );
}
