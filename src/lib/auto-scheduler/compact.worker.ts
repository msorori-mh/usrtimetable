import { compact, type Snapshot, type Proposal, type Metrics } from "./compact.ts";

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
    const proposal = await compact(data.snapshot, {
      maxDurationMs: data.maxDurationMs,
      onProgress: (moves, metrics) => scope.postMessage({ type: "progress", moves, metrics }),
    });
    scope.postMessage({ type: "result", proposal });
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "تعذر حساب التحسين.",
    });
  }
};
