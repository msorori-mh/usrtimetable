import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(join(root, "src/lib/schedule-versions/lifecycle.ts"), "utf8");

assert(source.includes('.eq("college_id", collegeId)'), "transition is college-scoped");
assert(source.includes('.eq("status", from)'), "transition compares expected source status");
assert(source.includes('.select("id")'), "transition observes whether a row changed");
assert(source.includes("STALE_VERSION_STATUS"), "stale transition fails explicitly");
assert(
  source.indexOf("if (!transitioned)") < source.indexOf('from("schedule_version_events")'),
  "stale transition cannot emit an audit event",
);

console.log("schedule-version-lifecycle-optimistic.harness.ts: PASS");
