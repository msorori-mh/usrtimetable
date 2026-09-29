import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccessibleColleges } from "@/hooks/use-colleges";
import { fetchAcademicTerms, fetchScheduleVersions } from "@/lib/reports/queries/version-queries";
import { fetchRoomsInventory } from "@/lib/reports/queries/rooms-inventory";
import { fetchHydratedVersionSessions } from "@/lib/schedule-builder/queries";
import { buildRoomsReportSummary, roomsReportTotals } from "@/lib/print-center/rooms-report";
import { Card } from "@/components/ui/card";

type Totals = ReturnType<typeof roomsReportTotals>;
export function RoomsComparison(p: {
  collegeId: string;
  studySystem: "all" | "regular" | "parallel";
  currentLabel: string;
  totals: Totals;
}) {
  const colleges = useAccessibleColleges();
  const [college, setCollege] = useState(p.collegeId);
  const [term, setTerm] = useState("");
  const [version, setVersion] = useState("");
  const allowed = colleges.data?.some((c) => c.id === college) ?? false;
  const terms = useQuery({
    queryKey: ["rooms-comparison-terms", college],
    enabled: allowed,
    queryFn: () => fetchAcademicTerms(college),
  });
  const validTerm = !!term && !!terms.data?.some((t) => t.id === term);
  const versions = useQuery({
    queryKey: ["rooms-comparison-versions", college, term],
    enabled: allowed && validTerm,
    queryFn: () =>
      fetchScheduleVersions({ collegeId: college, termId: term, statusMode: "specific_version" }),
  });
  const validVersion = !!version && !!versions.data?.some((v) => v.id === version);
  const result = useQuery({
    queryKey: ["rooms-comparison", college, term, version, p.studySystem],
    enabled: allowed && validTerm && validVersion,
    queryFn: async () => {
      const [inventory, sessions] = await Promise.all([
        fetchRoomsInventory(college),
        fetchHydratedVersionSessions({
          collegeId: college,
          versionId: version,
          studySystem: p.studySystem,
        }),
      ]);
      const active = sessions.filter((s) => !s.replaced_by_split);
      return roomsReportTotals({
        summary: buildRoomsReportSummary({ ...inventory, sessions: active }),
        sessions: active,
      });
    },
  });
  const error = colleges.error ?? terms.error ?? versions.error ?? result.error;
  const metrics: { key: keyof Totals; label: string; unit?: string }[] = [
    { key: "rooms", label: "الموارد" },
    { key: "sessions", label: "المحاضرات" },
    { key: "scheduledHours", label: "المجدول في نسخة الكلية" },
    { key: "usedHours", label: "المستخدم داخل الإتاحة" },
    { key: "availableHours", label: "الإتاحة المعتمدة الحالية" },
    { key: "freeHours", label: "غير المشغول داخل الإتاحة" },
    { key: "outsideHours", label: "خارج الإتاحة" },
    { key: "utilization", label: "استغلال الإتاحة", unit: "%" },
  ];
  const label = `${colleges.data?.find((c) => c.id === college)?.name ?? ""} · ${terms.data?.find((t) => t.id === term)?.name ?? ""} · ${versions.data?.find((v) => v.id === version)?.name ?? ""}`;
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-bold">مقارنة الكليات والفصول</h2>
      <p className="text-xs text-muted-foreground">
        نظام الدراسة نفسه للطرفين. تُحسب إتاحة النسخ السابقة باستخدام مخزون القاعات وساعات فتحها
        الحالية؛ لا تمثل سجلًا تاريخيًا للإتاحة.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <label>
          كلية المقارنة
          <select
            className="block w-full rounded border bg-background p-2"
            value={college}
            onChange={(e) => {
              setCollege(e.target.value);
              setTerm("");
              setVersion("");
            }}
          >
            {colleges.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          فصل المقارنة
          <select
            className="block w-full rounded border bg-background p-2"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setVersion("");
            }}
          >
            <option value="">اختر الفصل</option>
            {terms.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          نسخة المقارنة
          <select
            className="block w-full rounded border bg-background p-2"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            disabled={!validTerm}
          >
            <option value="">اختر النسخة</option>
            {versions.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert">تعذر تحميل المقارنة. أعد اختيار النسخة للمحاولة مجددًا.</p>
      ) : result.isFetching ? (
        <p role="status">جارٍ تحميل المقارنة…</p>
      ) : validVersion && result.data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-2">المؤشر</th>
                <th className="p-2">الحالي: {p.currentLabel}</th>
                <th className="p-2">{label}</th>
                <th className="p-2">فرق الحالي عن المقارنة</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const a = Number(p.totals[m.key]),
                  b = Number(result.data[m.key]),
                  delta = Math.round((a - b) * 100) / 100;
                return (
                  <tr className="border-t" key={m.key}>
                    <th className="p-2">{m.label}</th>
                    <td className="p-2">
                      {a}
                      {m.unit}
                    </td>
                    <td className="p-2">
                      {b}
                      {m.unit}
                    </td>
                    <td className="p-2" dir="ltr">
                      {delta > 0 ? "+" : ""}
                      {delta}
                      {m.unit ? " نقطة مئوية" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          اختر فصلًا ونسخة لإظهار المقارنة. عدم وجود نسخة لا يعني أن الاستخدام صفر.
        </p>
      )}
    </Card>
  );
}
