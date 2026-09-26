import { roomUtilizationMetrics, type ReportTime } from "./presentation-metrics";
import { roomCategoryFromType } from "@/lib/print-center/rooms-report";

export const STANDARD_ROOM_DAY_HOURS = 6;
export const STANDARD_ROOM_WEEK_HOURS = 36;
const round = (n: number) => Math.round(n * 100) / 100;
const known = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;

export interface CapacityCollege {
  college_id: string;
  college: string;
  term_id: string | null;
  term_state: "ready" | "missing" | "ambiguous";
  version_id: string | null;
  room_count: number | null;
  groups_count: number | null;
  required_hours: number | null;
  teaching_hours: number | null;
}
export interface CapacityRoom {
  id: string;
  college_id: string;
  name: string | null;
  code: string | null;
  room_type_id: string | null;
  capacity: number | null;
  is_active: boolean | null;
  available_days: number[] | null;
  available_start_time: string | null;
  available_end_time: string | null;
}
export interface CapacitySettings {
  college_id: string;
  working_days: number[] | null;
  day_start_time: string | null;
  day_end_time: string | null;
}
export interface CapacityAvailability extends ReportTime {
  id: string;
  room_id: string;
}
export interface CapacitySession extends ReportTime {
  id: string;
  room_id: string | null;
  schedule_version_id: string;
}
export interface CapacityRoomType {
  id: string;
  name_ar: string | null;
  code: string | null;
}
export interface CapacitySources {
  rooms: CapacityRoom[];
  settings: CapacitySettings[];
  availability: CapacityAvailability[];
  sessions: CapacitySession[];
  roomTypes: CapacityRoomType[];
}

/** Units for comparison, never a claim that scattered hours free a physical room. */
export function roomHourEquivalents(hours: number | null) {
  if (!known(hours)) return null;
  const fullDays = Math.floor((hours + 1e-9) / STANDARD_ROOM_DAY_HOURS);
  const fullRooms = Math.floor((hours + 1e-9) / STANDARD_ROOM_WEEK_HOURS);
  return {
    fullDays,
    hoursAfterDays: round(hours - fullDays * STANDARD_ROOM_DAY_HOURS),
    fullRooms,
    hoursAfterRooms: round(hours - fullRooms * STANDARD_ROOM_WEEK_HOURS),
  };
}

export interface LeadershipCapacityRoom {
  id: string;
  name: string;
  code: string;
  type: string;
  /** A missing type code cannot safely be counted as a classroom or lab. */
  category: "hall" | "lab" | null;
  seats: number | null;
  availableHours: number | null;
  occupiedHours: number | null;
  idleHours: number | null;
  sessionCount: number | null;
  issue: string | null;
}
export interface LeadershipCapacityCollege {
  id: string;
  name: string;
  rooms: LeadershipCapacityRoom[];
  availableHours: number | null;
  requiredHours: number | null;
  balanceHours: number | null;
  surplusHours: number | null;
  deficitHours: number | null;
  equivalents: ReturnType<typeof roomHourEquivalents>;
  emptyPublishedRooms: number | null;
  issues: string[];
}

function validDays(days: number[] | null | undefined) {
  return !!days && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}
function validTime(t: string | null | undefined) {
  return typeof t === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/.test(t);
}
function validRow(row: ReportTime) {
  return (
    validDays([row.day_of_week]) &&
    validTime(row.start_time) &&
    validTime(row.end_time) &&
    row.end_time > row.start_time
  );
}

