/**
 * ROOM-TIME-CAPACITY-READINESS-01 (+ PRACTICAL-LAB-FALLBACK-CAPACITY-02)
 *
 * Physical weekly time capacity per room type for the active term.
 *
 *   required room-hours  = Σ weekly hours of ACTIVE teaching assignments whose
 *                          delivery group is active and NOT obsolete
 *   available room-hours = Σ over ACTIVE rooms of the type of that room's usable
 *                          weekly window: working_days × (day_end − day_start),
 *                          or the room's own room_availability rows when defined
 *
 * Capacity is POOLED with priority, exactly like the scheduling-time policy in
 * `@/lib/scheduling/room-type-policy`: practical demand consumes `computer_lab`
 * hours first and may then use the SURPLUS of `lecture_hall`. Theory/tutorial
 * demand stays strictly inside its own room type — the reverse borrow is never
 * allowed. Only the deficit that remains AFTER pooling is a blocker.
 *
 * Room capacity (seats) and time overlap remain untouched hard constraints
 * elsewhere; this module only judges weekly room-hours feasibility. We never
 * invent rooms and never widen the working day.
 */
import { hoursBetween } from "./formatters";
import type { ReadinessMetric } from "./readiness";
import {
  COMPUTER_LAB_TYPE,
  LECTURE_HALL_TYPE,
  isPracticalComponent,
} from "@/lib/scheduling/room-type-policy";

export interface TimeCapacitySettings {
  working_days: number[] | null;
  day_start_time: string | null;
  day_end_time: string | null;
}

export interface TimeCapacityRoom {
  id: string;
  room_type_id: string | null;
  is_active?: boolean | null;
}

export interface TimeCapacityRoomType {
  id: string;
  name_ar?: string | null;
  name?: string | null;
  code?: string | null;
}

export interface TimeCapacityRoomAvailability {
  room_id: string;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
}

/** One unit of demand: weekly hours already resolved to a required room type. */
export interface TimeCapacityDemand {
  roomTypeId: string | null;
  hours: number;
  /** Component type — decides whether lab demand may use the hall fallback. */
  componentType?: string | null;
}

export interface RoomTypeTimeCapacity {
  roomTypeId: string;
  roomTypeLabel: string;
  activeRooms: number;
  /** usable weekly hours of a single full-window room (no availability limits) */
  weeklyHoursPerRoom: number;
  requiredHours: number;
  availableHours: number;
  /** raw deficit of this type alone, before the practical fallback pooling */
  deficitHours: number;
  /** lab hours covered by the lecture-hall surplus under the fallback policy */
  coveredByFallbackHours: number;
  /** hall hours reserved for practical fallback demand of other types */
  reservedForFallbackHours: number;
  /** deficit that remains after pooling — the only real blocker */
  effectiveDeficitHours: number;
  /** minimum extra rooms of this type at the CURRENT working hours */
  additionalRoomsNeeded: number;
}


export interface RoomTimeCapacityAnalysis {
  /** true when settings are missing/invalid — fail closed, treat as blocker */
  unavailable: boolean;
  unavailableReasonAr?: string;
  workingDays: number[];
  dailyHours: number;
  perType: RoomTypeTimeCapacity[];
  insufficient: RoomTypeTimeCapacity[];
  /** demand hours that could not be resolved to a room type (needs review) */
  unresolvedHours: number;
  totalRequiredHours: number;
  totalAvailableHours: number;
}

const round2 = (n: number) => Number(n.toFixed(2));
const isActiveRoom = (r: TimeCapacityRoom) => r.is_active !== false;

function roomUsableHours(
  roomId: string,
  availability: TimeCapacityRoomAvailability[],
  workingDays: number[],
  dayStart: string,
  dayEnd: string,
  fullWindowHours: number,
): number {
  const rows = availability.filter((a) => a.room_id === roomId);
  if (rows.length === 0) return fullWindowHours;
  const startMin = hoursBetween("00:00", dayStart) * 60;
  const endMin = hoursBetween("00:00", dayEnd) * 60;
  let total = 0;
  for (const row of rows) {
    if (!workingDays.includes(row.day_of_week)) continue;
    if (!row.start_time || !row.end_time) continue;
    const s = Math.max(startMin, hoursBetween("00:00", row.start_time) * 60);
    const e = Math.min(endMin, hoursBetween("00:00", row.end_time) * 60);
    if (e > s) total += (e - s) / 60;
  }
  return total;
}

