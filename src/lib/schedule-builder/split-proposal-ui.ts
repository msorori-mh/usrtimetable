/**
 * Split proposal UI helpers — proposal only; never creates subgroups/sessions.
 * Room capacities always come from live inventory arrays (never hardcoded).
 */
import {
  capacityFitForConfirmed,
  isHardCapacityStatus,
  normalizeEnrollmentCountStatus,
  type EnrollmentCountStatus,
} from "@/lib/schedule-builder/enrollment-trust";
import {
  CAPACITY_EXCEPTION_LIMIT,
  proposeCapacitySplit,
  type CapacitySplitProposal,
} from "@/lib/schedule-builder/section-subgroups";
import {
  filterRoomsByEligibility,
  preferredRoomTypesForSessionType,
  sessionTypeRequiredRoomTypeConflict,
} from "@/lib/schedule-builder/room-type-policy";

export type LiveRoomCapacity = {
  id: string;
  room_type?: string | null;
  capacity?: number | null;
  is_active?: boolean | null;
};

function asFilterRooms(rooms: LiveRoomCapacity[]): Array<{
  id: string;
  room_type?: string | null;
  capacity?: number;
}> {
  return rooms.map((r) => ({
    id: r.id,
    room_type: r.room_type,
    capacity: typeof r.capacity === "number" ? r.capacity : undefined,
  }));
}

export function resolveBestEligibleRoomCapacity(params: {
  rooms: LiveRoomCapacity[];
  sessionType: string;
  requiredRoomType?: string | null;
}): { bestCapacity: number | null; eligibleCount: number; preferredTypes: string[] } {
  const preferredTypes = preferredRoomTypesForSessionType(params.sessionType);
  const eligible = filterRoomsByEligibility(asFilterRooms(params.rooms), {
    sessionType: params.sessionType,
    requiredRoomType: params.requiredRoomType,
  }).filter((r) => typeof r.capacity === "number" && r.capacity! > 0);
  if (!eligible.length) {
    return { bestCapacity: null, eligibleCount: 0, preferredTypes };
  }
  const bestCapacity = Math.max(...eligible.map((r) => Number(r.capacity)));
  return { bestCapacity, eligibleCount: eligible.length, preferredTypes };
}

export function shouldOfferSplitProposal(params: {
  enrollmentCount: number;
  enrollmentStatus: EnrollmentCountStatus | string | null | undefined;
  bestEligibleCapacity: number | null;
  selectedRoomCapacity?: number | null;
}): boolean {
  const status = normalizeEnrollmentCountStatus(params.enrollmentStatus);
  if (!isHardCapacityStatus(status)) return false;
  const n = Math.max(0, Math.floor(params.enrollmentCount));
  if (n <= 0) return false;
  const limit = CAPACITY_EXCEPTION_LIMIT;
  if (
    params.selectedRoomCapacity != null &&
    params.selectedRoomCapacity > 0 &&
    n > params.selectedRoomCapacity + limit
  ) {
    return true;
  }
  if (
    params.bestEligibleCapacity != null &&
    params.bestEligibleCapacity > 0 &&
    n > params.bestEligibleCapacity + limit
  ) {
    return true;
  }
  return false;
}

export function buildSplitProposalForUi(params: {
  enrollmentCount: number;
  enrollmentStatus: EnrollmentCountStatus | string | null | undefined;
  sessionType: string;
  requiredRoomType?: string | null;
  rooms: LiveRoomCapacity[];
  selectedRoomCapacity?: number | null;
  selectedRoomType?: string | null;
}): {
  proposal: CapacitySplitProposal | null;
  roomCapacityUsed: number | null;
  roomCapacitySource: "selected" | "best_eligible" | "none";
  eligibleCount: number;
  dataQualityWarning: boolean;
  fitLabelAr: string | null;
} {
  const dq = sessionTypeRequiredRoomTypeConflict({
    sessionType: params.sessionType,
    requiredRoomType: params.requiredRoomType,
  });
  const { bestCapacity, eligibleCount } = resolveBestEligibleRoomCapacity({
    rooms: params.rooms,
    sessionType: params.sessionType,
    requiredRoomType: params.requiredRoomType,
  });

  let roomCapacityUsed: number | null = null;
  let roomCapacitySource: "selected" | "best_eligible" | "none" = "none";
  const selected = params.selectedRoomCapacity;
  if (
    selected != null &&
    selected > 0 &&
    params.enrollmentCount > selected + CAPACITY_EXCEPTION_LIMIT
  ) {
    roomCapacityUsed = selected;
    roomCapacitySource = "selected";
  } else if (bestCapacity != null) {
    roomCapacityUsed = bestCapacity;
    roomCapacitySource = "best_eligible";
  }

  const proposal =
    roomCapacityUsed != null
      ? proposeCapacitySplit({
          enrollmentCount: params.enrollmentCount,
          enrollmentStatus: params.enrollmentStatus,
          roomCapacity: roomCapacityUsed,
        })
      : null;

  const fit =
    normalizeEnrollmentCountStatus(params.enrollmentStatus) === "confirmed" &&
    roomCapacityUsed != null
      ? capacityFitForConfirmed({
          enrollmentCount: params.enrollmentCount,
          roomCapacity: roomCapacityUsed,
        })
      : null;

  return {
    proposal,
    roomCapacityUsed,
    roomCapacitySource,
    eligibleCount,
    dataQualityWarning: dq.conflict,
    fitLabelAr: fit?.labelAr ?? null,
  };
}