export function buildLeadershipRoomCapacity(
  colleges: CapacityCollege[],
  sources: CapacitySources,
): LeadershipCapacityCollege[] {
  const selectedVersions = new Set(colleges.flatMap((c) => (c.version_id ? [c.version_id] : [])));
  const sessions = [
    ...new Map(
      sources.sessions
        .filter((s) => selectedVersions.has(s.schedule_version_id))
        .map((s) => [s.id, s]),
    ).values(),
  ];
  const uniqueRooms = [...new Map(sources.rooms.map((r) => [r.id, r])).values()];
  return colleges.map((college) => {
    const settingsRows = sources.settings.filter((s) => s.college_id === college.college_id);
    const settings = settingsRows.length === 1 ? settingsRows[0] : null;
    const settingValid =
      settings &&
      validDays(settings.working_days) &&
      !!settings.working_days?.length &&
      validTime(settings.day_start_time) &&
      validTime(settings.day_end_time) &&
      settings.day_end_time! > settings.day_start_time!;
    const activeRooms = uniqueRooms.filter(
      (room) => room.college_id === college.college_id && room.is_active === true,
    );
    const rooms = activeRooms
      .filter((room) => {
        const roomType = sources.roomTypes.find((type) => type.id === room.room_type_id);
        return roomType?.code?.trim().toLowerCase() === "lecture_hall";
      })
      .map((room): LeadershipCapacityRoom => {
        const availability = sources.availability.filter((a) => a.room_id === room.id);
        const assigned = sessions.filter((s) => s.room_id === room.id);
        const roomType = sources.roomTypes.find((t) => t.id === room.room_type_id);
        const result: LeadershipCapacityRoom = {
          id: room.id,
          name: room.name || room.code || "قاعة غير مسماة",
          code: room.code || "—",
          type: roomType?.name_ar || "نوع غير محدد",
          category: roomType?.code?.trim() ? roomCategoryFromType(roomType.code) : null,
          seats: room.capacity,
          availableHours: null,
          occupiedHours: null,
          idleHours: null,
          sessionCount: college.version_id ? assigned.length : null,
          issue: null,
        };
        const fallbackValid =
          availability.length > 0 ||
          ((room.available_days === null || validDays(room.available_days)) &&
            (!room.available_start_time || validTime(room.available_start_time)) &&
            (!room.available_end_time || validTime(room.available_end_time)) &&
            (!room.available_start_time ||
              !room.available_end_time ||
              room.available_end_time > room.available_start_time));
        if (!settingValid || !availability.every(validRow) || !fallbackValid) {
          result.issue = "أيام أو ساعات إتاحة القاعة غير مكتملة أو غير صالحة";
          return result;
        }
        try {
          result.availableHours = roomUtilizationMetrics({
            settings,
            room,
            availability,
            sessions: [],
          }).available_hours;
          if (!college.version_id) return result;
          if (!assigned.every(validRow)) {
            result.issue = "توقيت جلسة منشورة غير صالح";
            return result;
          }
          const metrics = roomUtilizationMetrics({
            settings,
            room,
            availability,
            sessions: assigned,
          });
          result.occupiedHours = metrics.occupied_hours;
          result.idleHours = metrics.idle_hours;
          if (metrics.outside_hours || metrics.overlap_hours)
            result.issue = `تداخل ${metrics.overlap_hours} س، وخارج الإتاحة ${metrics.outside_hours} س`;
        } catch {
          result.issue = "تعذر حساب إتاحة القاعة";
        }
        return result;
      });
    const issues: string[] = [];
    // The overview inventory includes halls and labs. Validate it before narrowing this
    // executive capacity indicator to lecture halls only.
    const inventoryComplete = known(college.room_count) && activeRooms.length === college.room_count;
    if (!inventoryComplete) issues.push("عدد القاعات المقروءة لا يطابق ملخص الكلية؛ حدّث البيانات");
    const availabilityComplete = inventoryComplete && rooms.every((r) => known(r.availableHours));
    if (!availabilityComplete) issues.push("بيانات إتاحة القاعات غير مكتملة");
    const availableHours = availabilityComplete
      ? round(rooms.reduce((n, r) => n + r.availableHours!, 0))
      : null;
    const requiredHours =
      college.term_state === "ready" && known(college.required_hours)
        ? college.required_hours
        : null;
    if (requiredHours === null) issues.push("الفصل أو الساعات التدريسية المطلوبة غير محسومة");
    const demandComplete =
      requiredHours !== null &&
      known(college.groups_count) &&
      college.groups_count > 0 &&
      (!known(college.teaching_hours) || requiredHours + 0.01 >= college.teaching_hours);
    if (requiredHours !== null && !demandComplete)
      issues.push("يجب استكمال مجموعات التدريس ومطابقة المطلوب مع المنشور قبل احتساب الفائض");
    const balanceHours =
      availableHours !== null && demandComplete ? round(availableHours - requiredHours!) : null;
    const surplusHours = balanceHours === null ? null : Math.max(0, balanceHours);
    const deficitHours = balanceHours === null ? null : Math.max(0, -balanceHours);
    const occupancyComplete =
      inventoryComplete && !!college.version_id && rooms.every((r) => known(r.occupiedHours));
    return {
      id: college.college_id,
      name: college.college,
      rooms,
      availableHours,
      requiredHours,
      balanceHours,
      surplusHours,
      deficitHours,
      equivalents: roomHourEquivalents(surplusHours),
      emptyPublishedRooms: occupancyComplete
        ? rooms.filter((r) => r.availableHours! > 0 && r.sessionCount === 0).length
        : null,
      issues,
    };
  });
}

/** Surpluses are added by college. A deficit elsewhere is shown separately. */
export function aggregateLeadershipRoomCapacity(rows: LeadershipCapacityCollege[]) {
  const measured = rows.filter((r) => r.balanceHours !== null);
  const sum = (key: "availableHours" | "requiredHours" | "surplusHours" | "deficitHours") =>
    measured.length ? round(measured.reduce((n, r) => n + r[key]!, 0)) : null;
  return {
    knownColleges: measured.length,
    totalColleges: rows.length,
    complete: rows.length > 0 && measured.length === rows.length,
    availableHours: sum("availableHours"),
    requiredHours: sum("requiredHours"),
    surplusHours: sum("surplusHours"),
    deficitHours: sum("deficitHours"),
    equivalents: roomHourEquivalents(sum("surplusHours")),
    roomsByCollege: measured.length
      ? measured.reduce((n, r) => n + r.equivalents!.fullRooms, 0)
      : null,
  };
}
