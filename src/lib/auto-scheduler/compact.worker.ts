import { type Snapshot, type Proposal, type Metrics } from "./compact.ts";
import { compactAttendance } from "./attendance-compaction.ts";

export type CompactWorkerReply =
  | { type: "progress"; moves: number; metrics: Metrics }
  | { type: "result"; proposal: Proposal }
  | { type: "error"; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ snapshot: Snapshot; maxDurationMs: number }>) => void) | null;
  postMessage: (reply: CompactWorkerReply) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    const proposal = await compactAttendance(data.snapshot, {
      maxDurationMs: data.maxDurationMs,
    });
    scope.postMessage({ type: "result", proposal });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "تعذر حساب التحسين.",
    });
  }
};
