import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const name = `usrtimetable-plan-room-pg17-${process.pid}`;

function run(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `docker ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

try {
  run([
    "run",
    "--rm",
    "--detach",
    "--name",
    name,
    "--env",
    "POSTGRES_PASSWORD=postgres",
    "--volume",
    `${root}:/work:ro`,
    "postgres:17",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres"], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  if (!ready) throw new Error("PostgreSQL 17 did not become ready");

  for (const file of [
    "/work/scripts/plan-component-room-type-atomic-persistence-pg17/schema.sql",
    "/work/docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01-PREFLIGHT.sql",
    "/work/docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01.sql",
    "/work/scripts/plan-component-room-type-atomic-persistence-pg17/tests.sql",
    "/work/docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01-POST-VERIFIER.sql",
    "/work/docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01-SAFE-DISABLE.sql",
    "/work/scripts/plan-component-room-type-atomic-persistence-pg17/safe-disable-tests.sql",
  ]) {
    run(["exec", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-f", file]);
  }
  console.log("PLAN_COMPONENT_ROOM_TYPE_ATOMIC_PERSISTENCE_PG17: PASS");
} finally {
  spawnSync("docker", ["rm", "--force", name], { encoding: "utf8" });
}
