import type { Metrics, Proposal, Snapshot } from "./compact";
import type { CompactWorkerReply } from "./compact.worker";

/** Preview computation stays off the UI thread. Cancellation never sends a write. */
export function previewCompaction(
  snapshot: Snapshot,
  options: {
    signal?: AbortSignal;
    maxDurationMs?: number;
    purpose?: "compaction" | "generation";
    onProgress?: (moves: number, metrics: Metrics) => void;
  } = {},
): Promise<Proposal> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("أُوقفت المعاينة؛ لم تُحفظ تغييرات."));
      return;
    }
    const worker = new Worker(new URL("./compact.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      worker.terminate();
      options.signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error("أُوقفت المعاينة؛ لم تُحفظ تغييرات."));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<CompactWorkerReply>) => {
      if (data.type === "progress") {
        options.onProgress?.(data.moves, data.metrics);
        return;
      }
      cleanup();
      if (data.type === "result") resolve(data.proposal);
      else reject(new Error(data.message));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("تعذر تشغيل معاينة التحسين. أعد تحميل الصفحة وحاول مجددًا."));
    };
    try {
      worker.postMessage({
        snapshot,
        maxDurationMs: options.maxDurationMs ?? 15000,
        purpose: options.purpose ?? "compaction",
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
