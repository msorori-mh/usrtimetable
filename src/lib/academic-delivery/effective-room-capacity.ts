/**
 * Effective room-type capacity rule (mirror of public.effective_room_type_capacity).
 *
 * If a room type has active rooms and every active room shares the same positive
 * capacity, that value is the effective capacity for the type. If there are no
 * active rooms, or capacities are mixed, we never guess (no MAX/MIN): the caller
 * falls back to room_types.default_capacity as a policy value.
 */

export type ActiveRoomCapacity = {
  capacity: number | null | undefined;
  isActive?: boolean | null;
};

/** Uniform active-room capacity, or null when absent/mixed. */
export function uniformActiveRoomCapacity(rooms: ActiveRoomCapacity[]): number | null {
  const caps = rooms
    .filter((r) => r.isActive !== false)
    .map((r) => Number(r.capacity))
    .filter((c) => Number.isFinite(c) && c > 0);
  if (caps.length === 0) return null;
  const first = caps[0]!;
  return caps.every((c) => c === first) ? Math.floor(first) : null;
}

/** Capacity a delivery group should use for a room-capacity based component. */
export function effectiveRoomTypeCapacity(
  rooms: ActiveRoomCapacity[],
  defaultCapacity: number | null | undefined,
): number | null {
  const uniform = uniformActiveRoomCapacity(rooms);
  if (uniform != null) return uniform;
  const fallback = Number(defaultCapacity);
  return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : null;
}

/**
 * Capacity limit for one delivery group: an explicit component group size always
 * wins and is never replaced by room capacity.
 */
export function resolveDeliveryGroupCapacityLimit(input: {
  explicitGroupSize?: number | null;
  rooms: ActiveRoomCapacity[];
  defaultCapacity?: number | null;
}): number | null {
  const explicit = Number(input.explicitGroupSize);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  return effectiveRoomTypeCapacity(input.rooms, input.defaultCapacity ?? null);
}
