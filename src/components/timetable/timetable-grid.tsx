import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface GridSession {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  study_system: string;
  session_type: string;
  title: string;
  subtitle?: string;
  badge?: string;
}

const DAY_LABELS: Record<number, string> = {
  6: "السبت", 0: "الأحد", 1: "الإثنين", 2: "الثلاثاء",
  3: "الأربعاء", 4: "الخميس", 5: "الجمعة",
};

const t = (s: string) => (s.length === 5 ? `${s}:00` : s);
const mins = (s: string) => {
  const [h, m] = t(s).split(":").map(Number);
  return h * 60 + m;
};

export function TimetableGrid({
  sessions,
  workingDays = [6, 0, 1, 2, 3, 4],
  startHour = 8,
  endHour = 21,
  onSessionClick,
}: {
  sessions: GridSession[];
  workingDays?: number[];
  startHour?: number;
  endHour?: number;
  onSessionClick?: (id: string) => void;
}) {
  const slots = useMemo(() => {
    const arr: { label: string; mins: number }[] = [];
    for (let h = startHour; h <= endHour; h++) {
      arr.push({ label: `${String(h).padStart(2, "0")}:00`, mins: h * 60 });
    }
    return arr;
  }, [startHour, endHour]);

  const SLOT_PX = 56; // each hour
  const totalHeight = (endHour - startHour) * SLOT_PX + SLOT_PX;

  const colorByType = (t: string) => {
    switch (t) {
      case "lab": return "bg-emerald-500/15 border-emerald-500/40";
      case "tutorial": return "bg-amber-500/15 border-amber-500/40";
      case "lecture": default: return "bg-primary/15 border-primary/40";
    }
  };

  return (
    <div className="overflow-auto border rounded-md" dir="rtl">
      <div className="grid" style={{ gridTemplateColumns: `80px repeat(${workingDays.length}, minmax(160px, 1fr))` }}>
        <div className="bg-muted/40 border-b border-l p-2 text-xs font-medium sticky top-0 z-10">الوقت</div>
        {workingDays.map((d) => (
          <div key={d} className="bg-muted/40 border-b border-l p-2 text-xs font-medium text-center sticky top-0 z-10">
            {DAY_LABELS[d]}
          </div>
        ))}

        <div className="border-l" style={{ height: totalHeight }}>
          {slots.map((s) => (
            <div key={s.mins} className="text-[10px] text-muted-foreground p-1 border-b" style={{ height: SLOT_PX }}>
              {s.label}
            </div>
          ))}
        </div>

        {workingDays.map((d) => {
          const daySessions = sessions.filter((s) => s.day_of_week === d);
          return (
            <div key={d} className="relative border-l" style={{ height: totalHeight }}>
              {slots.map((s) => (
                <div key={s.mins} className="border-b" style={{ height: SLOT_PX }} />
              ))}
              {daySessions.map((sess) => {
                const top = ((mins(sess.start_time) - startHour * 60) / 60) * SLOT_PX;
                const height = ((mins(sess.end_time) - mins(sess.start_time)) / 60) * SLOT_PX;
                if (top < 0 || height <= 0) return null;
                return (
                  <button
                    key={sess.id}
                    onClick={() => onSessionClick?.(sess.id)}
                    className={cn(
                      "absolute right-1 left-1 rounded border text-right p-2 text-xs hover:opacity-90 transition cursor-pointer",
                      colorByType(sess.session_type),
                    )}
                    style={{ top: top + 1, height: height - 2 }}
                  >
                    <div className="font-semibold truncate">{sess.title}</div>
                    {sess.subtitle && <div className="text-[10px] truncate text-muted-foreground">{sess.subtitle}</div>}
                    <div className="flex gap-1 mt-1 flex-wrap">
                      <span className="text-[9px] bg-background/60 rounded px-1">{sess.start_time.slice(0,5)}–{sess.end_time.slice(0,5)}</span>
                      {sess.badge && <span className="text-[9px] bg-background/60 rounded px-1">{sess.badge}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