export function analyzeRoomTimeCapacity(input: {
  settings: TimeCapacitySettings | null | undefined;
  rooms: TimeCapacityRoom[];
  roomTypes: TimeCapacityRoomType[];
  roomAvailability?: TimeCapacityRoomAvailability[];
  demand: TimeCapacityDemand[];
}): RoomTimeCapacityAnalysis {
  const workingDays = (input.settings?.working_days ?? []).filter((d) => Number.isFinite(d));
  const dayStart = input.settings?.day_start_time ?? null;
  const dayEnd = input.settings?.day_end_time ?? null;
  const dailyHours = dayStart && dayEnd ? hoursBetween(dayStart, dayEnd) : 0;
  const requiredByType = new Map<string, number>();
  /** lab-required hours whose component may use the lecture-hall fallback */
  const fallbackEligibleByType = new Map<string, number>();
  const codeByTypeId = new Map(
    input.roomTypes.map((t) => [t.id, String(t.code ?? "").trim().toLowerCase()] as const),
  );
  let unresolvedHours = 0;
  for (const d of input.demand) {
    const hours = Math.max(0, Number(d.hours) || 0);
    if (hours <= 0) continue;
    if (!d.roomTypeId) {
      unresolvedHours += hours;
      continue;
    }
    requiredByType.set(d.roomTypeId, (requiredByType.get(d.roomTypeId) ?? 0) + hours);
    // Fallback eligibility mirrors the scheduling policy: practical demand on a
    // computer lab. An unknown component type on lab demand is treated as
    // practical, matching how such assignments are generated today.
    const eligible =
      codeByTypeId.get(d.roomTypeId) === COMPUTER_LAB_TYPE &&
      (d.componentType == null || isPracticalComponent(d.componentType));
    if (eligible) {
      fallbackEligibleByType.set(
        d.roomTypeId,
        (fallbackEligibleByType.get(d.roomTypeId) ?? 0) + hours,
      );
    }
  }
  const totalRequiredHours = round2([...requiredByType.values()].reduce((s, h) => s + h, 0));

  if (workingDays.length === 0 || dailyHours <= 0) {
    return {
      unavailable: true,
      unavailableReasonAr:
        "إعدادات الجدولة غير مكتملة (أيام العمل أو بداية/نهاية اليوم) — لا يمكن حساب السعة الزمنية للقاعات.",
      workingDays,
      dailyHours: Math.max(0, dailyHours),
      perType: [],
      insufficient: [],
      unresolvedHours: round2(unresolvedHours),
      totalRequiredHours,
      totalAvailableHours: 0,
    };
  }

  const fullWindowHours = round2(workingDays.length * dailyHours);
  const availability = input.roomAvailability ?? [];
  const typeLabel = new Map(
    input.roomTypes.map((t) => [t.id, t.name_ar || t.name || "نوع قاعة"] as const),
  );

  const typeIds = new Set<string>([
    ...requiredByType.keys(),
    ...input.rooms.filter(isActiveRoom).map((r) => r.room_type_id ?? ""),
  ]);
  typeIds.delete("");

  const perType: RoomTypeTimeCapacity[] = [];
  for (const typeId of typeIds) {
    const rooms = input.rooms.filter((r) => isActiveRoom(r) && r.room_type_id === typeId);
    const availableHours = round2(
      rooms.reduce(
        (sum, room) =>
          sum +
          roomUsableHours(room.id, availability, workingDays, dayStart!, dayEnd!, fullWindowHours),
        0,
      ),
    );
    const requiredHours = round2(requiredByType.get(typeId) ?? 0);
    const deficitHours = round2(Math.max(0, requiredHours - availableHours));
    perType.push({
      roomTypeId: typeId,
      roomTypeLabel: typeLabel.get(typeId) ?? "نوع قاعة",
      activeRooms: rooms.length,
      weeklyHoursPerRoom: fullWindowHours,
      requiredHours,
      availableHours,
      deficitHours,
      coveredByFallbackHours: 0,
      reservedForFallbackHours: 0,
      effectiveDeficitHours: deficitHours,
      additionalRoomsNeeded: deficitHours > 0 ? Math.ceil(deficitHours / fullWindowHours) : 0,
    });
  }

  // Priority pooling: practical lab demand first consumes the labs' own hours,
  // then the surplus of lecture halls. Lecture demand never borrows a lab.
  const halls = perType.filter((t) => codeByTypeId.get(t.roomTypeId) === LECTURE_HALL_TYPE);
  let hallSurplus = round2(
    halls.reduce((sum, t) => sum + Math.max(0, t.availableHours - t.requiredHours), 0),
  );
  for (const lab of perType) {
    if (codeByTypeId.get(lab.roomTypeId) !== COMPUTER_LAB_TYPE) continue;
    if (lab.deficitHours <= 0 || hallSurplus <= 0) continue;
    // Only the fallback-eligible share of the deficit can move to a hall.
    const eligibleShare = Math.min(lab.deficitHours, fallbackEligibleByType.get(lab.roomTypeId) ?? 0);
    const covered = round2(Math.min(eligibleShare, hallSurplus));
    if (covered <= 0) continue;
    hallSurplus = round2(hallSurplus - covered);
    lab.coveredByFallbackHours = covered;
    lab.effectiveDeficitHours = round2(Math.max(0, lab.deficitHours - covered));
    lab.additionalRoomsNeeded =
      lab.effectiveDeficitHours > 0 ? Math.ceil(lab.effectiveDeficitHours / fullWindowHours) : 0;
    for (const hall of halls) {
      const free = round2(Math.max(0, hall.availableHours - hall.requiredHours));
      const take = round2(Math.min(free - hall.reservedForFallbackHours, covered));
      if (take > 0) hall.reservedForFallbackHours = round2(hall.reservedForFallbackHours + take);
    }
  }

  perType.sort(
    (a, b) => b.effectiveDeficitHours - a.effectiveDeficitHours || b.requiredHours - a.requiredHours,
  );

  return {
    unavailable: false,
    workingDays,
    dailyHours,
    perType,
    insufficient: perType.filter((t) => t.effectiveDeficitHours > 0),
    unresolvedHours: round2(unresolvedHours),
    totalRequiredHours,
    totalAvailableHours: round2(perType.reduce((s, t) => s + t.availableHours, 0)),
  };
}

