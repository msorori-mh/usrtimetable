import { improveDistribution } from "./quality-search.ts";
import { type Snapshot, type Proposal, type Metrics } from "./compact.ts";
import loadHighs from "highs";
import wasmUrl from "highs/runtime?url";
import { extendedResourceConflict } from "./extended-resource-capacity.ts";
import { resourceConflictResult } from "./attendance-search.ts";
import { jointProposal, searchJointAttendance } from "./joint-search.ts";

export type CompactWorkerReply =
  | { type: "progress"; moves: number; metrics: Metrics }
  | { type: "result"; proposal: Proposal }
  | { type: "error"; message: string };

const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          snapshot: Snapshot;
          maxDurationMs: number;
          purpose?: "compaction" | "generation";
        }>,
      ) => void)
    | null;
  postMessage: (reply: CompactWorkerReply) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    if (data.purpose !== "generation") {
      const highs = await loadHighs({ locateFile: () => wasmUrl });
      const proposal = await improveDistribution(data.snapshot, highs, {
        maxDurationMs: data.maxDurationMs,
        onProgress: (moves, metrics) => scope.postMessage({ type: "progress", moves, metrics }),
      });
      scope.postMessage({ type: "result", proposal });
      return;
    }
    const conflict = extendedResourceConflict(data.snapshot);
    if (conflict) {
      scope.postMessage({
        type: "result",
        proposal: jointProposal(data.snapshot, resourceConflictResult(conflict)),
      });
      return;
    }
    const highs = await loadHighs({ locateFile: () => wasmUrl });
    const started = Date.now();
    let proposal = await searchJointAttendance(
      data.snapshot,
      highs,
      Math.floor(data.maxDurationMs * 0.8),
      data.purpose,
    );
    if (
      proposal.attendanceSearch?.status === "feasible" &&
      proposal.attendanceSearch.sessions.length
    ) {
      const generated = proposal.attendanceSearch.sessions;
      // Preserve generation's existing-session relocation allowance during polish.
      const polishSnapshot = { ...data.snapshot, sessions: generated };
      const polished = await improveDistribution(polishSnapshot, highs, {
        maxDurationMs: Math.max(0, data.maxDurationMs - (Date.now() - started)),
      });
      const changes = new Map(polished.moves.map((m) => [m.id, m]));
      const final = generated.map((s) => ({ ...s, ...changes.get(s.id) }));
      const existing = new Set(data.snapshot.generationScope?.existingIds ?? []);
      const movedExisting = final.filter((s) => {
        const old = data.snapshot.sessions.find((x) => x.id === s.id)!;
        return (
          existing.has(s.id) &&
          (s.day_of_week !== old.day_of_week ||
            s.start_time !== old.start_time ||
            s.room_id !== old.room_id)
        );
      }).length;
      if (movedExisting <= (data.snapshot.generationScope?.maxRelocations ?? Infinity)) {
        proposal = jointProposal(data.snapshot, { ...proposal.attendanceSearch, sessions: final });
      }
    }
    scope.postMessage({ type: "result", proposal });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "تعذر حساب التحسين.",
    });
  }
};
