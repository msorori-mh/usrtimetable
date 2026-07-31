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

export interface AvailabilityWindow {
  day_of_week: number;
  start_time: string; // HH:MM
  end_time: string;
}

const DAY_LABELS: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الإثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
};

const t = (s: string) => (s.length === 5 ? `${s}:00` : s);
const mins = (s: string) => {
  const [h, m] = t(s).split(":").map(Number);
  return h * 60 + m;
};

export interface DropPayload {
  kind: "unscheduled" | "session";
  id: string;
}

export function TimetableGrid({
  sessions,
  workingDays = [6, 0, 1, 2, 3, 4],
  startHour = 8,
  endHour = 21,
  availability,
  onSessionClick,
  onDropAt,
  draggable = false,
  /** Optional safety tone while dragging (green=valid, red=forbidden). */
  getDropTone,
}: {
  sessions: GridSession[];
  workingDays?: number[];
  startHour?: number;
  endHour?: number;
  /** If provided, anything OUTSIDE these windows is rendered as unavailable. */
  availability?: AvailabilityWindow[];
  onSessionClick?: (id: string) => void;
  onDropAt?: (params: { day: number; startTime: string; payload: DropPayload }) => void;
  draggable?: boolean;
  getDropTone?: (day: number, startTimeHHMM: string) => "green" | "red" | null;
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
      case "lab":
        return "bg-emerald-500/20 border-emerald-500/50";
      case "tutorial":
        return "bg-amber-500/20 border-amber-500/50";
      case "lecture":
      default:
        return "bg-primary/20 border-primary/50";
    }
  };

  // For each day, compute available zones (else everything is available)
  const availByDay = useMemo(() => {
    const map = new Map<number, AvailabilityWindow[]>();
    (availability ?? []).forEach((w) => {
      if (!map.has(w.day_of_week)) map.set(w.day_of_week, []);
      map.get(w.day_of_week)!.push(w);
    });
    return map;
  }, [availability]);

  const isInsideAvailability = (day: number, hourMinutes: number) => {
    if (!availability || availability.length === 0) return true;
    const wins = availByDay.get(day);
    if (!wins || wins.length === 0) return false;
    return wins.some((w) => hourMinutes >= mins(w.start_time) && hourMinutes < mins(w.end_time));
  };

  const handleDrop = (e: React.DragEvent, day: number, slotMins: number) => {
    e.preventDefault();
    if (!onDropAt) return;
    const raw = e.dataTransfer.getData("application/x-lovable-drop");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as DropPayload;
      const hh = String(Math.floor(slotMins / 60)).padStart(2, "0");
      const mm = String(slotMins % 60).padStart(2, "0");
      onDropAt({ day, startTime: `${hh}:${mm}`, payload });
    } catch {
      /* noop */
    }
  };

  return (
    <div className="overflow-auto border rounded-md" dir="rtl">
      <div
        className="grid"
        style={{ gridTemplateColumns: `80px repeat(${workingDays.length}, minmax(170px, 1fr))` }}
      >
        <div className="bg-muted/40 border-b border-l p-2 text-xs font-medium sticky top-0 z-10">
          الوقت
        </div>
        {workingDays.map((d) => (
          <div
            key={d}
            className="bg-muted/40 border-b border-l p-2 text-xs font-medium text-center sticky top-0 z-10"
          >
            {DAY_LABELS[d]}
          </div>
        ))}

        <div className="border-l" style={{ height: totalHeight }}>
          {slots.map((s) => (
            <div
              key={s.mins}
              className="text-[10px] text-muted-foreground p-1 border-b"
              style={{ height: SLOT_PX }}
            >
              {s.label}
            </div>
          ))}
        </div>

        {workingDays.map((d) => {
          const daySessions = sessions.filter((s) => s.day_of_week === d);
          return (
            <div key={d} className="relative border-l" style={{ height: totalHeight }}>
              {slots.map((s) => {
                const ok = isInsideAvailability(d, s.mins);
                const hh = String(Math.floor(s.mins / 60)).padStart(2, "0");
                const mm = String(s.mins % 60).padStart(2, "0");
                const tone = ok && getDropTone ? getDropTone(d, `${hh}:${mm}`) : null;
                return (
                  <div
                    key={s.mins}
                    className={cn(
                      "border-b transition-colors",
                      ok
                        ? "hover:bg-primary/5"
                        : "bg-muted/40 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,0.04)_6px,rgba(0,0,0,0.04)_12px)]",
                      tone === "green" && "bg-emerald-500/25 ring-1 ring-emerald-600/40",
                      tone === "red" && "bg-red-500/25 ring-1 ring-red-600/40",
                    )}
                    style={{ height: SLOT_PX }}
                    onDragOver={(e) => {
                      if (ok && onDropAt) e.preventDefault();
                    }}
                    onDrop={(e) => ok && handleDrop(e, d, s.mins)}
                    title={
                      tone === "red" ? "خانة ممنوعة" : tone === "green" ? "خانة صالحة" : undefined
                    }
                    role="gridcell"
                    aria-label={
                      tone === "red" ? "خانة ممنوعة" : tone === "green" ? "خانة صالحة" : undefined
                    }
                  />
                );
              })}
              {daySessions.map((sess) => {
                const top = ((mins(sess.start_time) - startHour * 60) / 60) * SLOT_PX;
                const height = ((mins(sess.end_time) - mins(sess.start_time)) / 60) * SLOT_PX;
                if (top < 0 || height <= 0) return null;
                return (
                  <div
                    key={sess.id}
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-lovable-drop",
                        JSON.stringify({ kind: "session", id: sess.id } as DropPayload),
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onSessionClick?.(sess.id)}
                    className={cn(
                      "absolute right-1 left-1 rounded border text-right p-2 text-xs hover:opacity-90 transition cursor-pointer",
                      colorByType(sess.session_type),
                      draggable && "active:opacity-70",
                    )}
                    style={{ top: top + 1, height: height - 2 }}
                  >
                    <div className="font-semibold truncate">{sess.title}</div>
                    {sess.subtitle && (
                      <div className="text-[10px] truncate text-muted-foreground">
                        {sess.subtitle}
                      </div>
                    )}
                    <div className="flex gap-1 mt-1 flex-wrap">
                      <span className="text-[9px] bg-background/60 rounded px-1">
                        {sess.start_time.slice(0, 5)}–{sess.end_time.slice(0, 5)}
                      </span>
                      {sess.badge && (
                        <span className="text-[9px] bg-background/60 rounded px-1">
                          {sess.badge}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