export const ROOM_TIME_CAPACITY_LABEL =
  "أنواع قاعات بسعة زمنية أسبوعية غير كافية بعد مشاركة القاعات (ROOM_TIME_CAPACITY_INSUFFICIENT)";

/** Human-readable blocker lines for the review / generation screens. */
export function roomTimeCapacityMessagesAr(analysis: RoomTimeCapacityAnalysis): string[] {
  if (analysis.unavailable) return [analysis.unavailableReasonAr ?? "السعة الزمنية غير متاحة."];
  return analysis.insufficient.map(
    (t) =>
      `${t.roomTypeLabel}: مطلوب ${t.requiredHours} ساعة/أسبوع · متاح ${t.availableHours} ساعة ` +
      `(${t.activeRooms} قاعة × ${analysis.workingDays.length} أيام × ${round2(analysis.dailyHours)} ساعة) · ` +
      (t.coveredByFallbackHours > 0
        ? `يُغطّى ${t.coveredByFallbackHours} ساعة من فائض قاعات المحاضرات (بديل الجلسات العملية) · `
        : "") +
      `العجز المتبقي ${t.effectiveDeficitHours} ساعة · الحد الأدنى ${t.additionalRoomsNeeded} قاعة إضافية بنفس ساعات العمل`,
  );
}

/** Screen note explaining the pooled-capacity policy (shown with the check). */
export const ROOM_TIME_CAPACITY_POLICY_NOTE_AR =
  "تُحسب السعة بمشاركة ذات أولوية: الجلسات العملية تستهلك المعامل أولًا، ثم يجوز تسكينها في فائض قاعات المحاضرات؛ أما المحاضرات النظرية فتبقى في قاعات المحاضرات فقط. لا يُعتبر العجز حاجزًا إلا إذا بقي بعد هذه المشاركة.";


/** Scheduling-category metrics (critical → blocker in the wizard and generator). */
export function roomTimeCapacityReadinessMetrics(
  analysis: RoomTimeCapacityAnalysis,
): ReadinessMetric[] {
  if (analysis.unavailable) {
    return [
      {
        label: ROOM_TIME_CAPACITY_LABEL,
        total: 1,
        missing: 1,
        critical: true,
        category: "scheduling",
      },
    ];
  }
  return [
    {
      label: ROOM_TIME_CAPACITY_LABEL,
      total: Math.max(analysis.perType.length, 1),
      missing: analysis.insufficient.length,
      critical: true,
      category: "scheduling",
    },
    {
      label: "ساعات إسناد بدون نوع قاعة مطلوب (لا يمكن التحقق من السعة الزمنية)",
      total: Math.max(analysis.totalRequiredHours + analysis.unresolvedHours, 1),
      missing: analysis.unresolvedHours > 0 ? 1 : 0,
      category: "scheduling",
    },
  ];
}
