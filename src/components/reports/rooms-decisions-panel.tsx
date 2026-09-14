import { useQuery } from "@tanstack/react-query";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import {
  fetchRoomDecisionConstraints,
  fetchRoomsInventory,
  fetchRoomOccupancy,
} from "@/lib/reports/queries/rooms-inventory";
import {
  capacityPoints,
  suggestRoomMoves,
  type DecisionSession,
} from "@/lib/reports/room-decisions";
import { RoomWeeklyInspector } from "./room-weekly-inspector";

export function RoomsDecisionsPanel(p: {
  collegeId: string;
  versionId: string;
  studySystem: string;
  sessions: DecisionSession[];
  inventory: Awaited<ReturnType<typeof fetchRoomsInventory>>;
}) {
  const data = useQuery({
    queryKey: ["rooms-decisions", p.collegeId, p.versionId],
    queryFn: async () => {
      const [sessions, constraints] = await Promise.all([
        fetchRoomOccupancy(p.collegeId, p.versionId),
        fetchRoomDecisionConstraints(p.collegeId),
      ]);
      return { sessions, ...constraints };
    },
  });
  const points = capacityPoints(p.inventory.rooms, p.sessions);
  const moves = data.data
    ? suggestRoomMoves({
        ...p.inventory,
        ...data.data,
        visibleIds: new Set(p.sessions.map((s) => s.id)),
      })
    : [];
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="font-bold">سعة القاعة مقابل عدد الطلاب</h2>
        <p className="text-xs text-muted-foreground">
          كل نقطة قاعة: السعة أفقيًا ومتوسط العدد المسجل للمحاضرات رأسيًا. هذه أعداد التخطيط وليست
          سجل حضور فعلي؛ تُستبعد الأعداد المفقودة.
        </p>
        {points.length ? (
          <>
            <div className="h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 25, left: 20 }}>
                  <CartesianGrid />
                  <XAxis
                    type="number"
                    dataKey="capacity"
                    name="سعة القاعة"
                    label={{ value: "سعة القاعة", position: "bottom" }}
                  />
                  <YAxis type="number" dataKey="students" name="متوسط الطلاب" />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <div className="rounded border bg-background p-3 text-right" dir="rtl">
                          {payload[0].payload.name}
                          <br />
                          السعة: {payload[0].payload.capacity} · متوسط الطلاب:{" "}
                          {payload[0].payload.students}
                        </div>
                      ) : null
                    }
                  />
                  <Scatter data={points} fill="var(--color-primary)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <details>
              <summary className="cursor-pointer text-sm">عرض أرقام الرسم</summary>
              <ul className="text-sm">
                {points.map((r) => (
                  <li key={r.id}>
                    {r.name}: {r.students} طالبًا من سعة {r.capacity}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p>لا توجد أعداد طلاب موثقة في المحاضرات المعروضة لرسم المقارنة.</p>
        )}
      </Card>
      {data.isPending ? (
        <p role="status">جارٍ فحص إشغال النظامين وإغلاقات القاعات…</p>
      ) : data.error ? (
        <Card className="p-4">
          <p role="alert">تعذر التحقق من الإشغال والقيود؛ حُجبت اقتراحات النقل.</p>
          <button onClick={() => void data.refetch()}>إعادة المحاولة</button>
        </Card>
      ) : data.data ? (
        <>
          <RoomWeeklyInspector
            {...p.inventory}
            sessions={data.data.sessions}
            closures={data.data.closures}
            studySystem={p.studySystem}
          />
          <Card className="space-y-3 p-4">
            <h2 className="font-bold">اقتراحات لتحسين تسكين القاعات</h2>
            <p className="text-xs text-muted-foreground">
              بدائل مستقلة لتقليل المقاعد غير المستغلة، مع إبقاء الوقت والمدرس. فُحص نوع القاعة
              المطلوب والسعة والإتاحة والإغلاقات وإشغال النظامين. لا تُطبّق مجتمعة تلقائيًا؛ يجب
              إعادة التحقق عند تنفيذ أي نقل في محرر الجدول.
            </p>
            {moves.length ? (
              <ul className="divide-y">
                {moves.map((m) => (
                  <li className="py-3 text-sm" key={m.session.id}>
                    <b>{m.session.course_offerings?.courses?.name || "محاضرة"}</b> ·{" "}
                    {m.from.name || m.from.code} ← {m.to.name || m.to.code}
                    <p>
                      {
                        ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"][
                          m.session.day_of_week
                        ]
                      }{" "}
                      {m.session.start_time.slice(0, 5)}–{m.session.end_time.slice(0, 5)} ·{" "}
                      {m.session.expected_students} طالبًا · سعة البديل {m.to.capacity}
                    </p>
                    <p className="text-muted-foreground">
                      تقليل المقاعد غير المستغلة بمقدار {m.savedSeats} مقعدًا في هذه المحاضرة.
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">
                لم نجد نقلًا إلى قاعة أصغر يستوفي الفحوص بالبيانات الحالية. قد تكون القاعات المناسبة
                مشغولة أو البيانات المطلوبة ناقصة.
              </p>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
