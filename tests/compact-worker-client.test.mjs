import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { snapshot } from "./helpers/attendance-fixtures.mjs";

const file = new URL("../src/lib/auto-scheduler/compact-worker-client.ts", import.meta.url);
const output = await build({
  entryPoints: [fileURLToPath(file)],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  define: { "import.meta.url": JSON.stringify(file.href) },
});
const { previewCompaction } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`
);
class FakeWorker {
  static instances = [];
  constructor() {
    FakeWorker.instances.push(this);
    this.terminated = false;
  }
  postMessage(value) {
    this.input = value;
  }
  terminate() {
    this.terminated = true;
  }
  reply(value) {
    this.onmessage({ data: value });
  }
}
test("preview forwards progress and result and releases worker", async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const progress = [],
      pending = previewCompaction(snapshot([]), { onProgress: (n) => progress.push(n) });
    const worker = FakeWorker.instances.at(-1),
      proposal = { moves: [], outcome: "empty" };
    worker.reply({ type: "progress", moves: 3, metrics: {} });
    worker.reply({ type: "result", proposal });
    assert.deepEqual(await pending, proposal);
    assert.deepEqual(progress, [3]);
    assert.equal(worker.terminated, true);
  } finally {
    globalThis.Worker = original;
  }
});
test("cancelling a running preview terminates it and rejects its result", async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const controller = new AbortController(),
      pending = previewCompaction(snapshot([]), { signal: controller.signal });
    const worker = FakeWorker.instances.at(-1);
    controller.abort();
    await assert.rejects(pending, /أُوقفت المعاينة/);
    assert.equal(worker.terminated, true);
  } finally {
    globalThis.Worker = original;
  }
});
test("worker failure is reported and releases resources", async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  try {
    const pending = previewCompaction(snapshot([])),
      worker = FakeWorker.instances.at(-1);
    worker.reply({ type: "error", message: "bad input" });
    await assert.rejects(pending, /bad input/);
    assert.equal(worker.terminated, true);
  } finally {
    globalThis.Worker = original;
  }
});
