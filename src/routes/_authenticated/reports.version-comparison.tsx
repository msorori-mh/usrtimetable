import { createFileRoute } from "@tanstack/react-router";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  assertSameCollegeVersions,
  compareScheduleVersions,
  type CompareSession,
} from "@/lib/schedule-version-comparison";
import { analyzeScheduleQuality } from "@/lib/schedule-quality-analytics";

export const Route = createFileRoute("/_authenticated/reports/version-comparison")({
  head: () => ({ meta: [{ title: "مقارنة نسخ الجداول" }] }),
  component: VersionComparisonPage,
});

function VersionComparisonPage() {
  const { active } = useActiveCollege();
  const [versionA, setVersionA] = useState("");
  const [versionB, setVersionB] = useState("");

  const { data: versions } = useQuery({
    queryKey: ["vc-versions", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("schedule_versions")
          .select("id, name, status, college_id, academic_term_id")
          .eq("college_id", active!.id)
          .order("created_at", { ascending: false })
      ).data ?? [],
  });

  const termFiltered = useMemo(() => {
    if (!versionA || !versions) return versions ?? [];
    const a = versions.find((v) => v.id === versionA);
    if (!a?.academic_term_id) return versions;
    return versions.filter((v) => v.academic_term_id === a.academic_term_id);
  }, [versions, versionA]);

  const loadSessions = async (versionId: string) => {
    const { data, error } = await supabase
      .from("schedule_sessions")
      .select(
        "id, college_id, schedule_version_id, instructor_id, room_id, cohort_id, delivery_group_id, study_system, day_of_week, start_time, end_time, course_offering_id, teaching_assignment_id",
      )
      .eq("college_id", active!.id)
      .eq("schedule_version_id", versionId)
      .order("id");
    if (error) throw error;
    return (data ?? []) as CompareSession[];
  };

  const { data: pair, isLoading } = useQuery({
    queryKey: ["vc-pair", active?.id, versionA, versionB],
    enabled: !!active && !!versionA && !!versionB && versionA !== versionB,
    queryFn: async () => {
      const vaMeta = versions?.find((v) => v.id === versionA);
      const vbMeta = versions?.find((v) => v.id === versionB);
      if (!assertSameCollegeVersions(vaMeta?.college_id, vbMeta?.college_id, active!.id)) {
        throw new Error("CROSS_COLLEGE_DENIED");
      }
      const [a, b] = await Promise.all([loadSessions(versionA), loadSessions(versionB)]);
      return { a, b };
    },
  });

  const result = useMemo(() => {
    if (!pair) return null;
    return compareScheduleVersions({
      versionA: pair.a,
      versionB: pair.b,
      collegeId: active?.id,
    });
  }, [pair, active?.id]);

  const qualitySummary = useMemo(() => {
    if (!pair) return null;
    const qa = analyzeScheduleQuality({ sessions: pair.a, collegeId: active?.id });
    const qb = analyzeScheduleQuality({ sessions: pair.b, collegeId: active?.id });
    return {
      score_a: qa.total_score,
      score_b: qb.total_score,
      hard_a: qa.hard_conflicts,
      hard_b: qb.hard_conflicts,
      unscheduled_a: qa.unscheduled_count,
      unscheduled_b: qb.unscheduled_count,
      gaps_a: qa.cohort_gaps + qa.instructor_gaps,
      gaps_b: qb.cohort_gaps + qb.instructor_gaps,
      room_a: qa.room_overuse,
      room_b: qb.room_overuse,
    };
  }, [pair, active?.id]);

  const exportRows = useMemo(
    () =>
      (result?.changes ?? []).map((c) => ({
        kind: c.kind,
        study_system: c.study_system,
        detail: c.detail_ar,
        before_id: c.before_id ?? "",
        after_id: c.after_id ?? "",
        match_key: c.match_key,
      })),
    [result],
  );

  const headers = [
    { key: "kind", label: "النوع" },
    { key: "study_system", label: "النظام" },
    { key: "detail", label: "التفصيل" },
    { key: "before_id", label: "قبل" },
    { key: "after_id", label: "بعد" },
    { key: "match_key", label: "مفتاح المطابقة" },
  ];

  return (
    <div dir="rtl">
      <ReportShell
        title="مقارنة نسخ الجداول"
        description="مقارنة قراءة فقط لنسختين من نفس الكلية والفصل — بلا clone أو تعديل."
        filename="version_comparison"
        rows={exportRows}
        headers={headers}
        isLoading={isLoading}
        filters={
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">النسخة أ</label>
              <Select value={versionA || undefined} onValueChange={setVersionA}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر" />
                </SelectTrigger>
                <SelectContent>
                  {(versions ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} ({v.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">النسخة ب (نفس الفصل)</label>
              <Select value={versionB || undefined} onValueChange={setVersionB}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر" />
                </SelectTrigger>
                <SelectContent>
                  {termFiltered
                    .filter((v) => v.id !== versionA)
                    .map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name} ({v.status})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        }
      >
        {!versionA || !versionB || versionA === versionB ? (
          <Card className="p-4 text-sm text-muted-foreground">
            اختر نسختين مختلفتين من نفس الكلية والفصل. لا تُنشأ نسخ جديدة للاختبار.
          </Card>
        ) : null}

        {result && qualitySummary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Card className="p-3">
                جلسات أ/ب: {result.summary.sessions_a} / {result.summary.sessions_b}
              </Card>
              <Card className="p-3">
                جودة أ/ب: {qualitySummary.score_a} / {qualitySummary.score_b}
              </Card>
              <Card className="p-3">
                تعارضات أ/ب: {qualitySummary.hard_a} / {qualitySummary.hard_b}
              </Card>
              <Card className="p-3">
                غير مجدول أ/ب: {qualitySummary.unscheduled_a} / {qualitySummary.unscheduled_b}
              </Card>
              <Card className="p-3">مضاف: {result.summary.added}</Card>
              <Card className="p-3">محذوف: {result.summary.removed}</Card>
              <Card className="p-3">وقت: {result.summary.time_changed}</Card>
              <Card className="p-3">قاعة: {result.summary.room_changed}</Card>
              <Card className="p-3">مدرس/مجموعة: {result.summary.instructor_or_group_changed}</Card>
              <Card className="p-3">بدون تغيير: {result.summary.unchanged}</Card>
              <Card className="p-3">أثر طلاب: {result.student_impact}</Card>
              <Card className="p-3">أثر قاعات: {result.room_impact}</Card>
            </div>

            <Card className="p-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {headers.map((h) => (
                      <TableHead key={h.key}>{h.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.changes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={headers.length}>
                        لا تغييرات — النسختان متطابقتان منطقيًا.
                      </TableCell>
                    </TableRow>
                  ) : (
                    result.changes.map((c, i) => (
                      <TableRow key={`${c.kind}-${c.match_key}-${i}`}>
                        <TableCell>{c.kind}</TableCell>
                        <TableCell>{c.study_system}</TableCell>
                        <TableCell className="text-xs">{c.detail_ar}</TableCell>
                        <TableCell className="text-xs font-mono">{c.before_id ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{c.after_id ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{c.match_key}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}
      </ReportShell>
    </div>
  );
}
