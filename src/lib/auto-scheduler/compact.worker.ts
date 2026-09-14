import { type Snapshot, type Proposal, type Metrics } from "./compact.ts";
import loadHighs from "highs";
import wasmUrl from "highs/runtime?url";
import { searchJointAttendance } from "./joint-search.ts";

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
    const highs = await loadHighs({ locateFile: () => wasmUrl });
    const proposal = await searchJointAttendance(data.snapshot, highs, data.maxDurationMs);
    scope.postMessage({ type: "result", proposal });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "تعذر حساب التحسين.",
    });
  }
};
