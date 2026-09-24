import { useState } from "react";
import { Card } from "@/components/ui/card";
import type { DecisionSession, RoomClosure } from "@/lib/reports/room-decisions";
import { roomOpen, roomClosed, overlaps } from "@/lib/reports/room-decisions";
import { orderWeekDaysRtl, WEEK_DAY_LABELS_AR } from "@/lib/reports/weekly-grid-window";
import type {
  RoomsReportRoom,
  RoomsReportAvailability,
  RoomsReportSettings,
} from "@/lib/print-center/rooms-report";

export function RoomWeeklyInspector(p: {
  rooms: RoomsReportRoom[];
  sessions: DecisionSession[];
  availability: RoomsReportAvailability[];
  closures: RoomClosure[];
  settings?: RoomsReportSettings | null;
  studySystem: string;
}) {
  const [selected, setSelected] = useState("");
  const roomId = p.rooms.some((r) => r.id === selected) ? selected : p.rooms[0]?.id;
  const sessions = p.sessions.filter((s) => !s.replaced_by_split && s.room_id === roomId);
  const boundaries = [
    ...new Set(
      [
        ...sessions.flatMap((s) => [s.start_time, s.end_time]),
        ...p.availability
          .filter((a) => a.room_id === roomId)
          .flatMap((a) => [a.start_time, a.end_time]),
        p.settings?.day_start_time,
        p.settings?.day_end_time,
      ]
        .filter((t): t is string => !!t)
        .map((t) => t.slice(0, 5)),
    ),
  ].sort();
  const days = orderWeekDaysRtl([
    ...(p.settings?.working_days ?? []),
    ...sessions.map((s) => s.day_of_week),
  ]);
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-bold">الجدول الأسبوعي للقاعة</h2>
      <label className="block">
        القاعة أو المعمل{" "}
        <select
          className="ms-3 max-w-full rounded border bg-background p-2"
          value={roomId ?? ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {p.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || r.code}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        يعرض إشغال النظامين لمنع اعتبار محاضرات النظام الآخر فراغًا. الإغلاقات المؤرخة تُعرض
        تحفظيًا؛ راجع تاريخها قبل التسكين.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <caption className="sr-only">الأيام والفترات وحالة إشغال القاعة</caption>
          <thead>
            <tr>
              <th className="border p-2">الفترة</th>
              {days.map((d) => (
                <th className="border p-2" key={d}>
                  {WEEK_DAY_LABELS_AR[d] ?? String(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {boundaries.slice(0, -1).map((start, i) => {
              const end = boundaries[i + 1];
              return (
                <tr key={start}>
                  <th className="whitespace-nowrap border p-2" dir="ltr">
                    {start}–{end}
                  </th>
                  {days.map((day) => {
                    const occupying = sessions.filter(
                      (s) =>
                        s.day_of_week === day && overlaps(s, { start_time: start, end_time: end }),
                    );
                    const closed = roomClosed(roomId!, day, start, end, p.closures);
                    const open = roomOpen(roomId!, day, start, end, p.availability, p.settings);
                    return (
                      <td
                        className={`border p-2 align-top ${occupying.length ? "bg-primary/10" : closed || !open ? "bg-muted text-muted-foreground" : "bg-emerald-50 text-emerald-900"}`}
                        key={day}
                      >
                        {occupying.map((s) => (
                          <div className="mb-1" key={s.id}>
                            <b>
                              {s.course_offerings?.courses?.name ||
                                s.course_offerings?.courses?.code ||
                                "محاضرة"}
                            </b>
                            <div className="text-xs">
                              {s.instructors?.full_name || "مدرس غير محدد"} ·{" "}
                              {s.study_system === "parallel"
                                ? "موازي"
                                : s.study_system === "regular"
                                  ? "عام"
                                  : "مشترك"}
                            </div>
                          </div>
                        ))}
                        {closed ? (
                          <span>إغلاق مسجل</span>
                        ) : !occupying.length ? (
                          open ? (
                            "متاحة"
                          ) : (
                            "خارج الإتاحة"
                          )
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
