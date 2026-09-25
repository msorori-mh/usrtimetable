/**
 * ROOMS-CAPACITY-DIAGNOSTICS-FIX-01
 *
 * Rooms whose capacity equals their room type's default capacity are HEALTHY,
 * not a gap. The real diagnostics are:
 *   - capacity <= 0 (blocker)
 *   - no room type at all (blocker)
 *   - a uniform active capacity that disagrees with room_types.default_capacity
 *     (needs review — the catalog's group-sizing policy may be out of date)
 *
 * Mirrors the DB rule in public.effective_room_type_capacity: an effective
 * capacity exists only when every active room of the type shares one capacity.
 * Mixed capacities are normal for rooms of different sizes. In that case the
 * group-sizing policy falls back to default_capacity, and placement still
 * checks each room's own capacity. They are not a missing-data finding.
 */
import type { ReadinessMetric } from "./readiness";

export type CapacityRoomRow = {
  id: string;
  capacity: number | null;
  room_type_id: string | null;
  room_type?: string | null;
  is_active?: boolean | null;
};

export type CapacityRoomTypeRow = {
  id: string;
  default_capacity: number | null;
  name_ar?: string | null;
};

export type RoomCapacityDiagnostics = {
  /** room types whose active rooms disagree on capacity */
  mixedTypeIds: string[];
  /** room types with a uniform active capacity that differs from default_capacity */
  defaultOutOfSyncTypeIds: string[];
  /** rooms whose capacity differs from the uniform active capacity of their type */
  roomsOffUniform: string[];
  invalidCapacityRooms: string[];
  missingTypeRooms: string[];
  typesConsidered: number;
};

const isActive = (r: { is_active?: boolean | null }) => r.is_active !== false;

export function analyzeRoomCapacities(
  rooms: CapacityRoomRow[],
  roomTypes: CapacityRoomTypeRow[],
): RoomCapacityDiagnostics {
  const byType = new Map<string, CapacityRoomRow[]>();
  for (const room of rooms) {
    if (!room.room_type_id || !isActive(room)) continue;
    const list = byType.get(room.room_type_id) ?? [];
    list.push(room);
    byType.set(room.room_type_id, list);
  }

  const mixedTypeIds: string[] = [];
  const defaultOutOfSyncTypeIds: string[] = [];
  const roomsOffUniform: string[] = [];
  let typesConsidered = 0;

  for (const type of roomTypes) {
    const activeRooms = byType.get(type.id) ?? [];
    const valid = activeRooms.filter((r) => Number(r.capacity) > 0);
    if (valid.length === 0) continue;
    typesConsidered += 1;
    const capacities = new Set(valid.map((r) => Number(r.capacity)));
    if (capacities.size > 1) {
      mixedTypeIds.push(type.id);
      // Report every room that is not on the majority/uniform value: with mixed
      // capacities there is no uniform value, so the type itself is the finding.
      continue;
    }
    const uniform = [...capacities][0]!;
    for (const room of activeRooms) {
      if (Number(room.capacity) !== uniform) roomsOffUniform.push(room.id);
    }
    if (Number(type.default_capacity) > 0 && Number(type.default_capacity) !== uniform) {
      defaultOutOfSyncTypeIds.push(type.id);
    }
  }

  return {
    mixedTypeIds,
    defaultOutOfSyncTypeIds,
    roomsOffUniform,
    invalidCapacityRooms: rooms
      .filter((r) => !Number(r.capacity) || Number(r.capacity) <= 0)
      .map((r) => r.id),
    missingTypeRooms: rooms.filter((r) => !r.room_type_id && !r.room_type).map((r) => r.id),
    typesConsidered,
  };
}

/** Resource-category metrics for rooms/labs capacity health. */
export function roomCapacityReadinessMetrics(
  rooms: CapacityRoomRow[],
  roomTypes: CapacityRoomTypeRow[],
): (ReadinessMetric & { category: "resources" })[] {
  const d = analyzeRoomCapacities(rooms, roomTypes);
  return [
    {
      label: "قاعات بسعة ≤ 0",
      total: rooms.length,
      missing: d.invalidCapacityRooms.length,
      critical: true,
      category: "resources",
    },
    {
      label: "قاعات بدون نوع قاعة",
      total: rooms.length,
      missing: d.missingTypeRooms.length,
      critical: true,
      category: "resources",
    },
    {
      label: "قاعات نشطة بسعة مختلفة عن السعة الموحدة لنوعها",
      total: rooms.length,
      missing: d.roomsOffUniform.length,
      category: "resources",
    },
    {
      label: "أنواع قاعات: السعة الافتراضية لا تطابق سعة الغرف الموحدة",
      total: d.typesConsidered,
      missing: d.defaultOutOfSyncTypeIds.length,
      category: "resources",
    },
  ];
}
